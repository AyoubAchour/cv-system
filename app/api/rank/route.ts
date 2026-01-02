import { NextResponse } from "next/server";

import { isSafeRoleId, listRolePdfs } from "@/lib/cvs";
import { extractFeatures } from "@/lib/features";
import { extractPdfLinkAnnotations, extractPdfText, ocrPdfText, sha256Hex } from "@/lib/pdf";
import type { PdfLinkAnnotation } from "@/lib/pdf";
import { scoreCandidate } from "@/lib/scoring";
import { loadProjectSpecs } from "@/lib/specs";
import { normalizeText } from "@/lib/text";
import { readTextCache, TEXT_CACHE_SCHEMA_VERSION, writeTextCache } from "@/lib/storage";
import { CACHE_ROOT } from "@/lib/cache";

import { promises as fs } from "node:fs";
import path from "node:path";

import { parsePhoneNumberFromString } from "libphonenumber-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type ResolveProjectRoleResult =
  | { ok: true; project: Awaited<ReturnType<typeof loadProjectSpecs>>["projects"][number]; role: Awaited<ReturnType<typeof loadProjectSpecs>>["projects"][number]["roles"][number]; specErrors: string[] }
  | { ok: false; response: NextResponse };

async function resolveProjectAndRole(projectId: string, roleId: string): Promise<ResolveProjectRoleResult> {
  const { projects, errors: specErrors } = await loadProjectSpecs();
  const project = projects.find((p) => p.projectId === projectId);
  if (!project) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Unknown projectId: ${projectId}`, specErrors }, { status: 404 }),
    };
  }

  const role = project.roles.find((r) => r.roleId === roleId);
  if (!role) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Unknown roleId: ${roleId}`, availableRoleIds: project.roles.map((r) => r.roleId) },
        { status: 404 },
      ),
    };
  }

  return { ok: true, project, role, specErrors };
}

async function readPdfBuffer(
  absolutePath: string,
  fileName: string,
  parsingErrors: string[],
): Promise<Buffer | null> {
  try {
    return await fs.readFile(absolutePath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    parsingErrors.push(`Failed to read ${fileName}: ${message}`);
    return null;
  }
}

type CachedTextResult = {
  normalizedText: string;
  numpages: number | null;
  extractedTextChars: number;
  normalizedTextChars: number;
  parseWarnings: string[];
};

type CachedTextHit = CachedTextResult & { meta: CacheExtractionMeta };

type CacheExtractionMeta = {
  extractionMethod?: "pdf" | "ocr";
  ocrLanguages?: string[];
  ocrPages?: number;
  ocrScale?: number;
};

function looksGarbledPdfText(normalizedText: string): boolean {
  // Some PDFs extract as spaced-out characters (e.g. "I n g é n i e u r").
  // That text can be long enough to avoid the existing "looks scanned" heuristic,
  // but keyword/skill matching becomes unreliable.
  const tokens = normalizedText.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  const singleLetterTokens = tokens.filter((t) => /^\p{L}$/u.test(t)).length;
  const singleLetterRatio = singleLetterTokens / tokens.length;

  const lines = normalizedText.split("\n");
  let spacedLines = 0;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 8) continue;
    const singleLetters = parts.filter((p) => /^\p{L}$/u.test(p)).length;
    if (singleLetters / parts.length > 0.6) {
      spacedLines += 1;
      if (spacedLines >= 2) break;
    }
  }

  return singleLetterRatio > 0.25 || spacedLines >= 2;
}

type CandidateContacts = {
  emails: string[];
  phones: Array<{ e164: string; display: string }>;
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
  otherLinks: string[];
};

function isMailtoUrl(url: string): boolean {
  return /^mailto:/i.test(url);
}

function isTelUrl(url: string): boolean {
  return /^tel:/i.test(url);
}

function isLinkedinUrl(url: string): boolean {
  return url.toLowerCase().includes("linkedin.com/");
}

function isGithubUrl(url: string): boolean {
  return url.toLowerCase().includes("github.com/");
}

function isCandidateContactUrl(url: string): boolean {
  return isMailtoUrl(url) || isTelUrl(url) || isLinkedinUrl(url) || isGithubUrl(url);
}

function rectTopY(rect: [number, number, number, number]): number {
  return Math.max(rect[1], rect[3]);
}

function rectBottomY(rect: [number, number, number, number]): number {
  return Math.min(rect[1], rect[3]);
}

function urlKeyForDedupe(url: string): string {
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();

  if (isMailtoUrl(lower)) return `mailto:${lower.replace(/^mailto:/i, "").split("?")[0] ?? ""}`;
  if (isTelUrl(lower)) return `tel:${lower.replace(/^tel:/i, "").split("?")[0] ?? ""}`;

  try {
    const u = new URL(trimmed);
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    const path = u.pathname.replaceAll(/\/+$/g, "");
    const normalizedPath = host === "linkedin.com" || host === "github.com" ? path.toLowerCase() : path;
    return `${host}${normalizedPath}`;
  } catch {
    return lower;
  }
}

function preferenceScore(url: string): number {
  const u = url.trim().toLowerCase();
  let score = 0;
  if (u.startsWith("https://")) score += 3;
  else if (u.startsWith("http://")) score += 2;
  if (u.startsWith("https://www.")) score += 1;
  if (u.includes("linkedin.com/") || u.includes("github.com/")) score += 1;
  return score;
}

function dedupeUrls(urls: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const u of urls) {
    const key = urlKeyForDedupe(u);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, u);
      continue;
    }
    byKey.set(key, preferenceScore(u) > preferenceScore(prev) ? u : prev);
  }
  return Array.from(byKey.values());
}

function filterAnnotationUrlsToHeader(annotations: PdfLinkAnnotation[]): string[] {
  const withRect = annotations.filter(
    (a): a is PdfLinkAnnotation & { rect: [number, number, number, number] } => Array.isArray(a.rect),
  );
  if (withRect.length === 0) return [];

  const contact = withRect.filter((a) => isCandidateContactUrl(a.url));
  if (contact.length === 0) {
    // Be conservative when we cannot locate a header/contact band: only keep obvious contact links.
    return dedupeUrls(withRect.filter((a) => isCandidateContactUrl(a.url)).map((a) => a.url));
  }

  const headerBottomY = Math.min(...contact.map((a) => rectBottomY(a.rect)));
  const threshold = headerBottomY - 24;
  return dedupeUrls(withRect.filter((a) => rectTopY(a.rect) >= threshold).map((a) => a.url));
}

function headerTextSnippet(text: string, maxNonEmptyLines = 40): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    out.push(t);
    if (out.length >= maxNonEmptyLines) break;
  }
  return out.join("\n");
}

function stripTrailingPunctuation(raw: string): string {
  return raw.trim().replaceAll(/[),.;:!?]+$/g, "");
}

const BARE_DOMAIN_DENY = new Set<string>([
  "react.js",
  "next.js",
  "node.js",
  "vue.js",
  "nuxt.js",
  "express.js",
  "angular.js",
  "asp.net",
]);

function normalizeBareDomainToHttps(s: string): string | null {
  const host = s.split("/")[0]?.toLowerCase() ?? "";
  const bareHost = host.startsWith("www.") ? host.slice(4) : host;
  const tld = bareHost.split(".").pop() ?? "";
  const labelCount = bareHost.split(".").filter((p) => p.length > 0).length;

  // Avoid common false positives from tech names like "React.js", "Next.js", "Node.js", etc.
  if (tld === "js" || tld === "ts") return null;
  if (BARE_DOMAIN_DENY.has(bareHost)) return null;

  // Avoid matching common library tokens like "socket.io". Without a scheme/www, only accept subdomains
  // (e.g. "name.github.io", "something.vercel.app").
  if (labelCount < 3) return null;

  return `https://${s}`;
}

function normalizeUrlCandidate(raw: string): string | null {
  let s = stripTrailingPunctuation(raw);
  if (!s) return null;
  if (s.startsWith("<")) s = s.slice(1);
  if (s.endsWith(">")) s = s.slice(0, -1);
  if (/^(mailto:|tel:)/i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  if (/^(?:linkedin|github)\.com\//i.test(s)) return `https://${s}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(s)) return normalizeBareDomainToHttps(s);
  return null;
}

function extractEmailsFromText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi)) {
    const email = String(m[0] ?? "").trim().toLowerCase();
    if (email) out.add(email);
  }
  return Array.from(out);
}

function extractUrlsFromText(text: string): string[] {
  const out = new Set<string>();

  // 1) explicit URLs and common social domains (most reliable)
  const reExplicit = /\b((?:https?:\/\/|www\.)[^\s<>()]+|(?:linkedin|github)\.com\/[^\s<>()]+)\b/gi;
  for (const m of text.matchAll(reExplicit)) {
    const url = normalizeUrlCandidate(String(m[1] ?? ""));
    if (url) out.add(url);
  }

  // 2) bare domains (only safe when used on "header text" snippets)
  const reBare = /\b[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>()]+)?\b/gi;
  for (const m of text.matchAll(reBare)) {
    const index = typeof m.index === "number" ? m.index : -1;
    if (index > 0 && text[index - 1] === "@") continue; // avoid matching email domains
    const url = normalizeUrlCandidate(String(m[0] ?? ""));
    if (url) out.add(url);
  }

  return Array.from(out);
}

function extractPhonesFromText(text: string): Array<{ e164: string; display: string }> {
  const out = new Map<string, { e164: string; display: string }>();

  // Broad candidate matcher; libphonenumber-js will validate and normalize.
  for (const m of text.matchAll(/(?:\+|00)?\d[\d().\s-]{7,}\d/g)) {
    const candidate = stripTrailingPunctuation(String(m[0] ?? ""));
    if (!candidate) continue;

    const parsed = parsePhoneNumberFromString(candidate, "TN");
    if (!parsed) continue;
    if (!parsed.isValid()) continue;

    const e164 = parsed.number;
    if (!e164) continue;
    out.set(e164, { e164, display: parsed.formatInternational() });
  }

  return Array.from(out.values());
}

function pickFirstMatch(urls: string[], predicate: (u: string) => boolean): string | null {
  for (const u of urls) if (predicate(u)) return u;
  return null;
}

function classifyLinks(urls: string[]): {
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
  otherLinks: string[];
} {
  const safeUrls = urls.filter((u) => /^https?:\/\//i.test(u));

  const linkedin = pickFirstMatch(safeUrls, isLinkedinUrl);
  const github = pickFirstMatch(safeUrls, isGithubUrl);

  const remaining = safeUrls.filter((u) => !isLinkedinUrl(u) && !isGithubUrl(u));
  const portfolio = remaining.length ? remaining[0] : null;
  const otherLinks: string[] = [];

  return { linkedin, github, portfolio, otherLinks };
}

function extractEmailsFromUrls(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    if (!/^mailto:/i.test(u)) continue;
    const email = u.replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase();
    if (email) out.add(email);
  }
  return Array.from(out);
}

function extractPhonesFromUrls(urls: string[]): Array<{ e164: string; display: string }> {
  const out = new Map<string, { e164: string; display: string }>();
  for (const u of urls) {
    if (!/^tel:/i.test(u)) continue;
    const tel = u.replace(/^tel:/i, "").split("?")[0]?.trim();
    if (!tel) continue;
    const parsed = parsePhoneNumberFromString(tel, "TN");
    if (!parsed?.isValid()) continue;
    const e164 = parsed.number;
    if (!e164) continue;
    out.set(e164, { e164, display: parsed.formatInternational() });
  }
  return Array.from(out.values());
}

function extractCandidateContacts(params: { text: string; annotationUrls: string[] }): CandidateContacts {
  // Avoid collecting company/experience links by only scanning the top text block for URLs.
  const header = headerTextSnippet(params.text, 40);
  const urlsFromText = extractUrlsFromText(header);
  const allUrls = dedupeUrls(
    [...params.annotationUrls, ...urlsFromText].map(normalizeUrlCandidate).filter(Boolean) as string[],
  );

  const emails = new Set<string>([...extractEmailsFromText(params.text), ...extractEmailsFromUrls(allUrls)]);

  const phonesByE164 = new Map<string, { e164: string; display: string }>();
  for (const p of extractPhonesFromText(params.text)) phonesByE164.set(p.e164, p);
  for (const p of extractPhonesFromUrls(allUrls)) phonesByE164.set(p.e164, p);
  const phones = Array.from(phonesByE164.values());

  const { linkedin, github, portfolio, otherLinks } = classifyLinks(allUrls);

  return {
    emails: Array.from(emails),
    phones,
    linkedin,
    github,
    portfolio,
    otherLinks,
  };
}

function readCacheExtractionMeta(cached: unknown): CacheExtractionMeta {
  if (!cached || typeof cached !== "object") return {};
  const obj = cached as Record<string, unknown>;

  const extractionMethod =
    obj.extractionMethod === "pdf" || obj.extractionMethod === "ocr" ? obj.extractionMethod : undefined;
  const ocrLanguages =
    Array.isArray(obj.ocrLanguages) && obj.ocrLanguages.every((x): x is string => typeof x === "string") ? obj.ocrLanguages : undefined;
  const ocrPages = typeof obj.ocrPages === "number" && Number.isFinite(obj.ocrPages) ? obj.ocrPages : undefined;
  const ocrScale = typeof obj.ocrScale === "number" && Number.isFinite(obj.ocrScale) ? obj.ocrScale : undefined;

  return { extractionMethod, ocrLanguages, ocrPages, ocrScale };
}

function buildOcrCachedWarning(meta: CacheExtractionMeta): string | null {
  if (meta.extractionMethod !== "ocr") return null;
  const langs = meta.ocrLanguages?.length ? meta.ocrLanguages.join("+") : "unknown";
  return `Scanned PDF: OCR cached (${langs}).`;
}

async function getTextFromCache(roleId: string, candidateId: string): Promise<CachedTextHit | null> {
  const cached = await readTextCache(roleId, candidateId);
  if (!cached) return null;

  const parseWarnings: string[] = [];
  const meta = readCacheExtractionMeta(cached);
  const ocrCachedWarning = buildOcrCachedWarning(meta);
  if (ocrCachedWarning) parseWarnings.push(ocrCachedWarning);

  if (cached.schemaVersion === TEXT_CACHE_SCHEMA_VERSION) {
    return {
      normalizedText: cached.normalizedText,
      numpages: cached.numpages,
      extractedTextChars: cached.extractedTextChars,
      normalizedTextChars: cached.normalizedTextChars,
      parseWarnings,
      meta,
    };
  }

  const upgradedNormalized = normalizeText(cached.normalizedText ?? "");

  try {
    await writeTextCache(roleId, {
      schemaVersion: TEXT_CACHE_SCHEMA_VERSION,
      candidateId,
      numpages: cached.numpages ?? null,
      extractedTextChars: cached.extractedTextChars ?? upgradedNormalized.length,
      normalizedTextChars: upgradedNormalized.length,
      normalizedText: upgradedNormalized,
      createdAt: cached.createdAt ?? new Date().toISOString(),
      ...meta,
    });
  } catch {
    // Ignore cache upgrade errors; we can still use the upgraded text in-memory.
  }

  return {
    normalizedText: upgradedNormalized,
    numpages: cached.numpages ?? null,
    extractedTextChars: cached.extractedTextChars ?? upgradedNormalized.length,
    normalizedTextChars: upgradedNormalized.length,
    parseWarnings,
    meta,
  };
}

async function maybeRunOcr(params: {
  buffer: Buffer;
  normalizedFromPdf: string;
  numpages: number | null;
  forceOcr: boolean;
}): Promise<{ normalizedText: string; meta: CacheExtractionMeta; parseWarnings: string[] }> {
  const minTextCharsForOcr = 200;
  const hasPages = (params.numpages ?? 0) > 0;
  const looksScanned = hasPages && params.normalizedFromPdf.length < minTextCharsForOcr;

  if (!looksScanned && !params.forceOcr) {
    return { normalizedText: params.normalizedFromPdf, meta: { extractionMethod: "pdf" }, parseWarnings: [] };
  }

  const tessdataDir = path.join(CACHE_ROOT, "tessdata");
  const languages = ["eng", "fra"];
  const scale = 2;
  const maxPages = 6;

  try {
    const ocr = await ocrPdfText(params.buffer, { languages, tessdataDir, maxPages, scale });
    const ocrNormalized = normalizeText(ocr.text);

    const ocrLooksGarbled = looksGarbledPdfText(ocrNormalized);
    const pdfLooksGarbled = looksGarbledPdfText(params.normalizedFromPdf);

    const shouldPreferOcr =
      ocrNormalized.trim().length > params.normalizedFromPdf.trim().length ||
      (params.forceOcr && pdfLooksGarbled && !ocrLooksGarbled && ocrNormalized.trim().length >= 100);

    if (shouldPreferOcr) {
      return {
        normalizedText: ocrNormalized,
        meta: { extractionMethod: "ocr", ocrLanguages: languages, ocrPages: ocr.usedPages, ocrScale: scale },
        parseWarnings: [
          params.forceOcr
            ? `PDF text extraction looks garbled: OCR used (${languages.join("+")}).`
            : `Scanned PDF detected: OCR used (${languages.join("+")}).`,
        ],
      };
    }

    return {
      normalizedText: params.normalizedFromPdf,
      meta: { extractionMethod: "pdf" },
      parseWarnings: [
        params.forceOcr
          ? "PDF text extraction looks garbled: OCR ran but did not improve extracted text."
          : "Scanned PDF detected: OCR ran but did not improve extracted text.",
      ],
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      normalizedText: params.normalizedFromPdf,
      meta: { extractionMethod: "pdf" },
      parseWarnings: [
        params.forceOcr
          ? `PDF text extraction looks garbled but OCR failed: ${message}`
          : `Scanned PDF detected but OCR failed: ${message}`,
      ],
    };
  }
}

async function getCachedOrExtractedText(params: {
  roleId: string;
  candidateId: string;
  buffer: Buffer;
  fileName: string;
  parsingErrors: string[];
}): Promise<CachedTextResult | null> {
  const cachedHit = await getTextFromCache(params.roleId, params.candidateId);
  if (cachedHit) {
    const minTextCharsForOcr = 200;
    const looksScanned = cachedHit.normalizedTextChars < minTextCharsForOcr;
    const looksGarbled = looksGarbledPdfText(cachedHit.normalizedText);
    const shouldBypassCache =
      (looksScanned && cachedHit.meta.extractionMethod !== "ocr") ||
      (looksGarbled && cachedHit.meta.extractionMethod !== "ocr");

    if (!shouldBypassCache) {
      const { meta: _meta, ...result } = cachedHit;
      return result;
    }
  }

  try {
    const parsed = await extractPdfText(params.buffer);
    const normalizedFromPdf = normalizeText(parsed.text);

    const forceOcr = looksGarbledPdfText(normalizedFromPdf);

    const ocrResult = await maybeRunOcr({
      buffer: params.buffer,
      normalizedFromPdf,
      numpages: parsed.numpages,
      forceOcr,
    });
    const normalized = ocrResult.normalizedText;

    await writeTextCache(params.roleId, {
      schemaVersion: TEXT_CACHE_SCHEMA_VERSION,
      candidateId: params.candidateId,
      numpages: parsed.numpages,
      extractedTextChars: parsed.text.length,
      normalizedTextChars: normalized.length,
      normalizedText: normalized,
      createdAt: new Date().toISOString(),
      ...ocrResult.meta,
    });

    return {
      normalizedText: normalized,
      numpages: parsed.numpages,
      extractedTextChars: parsed.text.length,
      normalizedTextChars: normalized.length,
      parseWarnings: ocrResult.parseWarnings,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    params.parsingErrors.push(`Failed to parse ${params.fileName}: ${message}`);
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const roleId = url.searchParams.get("roleId") ?? "";

  if (!projectId) return jsonError("Missing projectId");
  if (!roleId) return jsonError("Missing roleId");
  if (!isSafeRoleId(roleId)) return jsonError("Invalid roleId");

  const resolved = await resolveProjectAndRole(projectId, roleId);
  if (!resolved.ok) return resolved.response;
  const { project, role, specErrors } = resolved;

  const scan = await listRolePdfs(roleId);

  const seen = new Set<string>();
  const candidates: Array<{
    candidateId: string;
    fileName: string;
    numpages: number | null;
    extractedTextChars: number;
    normalizedTextChars: number;
    parseWarnings: string[];
    contacts: CandidateContacts;
    yearsExperience: number | null;
    relevantExperience: ReturnType<typeof extractFeatures>["relevantExperience"];
    seniority: ReturnType<typeof extractFeatures>["seniority"];
    skillDepth: ReturnType<typeof extractFeatures>["skillDepth"];
    recencyAnalysis: ReturnType<typeof extractFeatures>["recencyAnalysis"];
    redFlags: ReturnType<typeof extractFeatures>["redFlags"];
    projectScale: ReturnType<typeof extractFeatures>["projectScale"];
    education: ReturnType<typeof extractFeatures>["education"];
    parseQuality: ReturnType<typeof extractFeatures>["parseQuality"];
    mustHave: ReturnType<typeof extractFeatures>["mustHave"];
    niceToHave: ReturnType<typeof extractFeatures>["niceToHave"];
    keywordHits: ReturnType<typeof extractFeatures>["keywordHits"];
    score: ReturnType<typeof scoreCandidate>;
  }> = [];

  const parsingErrors: string[] = [];

  for (const pdf of scan.pdfs) {
    const buffer = await readPdfBuffer(pdf.absolutePath, pdf.fileName, parsingErrors);
    if (!buffer) continue;

    const candidateId = sha256Hex(buffer);
    if (seen.has(candidateId)) continue;
    seen.add(candidateId);

    const text = await getCachedOrExtractedText({
      roleId,
      candidateId,
      buffer,
      fileName: pdf.fileName,
      parsingErrors,
    });
    if (!text) continue;

    const features = extractFeatures({
      text: text.normalizedText,
      mustHaveSkills: role.mustHaveSkills,
      niceToHaveSkills: role.niceToHaveSkills,
      keywords: role.keywords,
      skillAliases: project.skillAliases,
      experienceRelevanceKeywords: role.experienceRelevanceKeywords,
      seniorityIndicators: role.seniorityIndicators,
    });

    let annotationUrls: string[] = [];
    try {
      const annotations = await extractPdfLinkAnnotations(buffer, { maxPages: 1 });
      annotationUrls = filterAnnotationUrlsToHeader(annotations);
    } catch {
      annotationUrls = [];
    }
    const contacts = extractCandidateContacts({ text: text.normalizedText, annotationUrls });

    const score = scoreCandidate({
      minYearsExperience: role.minYearsExperience,
      hardFilters: role.scoring.hardFilters,
      mustHave: features.mustHave,
      niceToHave: features.niceToHave,
      candidateYearsExperience: features.yearsExperience,
      relevantExperience: features.relevantExperience,
      skillDepth: features.skillDepth,
      seniority: features.seniority,
      recencyAnalysis: features.recencyAnalysis,
      redFlags: features.redFlags,
      projectScale: features.projectScale,
      education: features.education,
      weights: role.scoring.weights,
    });

    candidates.push({
      candidateId,
      fileName: pdf.fileName,
      numpages: text.numpages,
      extractedTextChars: text.extractedTextChars,
      normalizedTextChars: text.normalizedTextChars,
      parseWarnings: [...text.parseWarnings, ...features.warnings],
      contacts,
      yearsExperience: features.yearsExperience,
      relevantExperience: features.relevantExperience,
      seniority: features.seniority,
      skillDepth: features.skillDepth,
      recencyAnalysis: features.recencyAnalysis,
      redFlags: features.redFlags,
      projectScale: features.projectScale,
      education: features.education,
      parseQuality: features.parseQuality,
      mustHave: features.mustHave,
      niceToHave: features.niceToHave,
      keywordHits: features.keywordHits,
      score,
    });
  }

  candidates.sort((a, b) => {
    if (a.score.belowThreshold !== b.score.belowThreshold) return a.score.belowThreshold ? 1 : -1;
    return b.score.overallScore - a.score.overallScore;
  });

  return NextResponse.json({
    project: { projectId: project.projectId, name: project.name },
    role: {
      roleId: role.roleId,
      title: role.title,
      minYearsExperience: role.minYearsExperience,
      hardFilters: role.scoring.hardFilters ?? null,
    },
    scan: {
      roleDir: scan.roleDir,
      exists: scan.exists,
      pdfCount: scan.pdfs.length,
    },
    candidates,
    parsingErrors,
    specErrors,
  });
}


