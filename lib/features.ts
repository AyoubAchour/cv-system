import "server-only";

import Fuse from "fuse.js";

import { lineSnippetAtIndex, toLines, truncateMiddle } from "@/lib/text";
import type { KeywordHit, SkillMatch } from "@/lib/scoring";
import type { SeniorityIndicators } from "@/lib/specs";

export type RoleSkillSpec = { skill: string; weight: number };
export type SkillAliases = Record<string, string[]>;

export type SkillDepthResult = {
  skill: string;
  mentionCount: number;
  inExperienceSection: boolean;
  inRecentRole: boolean;
  contextQuality: "high" | "medium" | "low";
  depthScore: number; // 0-1
};

export type SeniorityResult = {
  level: "senior" | "mid" | "junior" | "unknown";
  confidence: number; // 0-1
  evidence: string[];
};

export type RelevantExperienceResult = {
  totalYears: number | null;
  relevantYears: number | null;
  roles: Array<{
    title: string;
    isRelevant: boolean;
    months: number;
    recency: "current" | "recent" | "old";
  }>;
};

// ============================================================================
// RECENCY ANALYSIS TYPES
// ============================================================================

export type SkillRecency = {
  skill: string;
  lastUsedYear: number | null;
  recencyCategory: "current" | "recent" | "stale" | "old" | "unknown";
  recencyMultiplier: number; // 1.0 for current, decreasing for older
};

export type CareerTrajectory = {
  trajectory: "ascending" | "stable" | "descending" | "unclear";
  evidence: string[];
  recentRoleLevel: "senior" | "mid" | "junior" | "unknown";
};

export type RecencyAnalysis = {
  skillRecency: SkillRecency[];
  careerTrajectory: CareerTrajectory;
  recencyScore: number; // 0-1
};

// ============================================================================
// RED FLAG TYPES
// ============================================================================

export type RedFlag = {
  type: "job_hopping" | "employment_gap" | "title_inflation" | "experience_mismatch" | "career_regression";
  severity: "high" | "medium" | "low";
  evidence: string;
  penalty: number; // points to subtract
};

export type RedFlagAnalysis = {
  flags: RedFlag[];
  totalPenalty: number; // 0-25 max
};

// ============================================================================
// PROJECT SCALE TYPES
// ============================================================================

export type ProjectScaleSignals = {
  maxUserScale: number | null;      // largest user count mentioned
  maxTeamSize: number | null;       // largest team size mentioned
  companyTypes: Array<"enterprise" | "startup" | "agency" | "freelance">;
  impactIndicators: string[];       // ["production", "SaaS", "B2B", etc.]
  scaleScore: number;               // 0-1
};

// ============================================================================
// EDUCATION TYPES
// ============================================================================

export type Degree = {
  type: "phd" | "masters" | "bachelors" | "associate" | "bootcamp" | "certification" | "unknown";
  field: "cs" | "engineering" | "related" | "unrelated" | "unknown";
  institution: string;
  year: number | null;
};

export type Certification = {
  name: string;
  isRelevant: boolean;
};

export type EducationAnalysis = {
  degrees: Degree[];
  certifications: Certification[];
  highestRelevantDegree: Degree["type"] | null;
  educationScore: number; // 0-1
};

// ============================================================================
// PARSE QUALITY TYPE
// ============================================================================

export type ParseQuality = {
  overall: "high" | "medium" | "low";
  confidence: number; // 0-1
  textExtraction: "good" | "partial" | "poor";
  datesParsed: number;
  experienceSectionFound: boolean;
  skillsMatched: number;
  issues: string[];
};

// ============================================================================
// MAIN EXTRACTED FEATURES TYPE
// ============================================================================

export type ExtractedFeatures = {
  mustHave: SkillMatch[];
  niceToHave: SkillMatch[];
  keywordHits: KeywordHit[];
  yearsExperience: number | null;
  relevantExperience: RelevantExperienceResult;
  skillDepth: SkillDepthResult[];
  seniority: SeniorityResult;
  recencyAnalysis: RecencyAnalysis;
  redFlags: RedFlagAnalysis;
  projectScale: ProjectScaleSignals;
  education: EducationAnalysis;
  parseQuality: ParseQuality;
  warnings: string[];
};

function escapeRegExp(s: string): string {
  // eslint-disable-next-line unicorn/prefer-string-raw
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function findExactEvidence(text: string, term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;

  const escaped = escapeRegExp(trimmed);
  const useBoundary = /^[a-z0-9]+$/i.test(trimmed) && trimmed.length <= 5;
  const pattern = useBoundary ? `(?<![a-z0-9])${escaped}(?![a-z0-9])` : escaped;
  const re = new RegExp(pattern, "i");
  const index = re.exec(text)?.index;
  if (index === undefined) return null;
  return lineSnippetAtIndex(text, index);
}

function findFuzzyEvidence(lines: string[], fuse: Fuse<string> | null, term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  if (!fuse) return null;
  if (trimmed.length <= 3) return null;

  const results = fuse.search(trimmed, { limit: 1 });
  if (results.length === 0) return null;
  const best = results[0];
  if (typeof best.score === "number" && best.score > 0.25) return null;
  return truncateMiddle(String(best.item).trim(), 220);
}

function expandTerms(skill: string, skillAliases: SkillAliases): string[] {
  const out = new Set<string>();
  out.add(skill);
  for (const alias of skillAliases[skill] ?? []) out.add(alias);
  return Array.from(out).filter((s) => s.trim().length > 0);
}

function matchSkill(
  text: string,
  lines: string[],
  fuse: Fuse<string> | null,
  spec: RoleSkillSpec,
  skillAliases: SkillAliases,
): SkillMatch {
  const terms = expandTerms(spec.skill, skillAliases);

  for (const term of terms) {
    const evidence = findExactEvidence(text, term);
    if (evidence) return { skill: spec.skill, weight: spec.weight, matched: true, evidence: [evidence] };
  }

  for (const term of terms) {
    const evidence = findFuzzyEvidence(lines, fuse, term);
    if (evidence) return { skill: spec.skill, weight: spec.weight, matched: true, evidence: [evidence] };
  }

  return { skill: spec.skill, weight: spec.weight, matched: false, evidence: [] };
}

function matchKeyword(text: string, lines: string[], fuse: Fuse<string> | null, keyword: string): KeywordHit {
  const evidenceExact = findExactEvidence(text, keyword);
  if (evidenceExact) return { keyword, matched: true, evidence: [evidenceExact] };

  const evidenceFuzzy = findFuzzyEvidence(lines, fuse, keyword);
  if (evidenceFuzzy) return { keyword, matched: true, evidence: [evidenceFuzzy] };

  return { keyword, matched: false, evidence: [] };
}

type MonthInterval = { start: number; end: number };

function parseExplicitYearsExperience(text: string): number | null {
  const patterns: RegExp[] = [
    // English
    /\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b/i,
    /\bexperience\b\D{0,12}(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i,

    // French
    /\b(\d{1,2})\s*\+?\s*ans?\s+d['’]exp[ée]rience\b/i,
    /\bexp[ée]rience\b\D{0,12}(\d{1,2})\s*\+?\s*ans?\b/i,
  ];

  for (const re of patterns) {
    const m = re.exec(text);
    const raw = m?.[1];
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (n < 0 || n > 50) continue;
    return n;
  }

  return null;
}

function isPresentToken(raw: string): boolean {
  const t = raw
    .trim()
    .toLowerCase()
    .replaceAll("'", "'")
    .replaceAll(/\s+/g, " ")
    .replaceAll("à", "a");
  return (
    t === "present" ||
    t === "current" ||
    t === "présent" ||
    t === "present" ||
    t === "actuel" ||
    t === "aujourd'hui" ||
    t === "aujourd hui" ||
    t === "a ce jour" ||
    t === "ce jour" ||
    t === "to date" ||
    t === "today" ||
    t === "en cours" ||
    t === "ongoing" ||
    t === "now" ||
    t === "maintenant" ||
    t === "actuellement" ||
    t === "aujourd'huit" || // OCR typo
    t === "aujoud'hui" // OCR typo
  );
}

function looksLikeSectionHeadingLine(rawLine: string): boolean {
  const line = rawLine.trim();
  if (!line) return false;
  if (line.length > 100) return false;

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length > 10) return false;

  // Headings are often short and either mostly uppercase or “Title Case”.
  const letters = line.match(/[A-Za-zÀ-ÿ]/g)?.join("") ?? "";
  const upper = letters.replaceAll(/[a-zà-ÿ]/g, "");
  const upperRatio = letters.length > 0 ? upper.length / letters.length : 0;
  return upperRatio >= 0.7 || words.length <= 5;
}

function tokenMatchesAnyHeading(token: string, headings: Set<string>): boolean {
  if (!token) return false;
  if (headings.has(token)) return true;

  // OCR/multi-column extraction can duplicate headings on the same line:
  // e.g. "experienceprofessionnelleexperienceprofessionnelle".
  for (const h of headings) {
    if (h.length >= 6 && token.includes(h)) return true;
  }
  return false;
}

function looksLikeSkillListLine(rawLine: string): boolean {
  const line = rawLine.trim();
  if (!line) return false;
  if (line.length > 140) return true;

  // Heuristic: tech stacks are usually comma/pipe separated lists.
  const separators = (line.match(/[,|/•]/g) ?? []).length;
  const wordCount = line.split(/\s+/).filter(Boolean).length;
  if (separators >= 3 && wordCount >= 4) return true;

  // Many stacks also contain lots of short tokens.
  const tokens = line.split(/[,|/•]/g).map((t) => t.trim()).filter(Boolean);
  if (tokens.length >= 5) {
    const shortTokens = tokens.filter((t) => t.length <= 6).length;
    if (shortTokens / tokens.length >= 0.6) return true;
  }

  return false;
}

function isInternshipOrAcademicRoleText(raw: string): boolean {
  const t = raw
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "");

  // Treat internships and academic end-of-studies projects as non full-time professional experience.
  return /\b(stage|stagiaire|intern(?:ship)?|trainee|alternance|apprentissage|apprenti|pfe|sfe|fin\s+d['’]?(?:etudes|etudes))\b/i.test(t);
}

function normalizeMonthToken(raw: string): string {
  // PDF extraction sometimes inserts standalone accent marks (e.g. "Aoˆut", "D´ecembre").
  // Normalize aggressively to "letters-only" month tokens.
  try {
    return raw
      .trim()
      .toLowerCase()
      .replaceAll("’", "'")
      .normalize("NFKD")
      .replaceAll(/\p{Diacritic}/gu, "")
      .replaceAll(/[^\p{L}]+/gu, "");
  } catch {
    // Extremely defensive fallback.
    return raw.trim().toLowerCase().replaceAll(/[^a-z]+/g, "");
  }
}

function monthTokenToNumber(raw: string): number | null {
  const t = normalizeMonthToken(raw);
  const map: Record<string, number> = {
    jan: 1,
    januar: 1,
    january: 1,
    janv: 1,
    janvier: 1,

    feb: 2,
    february: 2,
    fev: 2,
    fevr: 2,
    fevrier: 2,

    mar: 3,
    march: 3,
    mars: 3,

    apr: 4,
    april: 4,
    avr: 4,
    avril: 4,

    may: 5,
    mai: 5,

    jun: 6,
    june: 6,
    juin: 6,

    jul: 7,
    july: 7,
    juil: 7,
    juillet: 7,

    aug: 8,
    august: 8,
    aou: 8,
    aout: 8,

    sep: 9,
    sept: 9,
    september: 9,
    septembre: 9,

    oct: 10,
    october: 10,
    octobre: 10,

    nov: 11,
    november: 11,
    novembre: 11,

    dec: 12,
    december: 12,
    decembre: 12,
  };

  return map[t] ?? null;
}

function toMonthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function pushInterval(out: MonthInterval[], startIndex: number, endIndex: number): void {
  if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return;
  if (endIndex <= startIndex) return;

  // Drop obviously incorrect / absurd ranges.
  if (endIndex - startIndex > 12 * 50) return;
  out.push({ start: startIndex, end: endIndex });
}

function mergeIntervals(intervals: MonthInterval[]): MonthInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: MonthInterval[] = [];
  for (const cur of sorted) {
    const last = out.at(-1);
    if (!last || cur.start > last.end) {
      out.push({ start: cur.start, end: cur.end });
      continue;
    }
    last.end = Math.max(last.end, cur.end);
  }
  return out;
}

function normalizeHeadingToken(line: string): string {
  try {
    return line
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replaceAll(/\p{Diacritic}/gu, "")
      .replaceAll(/[^\p{L}]+/gu, "");
  } catch {
    // Extremely defensive fallback.
    return line.trim().toLowerCase().replaceAll(/[^a-z]+/g, "");
  }
}

function isExperienceStartHeading(line: string, token: string, startHeads: Set<string>): boolean {
  if (!looksLikeSectionHeadingLine(line)) return false;
  if (tokenMatchesAnyHeading(token, startHeads)) return true;
  return (token.startsWith("experience") || token.startsWith("experiences")) && token.length <= 60;
}

function isExperienceEndHeading(line: string, token: string, endHeads: Set<string>): boolean {
  return looksLikeSectionHeadingLine(line) && tokenMatchesAnyHeading(token, endHeads);
}

function findExperienceSectionRange(
  lines: string[],
  normalizedLines: string[],
  startHeads: Set<string>,
  endHeads: Set<string>,
  fromIndex: number,
): { startLine: number; endLine: number } | null {
  let startLine = -1;

  for (let i = Math.max(0, fromIndex); i < normalizedLines.length; i++) {
    const token = normalizedLines[i] ?? "";
    if (!token) continue;
    if (isExperienceStartHeading(lines[i] ?? "", token, startHeads)) {
      startLine = i;
      break;
    }
  }

  if (startLine === -1) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < normalizedLines.length; i++) {
    const token = normalizedLines[i] ?? "";
    if (!token) continue;
    if (isExperienceEndHeading(lines[i] ?? "", token, endHeads)) {
      endLine = i;
      break;
    }
  }

  return { startLine, endLine };
}

function extractSectionBody(lines: string[], startLine: number, endLine: number): string {
  // Skip the heading line itself.
  return lines.slice(startLine + 1, endLine).join("\n");
}

function extractLikelyExperienceText(text: string): string {
  // Many CVs include unrelated dates (education, birth year, etc.).
  // Try to focus on the Experience section first. Fall back to full text.
  const startHeads = new Set<string>([
    "experience",
    "experiences",
    "experienceprofessionnelle",
    "experiencesprofessionnelles",
    "professionalexperience",
    "workexperience",
    "workexperiences",
    "careerhistory",
    "employmenthistory",
    "workhistory",
    "parcoursprofessionnel",
    "experienceacademique", // Some people put academic experience here
  ]);
  const endHeads = new Set<string>([
    "education",
    "formation",
    "formations",
    "diplome",
    "diplomes",
    "skills",
    "technicalskills",
    "competence",
    "competences",
    "competencestechniques",
    "certification",
    "certifications",
    "project",
    "projects",
    "projet",
    "projets",
    "academicproject",
    "academicprojects",
    "projetacademique",
    "projetsacademiques",
    "languages",
    "langues",
    "hobbies",
    "interests",
    "centresinteret",
    "loisirs",
    "volunteer",
    "benevolat",
    "references",
    "apropos", // "À propos" section
    "about",
    "profile",
    "profil",
    "summary",
  ]);

  const lines = text.split("\n");
  const normalizedLines = lines.map(normalizeHeadingToken);

  const primary = findExperienceSectionRange(lines, normalizedLines, startHeads, endHeads, 0);
  if (!primary) return text;

  const extracted = extractSectionBody(lines, primary.startLine, primary.endLine);
  
  // If extraction is suspiciously short (< 100 chars), likely a false positive
  // Try to find the next occurrence of experience heading

  if (extracted.trim().length < 100) {
    const secondary = findExperienceSectionRange(
      lines,
      normalizedLines,
      startHeads,
      endHeads,
      primary.startLine + 1,
    );

    if (secondary) {
      const alt = extractSectionBody(lines, secondary.startLine, secondary.endLine);
      if (alt.trim().length > extracted.trim().length) return alt;
    }
  }
  
  return extracted;
}

function yearTokenToNumber(raw: string, nowYear: number): number | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replaceAll("’", "'")
    .replaceAll(/\s+/g, "")
    .replaceAll(".", "");

  if (/^(19|20)\d{2}$/.test(cleaned)) {
    const y = Number(cleaned);
    if (y >= 1950 && y <= nowYear + 1) return y;
    return null;
  }

  const m = /^'?(\d{2})$/.exec(cleaned);
  if (!m) return null;
  const yy = Number(m[1]);
  if (!Number.isFinite(yy)) return null;

  const currentYY = nowYear % 100;
  const year = yy <= currentYY + 1 ? 2000 + yy : 1900 + yy;
  if (year < 1950 || year > nowYear + 1) return null;
  return year;
}

function extractYearRangeIntervals(text: string, nowYear: number, nowMonth: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // eslint-disable-next-line sonarjs/regex-complexity
  const re = /\b((?:19|20)\d{2})\b(?:\s*[-‐‑‒–—−]\s*|\s+(?:to|until|till|through|[aà]|au|jusqu['’]?[aà]|jusqua)\s+)\s*(\b(?:19|20)\d{2}\b|['’]?\s*\d{2}\b|present|current|pr[ée]sent|aujourd['’]hui|actuel|ce\s*jour|en\s*cours|to\s*date|today)\b/gi;

  for (const m of text.matchAll(re)) {
    const startYear = Number(m[1]);
    const endRaw = String(m[2] ?? "");
    if (!Number.isFinite(startYear)) continue;

    const endYear = isPresentToken(endRaw) ? nowYear : yearTokenToNumber(endRaw, nowYear);
    if (endYear === null) continue;
    if (startYear < 1950 || startYear > nowYear + 1) continue;
    if (endYear < 1950 || endYear > nowYear + 1) continue;
    if (endYear < startYear) continue;

    const startIndex = toMonthIndex(startYear, 1);
    const endIndex = isPresentToken(endRaw) ? toMonthIndex(nowYear, nowMonth) + 1 : toMonthIndex(endYear, 1);
    pushInterval(out, startIndex, endIndex);
  }

  return out;
}

function extractMonthNameRangeIntervals(text: string, nowYear: number, nowMonth: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // eslint-disable-next-line regexp/no-super-linear-backtracking, regexp/no-misleading-capturing-group, regexp/optimal-quantifier-concatenation, regexp/require-unicode-regexp, regexp/complexity, sonarjs/regex-complexity
  const re = /(?:^|[^\p{L}])(?:\d{1,2}\s+)?(\p{L}{3,15})\.?\s*(?:\d{1,2}(?:st|nd|rd|th)?\s*[.,]?\s*)?((?:19|20)\d{2}|['’]?\s*\d{2})(?:\s*[-‐‑‒–—−]\s*|\s+(?:to|until|till|through|[aà]|au|jusqu['’]?[aà]|jusqua)\s+)(?:(?:\d{1,2}\s+)?(\p{L}{3,15})\.?\s*(?:\d{1,2}(?:st|nd|rd|th)?\s*[.,]?\s*)?)?((?:19|20)\d{2}|['’]?\s*\d{2}|present|current|pr[ée]sent|aujourd['’]hui|actuel|ce\s*jour|en\s*cours|to\s*date|today)(?:$|[^\p{L}])/giu;

  function toInterval(m: RegExpMatchArray): MonthInterval | null {
    const startMonth = monthTokenToNumber(String(m[1] ?? ""));
    const startYear = yearTokenToNumber(String(m[2] ?? ""), nowYear);
    if (!startMonth || startYear === null) return null;
    if (startYear < 1950 || startYear > nowYear + 1) return null;

    const endToken = String(m[4] ?? "");
    const endIsPresent = isPresentToken(endToken);

    let endYear = nowYear;
    let endMonth = nowMonth;

    if (!endIsPresent) {
      const parsedEndYear = yearTokenToNumber(endToken, nowYear);
      if (parsedEndYear === null || parsedEndYear < 1950 || parsedEndYear > nowYear + 1) return null;
      endYear = parsedEndYear;

      const endMonthRaw = m[3] ? String(m[3]) : null;
      if (endMonthRaw) {
        const parsedEndMonth = monthTokenToNumber(endMonthRaw);
        if (!parsedEndMonth) return null;
        endMonth = parsedEndMonth;
      } else {
        endMonth = 12;
      }
    }

    const startIndex = toMonthIndex(startYear, startMonth);
    const endIndex = endIsPresent ? toMonthIndex(nowYear, nowMonth) + 1 : toMonthIndex(endYear, endMonth) + 1;
    return endIndex > startIndex ? { start: startIndex, end: endIndex } : { start: startIndex, end: startIndex + 1 };
  }

  for (const m of text.matchAll(re)) {
    const interval = toInterval(m);
    if (!interval) continue;
    pushInterval(out, interval.start, interval.end);
  }

  return out;
}

function extractMonthNumRangeIntervals(text: string, nowYear: number, nowMonth: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // eslint-disable-next-line sonarjs/regex-complexity
  const re = /\b(0?[1-9]|1[0-2])[/.-]((?:19|20)\d{2}|['’]?\s*\d{2})(?:\s*[-‐‑‒–—−]\s*|\s+(?:to|until|till|through|[aà]|au|jusqu['’]?[aà]|jusqua)\s+)\s*(?:(0?[1-9]|1[0-2])[/.-])?((?:19|20)\d{2}|['’]?\s*\d{2}|present|current|pr[ée]sent|aujourd['’]hui|actuel|ce\s*jour|en\s*cours|to\s*date|today)\b/gi;

  function toInterval(m: RegExpMatchArray): MonthInterval | null {
    const startMonth = Number(m[1]);
    const startYear = yearTokenToNumber(String(m[2] ?? ""), nowYear);
    if (!Number.isFinite(startMonth) || startMonth < 1 || startMonth > 12) return null;
    if (startYear === null || startYear < 1950 || startYear > nowYear + 1) return null;

    const endToken = String(m[4] ?? "");
    const endIsPresent = isPresentToken(endToken);

    let endYear = nowYear;
    let endMonth = nowMonth;

    if (!endIsPresent) {
      const parsedEndYear = yearTokenToNumber(endToken, nowYear);
      if (parsedEndYear === null || parsedEndYear < 1950 || parsedEndYear > nowYear + 1) return null;
      endYear = parsedEndYear;

      const endMonthRaw = m[3] ? Number(String(m[3]).replaceAll("/", "").replaceAll("-", "").replaceAll(".", "")) : null;
      endMonth = endMonthRaw && Number.isFinite(endMonthRaw) ? endMonthRaw : 12;
      if (endMonth < 1 || endMonth > 12) return null;
    }

    const startIndex = toMonthIndex(startYear, startMonth);
    const endIndex = endIsPresent ? toMonthIndex(nowYear, nowMonth) + 1 : toMonthIndex(endYear, endMonth) + 1;
    return endIndex > startIndex ? { start: startIndex, end: endIndex } : { start: startIndex, end: startIndex + 1 };
  }

  for (const m of text.matchAll(re)) {
    const interval = toInterval(m);
    if (!interval) continue;
    pushInterval(out, interval.start, interval.end);
  }

  return out;
}

function resolveMonthFromTwoNumbers(a: number, b: number): number | null {
  // For numeric full dates, prefer DD/MM interpretation (common in FR) unless impossible.
  // - If a > 12 and b <= 12 -> DD/MM
  // - If b > 12 and a <= 12 -> MM/DD
  // - If both <= 12 -> assume DD/MM
  // - Otherwise -> invalid
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a >= 1 && a <= 31 && b >= 1 && b <= 12 && a > 12) return b;
  if (b >= 1 && b <= 31 && a >= 1 && a <= 12 && b > 12) return a;
  if (a >= 1 && a <= 12 && b >= 1 && b <= 12) return b;
  return null;
}

function extractNumericFullDateRangeIntervals(text: string, nowYear: number, nowMonth: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // Examples:
  // - 10/02/2025 - 10/06/2025
  // - 10.02.2025 — 10.06.2025
  // - 10-02-2025 to 10-06-2025
  // eslint-disable-next-line regexp/complexity, sonarjs/regex-complexity
  const re = /\b(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d{2})(?:\s*[-‐‑‒–—−]\s*|\s+(?:to|until|till|through|[aà]|au|jusqu['’]?[aà]|jusqua)\s+)\s*(?:(\d{1,2})[/.-](\d{1,2})[/.-])?((?:19|20)\d{2}|present|current|pr[ée]sent|aujourd['’]hui|actuel|ce\s*jour|en\s*cours|to\s*date|today)\b/gi;

  function toInterval(m: RegExpMatchArray): MonthInterval | null {
    const a1 = Number(m[1]);
    const b1 = Number(m[2]);
    const startYear = Number(m[3]);
    if (!Number.isFinite(startYear) || startYear < 1950 || startYear > nowYear + 1) return null;

    const startMonth = resolveMonthFromTwoNumbers(a1, b1);
    if (!startMonth) return null;

    const endToken = String(m[6] ?? "");
    const endIsPresent = isPresentToken(endToken);

    let endYear = nowYear;
    let endMonth = nowMonth;

    if (!endIsPresent) {
      const parsedEndYear = yearTokenToNumber(endToken, nowYear);
      if (parsedEndYear === null || parsedEndYear < 1950 || parsedEndYear > nowYear + 1) return null;
      endYear = parsedEndYear;

      if (m[4] && m[5]) {
        const a2 = Number(m[4]);
        const b2 = Number(m[5]);
        const parsedEndMonth = resolveMonthFromTwoNumbers(a2, b2);
        if (!parsedEndMonth) return null;
        endMonth = parsedEndMonth;
      } else {
        endMonth = 12;
      }
    }

    const startIndex = toMonthIndex(startYear, startMonth);
    const endIndex = endIsPresent ? toMonthIndex(nowYear, nowMonth) + 1 : toMonthIndex(endYear, endMonth) + 1;
    return endIndex > startIndex ? { start: startIndex, end: endIndex } : { start: startIndex, end: startIndex + 1 };
  }

  for (const m of text.matchAll(re)) {
    const interval = toInterval(m);
    if (!interval) continue;
    pushInterval(out, interval.start, interval.end);
  }

  return out;
}

function extractDayMonthYearRangeIntervals(text: string, nowYear: number, nowMonth: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // Examples:
  // - 10 Feb 2025 - 10 Jun 2025
  // - 10 février 2025 — 10 juin 2025
  // eslint-disable-next-line regexp/complexity, sonarjs/regex-complexity
  const re = /(?:^|[^\p{L}])(\d{1,2})(?:st|nd|rd|th)?\s+(\p{L}{3,15})\.?\s+((?:19|20)\d{2}|['’]?\s*\d{2})(?:\s*[-‐‑‒–—−]\s*|\s+(?:to|until|till|through|[aà]|au|jusqu['’]?[aà]|jusqua)\s+)\s*(?:(\d{1,2})(?:st|nd|rd|th)?\s+(\p{L}{3,15})\.?\s+)?((?:19|20)\d{2}|['’]?\s*\d{2}|present|current|pr[ée]sent|aujourd['’]hui|actuel|ce\s*jour|en\s*cours|to\s*date|today)(?:$|[^\p{L}])/giu;

  function toInterval(m: RegExpMatchArray): MonthInterval | null {
    const startMonth = monthTokenToNumber(String(m[2] ?? ""));
    const startYear = yearTokenToNumber(String(m[3] ?? ""), nowYear);
    if (!startMonth || startYear === null) return null;
    if (startYear < 1950 || startYear > nowYear + 1) return null;

    const endToken = String(m[6] ?? "");
    const endIsPresent = isPresentToken(endToken);

    let endYear = nowYear;
    let endMonth = nowMonth;

    if (!endIsPresent) {
      const parsedEndYear = yearTokenToNumber(endToken, nowYear);
      if (parsedEndYear === null || parsedEndYear < 1950 || parsedEndYear > nowYear + 1) return null;
      endYear = parsedEndYear;

      const endMonthRaw = m[5] ? String(m[5]) : null;
      if (endMonthRaw) {
        const parsedEndMonth = monthTokenToNumber(endMonthRaw);
        if (!parsedEndMonth) return null;
        endMonth = parsedEndMonth;
      } else {
        endMonth = 12;
      }
    }

    const startIndex = toMonthIndex(startYear, startMonth);
    const endIndex = endIsPresent ? toMonthIndex(nowYear, nowMonth) + 1 : toMonthIndex(endYear, endMonth) + 1;
    return endIndex > startIndex ? { start: startIndex, end: endIndex } : { start: startIndex, end: startIndex + 1 };
  }

  for (const m of text.matchAll(re)) {
    const interval = toInterval(m);
    if (!interval) continue;
    pushInterval(out, interval.start, interval.end);
  }

  return out;
}

function shouldCountSingleMonthLine(
  lines: string[],
  idx: number,
  internshipHintRe: RegExp,
  hasRangeConnectorRe: RegExp,
): boolean {
  const line = lines[idx] ?? "";
  if (!line) return false;
  if (hasRangeConnectorRe.test(line)) return false;

  const window = `${lines[idx - 1] ?? ""} ${line} ${lines[idx + 1] ?? ""}`;
  return internshipHintRe.test(window);
}

function addSingleNumericMonthIntervals(out: MonthInterval[], line: string, nowYear: number): void {
  for (const m of line.matchAll(/\b(0?[1-9]|1[0-2])[/.-]((?:19|20)\d{2}|['’]?\s*\d{2})\b/gi)) {
    const month = Number(m[1]);
    const year = yearTokenToNumber(String(m[2] ?? ""), nowYear);
    if (!Number.isFinite(month) || month < 1 || month > 12) continue;
    if (year === null || year < 1950 || year > nowYear + 1) continue;
    const startIndex = toMonthIndex(year, month);
    pushInterval(out, startIndex, startIndex + 1);
  }
}

function addSingleMonthNameIntervals(out: MonthInterval[], line: string, nowYear: number): void {
  for (const m of line.matchAll(/(?:^|[^\p{L}])(\p{L}{3,15})\.?\s*((?:19|20)\d{2}|['’]?\s*\d{2})(?:$|[^\p{L}])/giu)) {
    const month = monthTokenToNumber(String(m[1] ?? ""));
    const year = yearTokenToNumber(String(m[2] ?? ""), nowYear);
    if (!month || year === null) continue;
    if (year < 1950 || year > nowYear + 1) continue;
    const startIndex = toMonthIndex(year, month);
    pushInterval(out, startIndex, startIndex + 1);
  }
}

function extractSingleMonthYearIntervals(text: string, nowYear: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // Only count these when they appear near internship keywords to avoid polluting with education dates.
  const internshipHintRe =
    /\b(stage|stagiaire|intern(?:ship)?|immersion|alternance|apprentissage|trainee|pfe|sfe|fin d['’]etudes)\b/i;

  const hasRangeConnectorRe = /\b(?:to|until|till|through|a|à|au|jusqu)\b|[-‐‑‒–—−]/i;
  const lines = text.split("\n").map((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    if (!shouldCountSingleMonthLine(lines, i, internshipHintRe, hasRangeConnectorRe)) continue;
    const line = lines[i] ?? "";
    addSingleNumericMonthIntervals(out, line, nowYear);
    addSingleMonthNameIntervals(out, line, nowYear);
  }

  return out;
}

// Handle "Since Month YYYY" / "Depuis Month YYYY" patterns (ongoing from date to now)
function extractSinceIntervals(text: string, nowYear: number, nowMonth: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // Patterns: "Since June 2025", "Depuis Mars 2024", "Since 06/2024"
  // eslint-disable-next-line sonarjs/regex-complexity
  const patterns = [
    // "Since Month YYYY" or "Depuis Month YYYY"
    /\b(?:since|depuis)\s+(\p{L}{3,15})\.?\s*((?:19|20)\d{2})\b/giu,
    // "Since MM/YYYY"
    /\b(?:since|depuis)\s+(0?[1-9]|1[0-2])[/.-]((?:19|20)\d{2})\b/gi,
    // "Since YYYY" (assume Jan)
    /\b(?:since|depuis)\s+((?:19|20)\d{2})\b/gi,
  ];

  // Month name pattern
  for (const m of text.matchAll(patterns[0])) {
    const month = monthTokenToNumber(String(m[1] ?? ""));
    const year = yearTokenToNumber(String(m[2] ?? ""), nowYear);
    if (!month || year === null) continue;
    const startIndex = toMonthIndex(year, month);
    const endIndex = toMonthIndex(nowYear, nowMonth) + 1;
    pushInterval(out, startIndex, endIndex);
  }

  // MM/YYYY pattern
  for (const m of text.matchAll(patterns[1])) {
    const month = Number(m[1]);
    const year = yearTokenToNumber(String(m[2] ?? ""), nowYear);
    if (!Number.isFinite(month) || month < 1 || month > 12) continue;
    if (year === null) continue;
    const startIndex = toMonthIndex(year, month);
    const endIndex = toMonthIndex(nowYear, nowMonth) + 1;
    pushInterval(out, startIndex, endIndex);
  }

  // Year only pattern
  for (const m of text.matchAll(patterns[2])) {
    const year = yearTokenToNumber(String(m[1] ?? ""), nowYear);
    if (year === null) continue;
    const startIndex = toMonthIndex(year, 1);
    const endIndex = toMonthIndex(nowYear, nowMonth) + 1;
    pushInterval(out, startIndex, endIndex);
  }

  return out;
}

// Handle "From Month YYYY to Month YYYY" patterns
function extractFromToIntervals(text: string, nowYear: number, nowMonth: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // Pattern: "From September 2021 to July 2024"
  // eslint-disable-next-line sonarjs/regex-complexity
  const re = /\b(?:from|de)\s+(?:(\p{L}{3,15})\.?\s*)?((?:19|20)\d{2})\s+(?:to|à|a)\s+(?:(\p{L}{3,15})\.?\s*)?((?:19|20)\d{2}|present|current|pr[ée]sent|aujourd['']?hui|actuel|ce\s*jour|en\s*cours)\b/giu;

  for (const m of text.matchAll(re)) {
    const startMonthRaw = m[1] ? String(m[1]) : null;
    const startYearRaw = String(m[2] ?? "");
    const endMonthRaw = m[3] ? String(m[3]) : null;
    const endToken = String(m[4] ?? "");

    const startMonth = startMonthRaw ? monthTokenToNumber(startMonthRaw) : 1;
    const startYear = yearTokenToNumber(startYearRaw, nowYear);
    if (!startMonth || startYear === null) continue;

    const endIsPresent = isPresentToken(endToken);

    let endYear = nowYear;
    let endMonth = nowMonth;

    if (!endIsPresent) {
      const parsedEndYear = yearTokenToNumber(endToken, nowYear);
      if (parsedEndYear === null) continue;
      endYear = parsedEndYear;
      endMonth = endMonthRaw ? (monthTokenToNumber(endMonthRaw) ?? 12) : 12;
    }

    const startIndex = toMonthIndex(startYear, startMonth);
    const endIndex = endIsPresent ? toMonthIndex(nowYear, nowMonth) + 1 : toMonthIndex(endYear, endMonth) + 1;
    pushInterval(out, startIndex, endIndex);
  }

  return out;
}

// Handle French "de Month YYYY à Month YYYY" patterns (without "From")
function extractFrenchDeAIntervals(text: string, nowYear: number, nowMonth: number): MonthInterval[] {
  const out: MonthInterval[] = [];

  // Pattern: "de déc. 2024 à ce jour", "de nov. 2022 à sept. 2024", "de mai 2021 à juil. 2022"
  // eslint-disable-next-line sonarjs/regex-complexity
  const re = /\bde\s+(\p{L}{3,15})\.?\s*((?:19|20)\d{2})\s+(?:à|a|au)\s+(?:(\p{L}{3,15})\.?\s*)?((?:19|20)\d{2}|ce\s*jour|aujourd['']?hui|pr[ée]sent|actuel|en\s*cours)\b/giu;

  for (const m of text.matchAll(re)) {
    const startMonth = monthTokenToNumber(String(m[1] ?? ""));
    const startYear = yearTokenToNumber(String(m[2] ?? ""), nowYear);
    if (!startMonth || startYear === null) continue;

    const endMonthRaw = m[3] ? String(m[3]) : null;
    const endToken = String(m[4] ?? "");
    const endIsPresent = isPresentToken(endToken);

    let endYear = nowYear;
    let endMonth = nowMonth;

    if (!endIsPresent) {
      const parsedEndYear = yearTokenToNumber(endToken, nowYear);
      if (parsedEndYear === null) continue;
      endYear = parsedEndYear;
      endMonth = endMonthRaw ? (monthTokenToNumber(endMonthRaw) ?? 12) : 12;
    }

    const startIndex = toMonthIndex(startYear, startMonth);
    const endIndex = endIsPresent ? toMonthIndex(nowYear, nowMonth) + 1 : toMonthIndex(endYear, endMonth) + 1;
    pushInterval(out, startIndex, endIndex);
  }

  return out;
}

function extractDateIntervals(text: string): MonthInterval[] {
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  return [
    ...extractYearRangeIntervals(text, nowYear, nowMonth),
    ...extractMonthNameRangeIntervals(text, nowYear, nowMonth),
    ...extractDayMonthYearRangeIntervals(text, nowYear, nowMonth),
    ...extractMonthNumRangeIntervals(text, nowYear, nowMonth),
    ...extractNumericFullDateRangeIntervals(text, nowYear, nowMonth),
    ...extractSingleMonthYearIntervals(text, nowYear),
    ...extractSinceIntervals(text, nowYear, nowMonth),
    ...extractFromToIntervals(text, nowYear, nowMonth),
    ...extractFrenchDeAIntervals(text, nowYear, nowMonth),
  ];
}

function monthsToYears(totalMonths: number): number | null {
  const years = totalMonths / 12;
  if (!Number.isFinite(years)) return null;
  if (years < 0) return null;
  if (years > 50) return 50;
  return Math.round(years * 10) / 10;
}

function estimateProfessionalYearsFromRoles(roles: ParsedRole[]): number | null {
  const professionalIntervals: MonthInterval[] = [];
  for (const r of roles) {
    const blob = `${r.title}\n${r.textBlock}`;
    if (isInternshipOrAcademicRoleText(blob)) continue;
    pushInterval(professionalIntervals, r.startIndex, r.endIndex);
  }

  if (professionalIntervals.length === 0) return 0;
  const merged = mergeIntervals(professionalIntervals);
  const totalMonths = merged.reduce((sum, i) => sum + (i.end - i.start), 0);
  return monthsToYears(totalMonths);
}

function estimateProfessionalYearsFromIntervals(params: {
  scoped: string;
  fullText: string;
}): number | null {
  let intervals = extractDateIntervals(params.scoped);
  if (intervals.length === 0 && params.scoped !== params.fullText) {
    intervals = extractDateIntervals(params.fullText);
  }

  if (intervals.length === 0) return null;
  if (isInternshipOrAcademicRoleText(params.scoped)) return 0;

  const merged = mergeIntervals(intervals);
  const totalMonths = merged.reduce((sum, i) => sum + (i.end - i.start), 0);
  return monthsToYears(totalMonths);
}

export function estimateYearsExperience(text: string): number | null {
  // We only count full-time professional experience.
  // Internships (stage/intern) and academic end-of-studies projects (PFE/SFE) do NOT count.

  const roles = extractRolesFromExperience(text);
  if (roles.length > 0) {
    return estimateProfessionalYearsFromRoles(roles);
  }

  // Fallback: use date intervals scoped to the experience section, but only if we don't see
  // obvious internship markers (otherwise we'd be counting internships).
  const scoped = extractLikelyExperienceText(text);
  const explicit = parseExplicitYearsExperience(text);

  const intervalEstimate = estimateProfessionalYearsFromIntervals({ scoped, fullText: text });
  if (intervalEstimate !== null) return intervalEstimate;

  // Last resort: accept explicit "X years experience" only when the CV does NOT look like internship-only.
  if (explicit !== null && !isInternshipOrAcademicRoleText(text)) return explicit;
  return null;
}

// ============================================================================
// ROLE-RELEVANT EXPERIENCE EXTRACTION
// ============================================================================

type ParsedRole = {
  title: string;
  startIndex: number;
  endIndex: number;
  months: number;
  textBlock: string;
};

function isProfessionalRole(role: ParsedRole): boolean {
  return !isInternshipOrAcademicRoleText(`${role.title}\n${role.textBlock}`);
}

function extractProfessionalRoles(text: string): ParsedRole[] {
  return extractRolesFromExperience(text).filter(isProfessionalRole);
}

function extractRolesFromExperience(text: string): ParsedRole[] {
  const experienceText = extractLikelyExperienceText(text);
  const lines = experienceText.split("\n");
  const roles: ParsedRole[] = [];

  function findBestTitleLine(beforeIndex: number): string {
    for (let j = beforeIndex; j >= 0; j--) {
      const candidate = lines[j]?.trim() ?? "";
      if (!candidate) continue;
      if (looksLikeSectionHeadingLine(candidate)) continue;
      if (looksLikeSkillListLine(candidate)) continue;
      return candidate;
    }
    return "";
  }

  let currentRoleStart = -1;
  let currentTitle = "";

  function pushRole(textBlock: string, title: string): void {
    const intervals = extractDateIntervals(textBlock);
    const merged = mergeIntervals(intervals);
    const months = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
    if (months <= 0) return;

    const startMonthIndex = merged.at(0)?.start ?? 0;
    const endMonthIndex = merged.at(-1)?.end ?? 0;
    roles.push({
      title,
      startIndex: startMonthIndex,
      endIndex: endMonthIndex,
      months,
      textBlock,
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line) continue;

    // Check if this line contains a date interval (likely part of a role header)
    if (extractDateIntervals(line).length > 0) {
      // If we had a previous role, close it
      if (currentRoleStart >= 0 && currentTitle) {
        const textBlock = lines.slice(currentRoleStart, i).join("\n");
        pushRole(textBlock, currentTitle);
      }

      // Extract title from this line or nearby lines
      // Title is usually on the same line or the line before
      const titleCandidates = [findBestTitleLine(i - 1), findBestTitleLine(i - 2), line];
      currentTitle = titleCandidates.find((t) => t.trim().length > 0) ?? "";
      currentRoleStart = i;
    }
  }

  // Close the last role
  if (currentRoleStart >= 0 && currentTitle) {
    const textBlock = lines.slice(currentRoleStart).join("\n");
    pushRole(textBlock, currentTitle);
  }

  return roles;
}

function isRoleRelevant(role: ParsedRole, relevanceKeywords: string[]): boolean {
  if (relevanceKeywords.length === 0) return true;

  const textLower = (role.title + " " + role.textBlock).toLowerCase();
  const normalizedText = textLower
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "");

  for (const keyword of relevanceKeywords) {
    const normalizedKeyword = keyword.toLowerCase().normalize("NFKD").replaceAll(/\p{Diacritic}/gu, "");
    if (normalizedText.includes(normalizedKeyword)) {
      return true;
    }
  }
  return false;
}

function getRoleRecency(role: ParsedRole): "current" | "recent" | "old" {
  const now = new Date();
  const nowMonthIndex = now.getFullYear() * 12 + now.getMonth();
  const monthsAgo = nowMonthIndex - role.endIndex;

  if (monthsAgo <= 1) return "current";
  if (monthsAgo <= 24) return "recent"; // Within 2 years
  return "old";
}

export function extractRelevantExperience(
  text: string,
  relevanceKeywords: string[],
): RelevantExperienceResult {
  const roles = extractProfessionalRoles(text);
  const totalYears = estimateYearsExperience(text);

  if (roles.length === 0) {
    // Fall back to basic estimation if we can't parse individual roles
    return {
      totalYears,
      relevantYears: relevanceKeywords.length === 0 ? totalYears : null,
      roles: [],
    };
  }

  const parsedRoles = roles.map((role) => ({
    title: role.title.slice(0, 100), // Truncate long titles
    isRelevant: isRoleRelevant(role, relevanceKeywords),
    months: role.months,
    recency: getRoleRecency(role),
  }));

  const relevantMonths = parsedRoles
    .filter((r) => r.isRelevant)
    .reduce((sum, r) => sum + r.months, 0);

  const relevantYears = relevantMonths > 0 ? Math.round((relevantMonths / 12) * 10) / 10 : 0;

  return {
    totalYears,
    relevantYears,
    roles: parsedRoles,
  };
}

// ============================================================================
// SKILL DEPTH SCORING
// ============================================================================

function countSkillMentions(text: string, skill: string, aliases: string[]): number {
  const terms = [skill, ...aliases];
  let count = 0;

  for (const term of terms) {
    const escaped = escapeRegExp(term);
    const re = new RegExp(escaped, "gi");
    const matches = text.match(re);
    count += matches?.length ?? 0;
  }

  return count;
}

function isSkillInExperienceSection(text: string, skill: string, aliases: string[]): boolean {
  const experienceText = extractLikelyExperienceText(text);
  const terms = [skill, ...aliases];

  for (const term of terms) {
    if (experienceText.toLowerCase().includes(term.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function assessContextQuality(text: string, skill: string, aliases: string[]): "high" | "medium" | "low" {
  const terms = [skill, ...aliases];
  const textLower = text.toLowerCase();

  // High quality indicators: production, enterprise, platform, system, led, architected, designed
  const highQualityPatterns = [
    /\b(production|enterprise|platform|system|architecture|led|architected|designed|built|developed|implemented|scaled|optimized)\b/i,
    /\b(\d{2,}[,.]?\d*\s*(users?|clients?|customers?|employees?|companies|establishments?))\b/i,
    /\b(saas|b2b|b2c|startup|company|organization)\b/i,
  ];

  // Medium quality indicators: project, application, feature, integration
  const mediumQualityPatterns = [
    /\b(project|application|feature|integration|module|component|service|api)\b/i,
  ];

  for (const term of terms) {
    const termLower = term.toLowerCase();
    const termIndex = textLower.indexOf(termLower);
    if (termIndex === -1) continue;

    // Get context around the skill mention (200 chars before and after)
    const start = Math.max(0, termIndex - 200);
    const end = Math.min(text.length, termIndex + term.length + 200);
    const context = text.slice(start, end);

    for (const pattern of highQualityPatterns) {
      if (pattern.test(context)) return "high";
    }
    for (const pattern of mediumQualityPatterns) {
      if (pattern.test(context)) return "medium";
    }
  }

  return "low";
}

function isSkillInRecentRole(text: string, skill: string, aliases: string[]): boolean {
  const roles = extractProfessionalRoles(text);
  const recentRoles = roles.filter((r) => getRoleRecency(r) !== "old");

  const terms = [skill, ...aliases];
  for (const role of recentRoles) {
    const roleLower = role.textBlock.toLowerCase();
    for (const term of terms) {
      if (roleLower.includes(term.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

export function calculateSkillDepth(
  text: string,
  skills: RoleSkillSpec[],
  skillAliases: SkillAliases,
): SkillDepthResult[] {
  return skills.map((spec) => {
    const aliases = skillAliases[spec.skill] ?? [];
    const mentionCount = countSkillMentions(text, spec.skill, aliases);
    const inExperienceSection = isSkillInExperienceSection(text, spec.skill, aliases);
    const inRecentRole = isSkillInRecentRole(text, spec.skill, aliases);
    const contextQuality = assessContextQuality(text, spec.skill, aliases);

    // Calculate depth score (0-1)
    let depthScore = 0;

    // Mention frequency (max 0.3)
    const frequencyScore = Math.min(mentionCount / 5, 1) * 0.3;
    depthScore += frequencyScore;

    // In experience section (0.2)
    if (inExperienceSection) depthScore += 0.2;

    // In recent role (0.2)
    if (inRecentRole) depthScore += 0.2;

    // Context quality (0.3)
    if (contextQuality === "high") depthScore += 0.3;
    else if (contextQuality === "medium") depthScore += 0.15;

    return {
      skill: spec.skill,
      mentionCount,
      inExperienceSection,
      inRecentRole,
      contextQuality,
      depthScore: Math.min(depthScore, 1),
    };
  });
}

// ============================================================================
// SENIORITY DETECTION
// ============================================================================

const DEFAULT_SENIORITY_INDICATORS: SeniorityIndicators = {
  senior: ["senior", "sr.", "sr ", "lead", "principal", "staff", "architect", "chef", "responsable", "head", "manager", "director"],
  mid: ["mid", "middle", "confirmed", "confirmé", "intermédiaire"],
  junior: ["junior", "jr.", "jr ", "entry", "débutant", "trainee", "stagiaire", "intern", "stage", "apprenti", "graduate"],
};

export function detectSeniority(
  text: string,
  indicators?: SeniorityIndicators,
): SeniorityResult {
  const ind = indicators ?? DEFAULT_SENIORITY_INDICATORS;
  const textLower = text.toLowerCase().normalize("NFKD").replaceAll(/\p{Diacritic}/gu, "");

  const evidence: string[] = [];
  let seniorScore = 0;
  let juniorScore = 0;

  // Check for senior indicators
  for (const term of ind.senior) {
    const termNorm = term.toLowerCase().normalize("NFKD").replaceAll(/\p{Diacritic}/gu, "");
    if (textLower.includes(termNorm)) {
      seniorScore += 1;
      evidence.push(`Senior indicator: "${term}"`);
    }
  }

  // Check for junior indicators
  for (const term of ind.junior) {
    const termNorm = term.toLowerCase().normalize("NFKD").replaceAll(/\p{Diacritic}/gu, "");
    if (textLower.includes(termNorm)) {
      juniorScore += 1;
      evidence.push(`Junior indicator: "${term}"`);
    }
  }

  // Experience years also indicate seniority
  const years = estimateYearsExperience(text);
  if (years !== null) {
    if (years >= 5) {
      seniorScore += 2;
      evidence.push(`${years}+ years experience`);
    } else if (years >= 3) {
      seniorScore += 1;
      evidence.push(`${years} years experience (mid-level)`);
    } else if (years < 2) {
      juniorScore += 1;
      evidence.push(`${years} years experience (junior-level)`);
    }
  }

  // Quality indicators boost seniority
  const qualityPatterns = [
    { re: /\b(led|managed|architected|designed|mentored|trained)\b/gi, score: 1 },
    { re: /\b(team\s*lead|tech\s*lead|technical\s*lead)\b/gi, score: 2 },
    { re: /\b(\d+)\s*(team\s*members?|developers?|engineers?)/gi, score: 1 },
  ];

  for (const { re, score } of qualityPatterns) {
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      seniorScore += score;
      evidence.push(`Leadership indicator: "${matches[0]}"`);
    }
  }

  // Determine level
  let level: "senior" | "mid" | "junior" | "unknown";
  let confidence: number;

  const netScore = seniorScore - juniorScore;

  if (netScore >= 3) {
    level = "senior";
    confidence = Math.min(0.5 + netScore * 0.1, 0.95);
  } else if (netScore >= 1) {
    level = "mid";
    confidence = 0.5 + netScore * 0.1;
  } else if (netScore <= -1) {
    level = "junior";
    confidence = Math.min(0.5 + Math.abs(netScore) * 0.1, 0.9);
  } else {
    level = "unknown";
    confidence = 0.3;
  }

  return { level, confidence, evidence: evidence.slice(0, 5) };
}

// ============================================================================
// RECENCY ANALYSIS
// ============================================================================

function getSkillLastUsedYear(
  text: string,
  skill: string,
  aliases: string[],
): number | null {
  const roles = extractProfessionalRoles(text);
  if (roles.length === 0) return null;

  const terms = [skill, ...aliases].map((t) => t.toLowerCase());
  const now = new Date();
  const nowYear = now.getFullYear();

  // Sort roles by end date (most recent first)
  const sortedRoles = [...roles].sort((a, b) => b.endIndex - a.endIndex);

  for (const role of sortedRoles) {
    const roleLower = (role.title + " " + role.textBlock).toLowerCase();
    for (const term of terms) {
      if (roleLower.includes(term)) {
        // Convert month index back to year
        const endYear = Math.floor(role.endIndex / 12);
        return Math.min(endYear, nowYear);
      }
    }
  }

  // Check if skill appears anywhere in text (might be in skills section)
  const textLower = text.toLowerCase();
  for (const term of terms) {
    if (textLower.includes(term)) {
      return null; // Found but can't determine when
    }
  }

  return null;
}

function categorizeRecency(lastUsedYear: number | null): {
  category: SkillRecency["recencyCategory"];
  multiplier: number;
} {
  if (lastUsedYear === null) {
    return { category: "unknown", multiplier: 0.7 };
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const yearsAgo = currentYear - lastUsedYear;

  if (yearsAgo <= 1) return { category: "current", multiplier: 1.0 };
  if (yearsAgo <= 3) return { category: "recent", multiplier: 0.85 };
  if (yearsAgo <= 5) return { category: "stale", multiplier: 0.6 };
  return { category: "old", multiplier: 0.3 };
}

function detectCareerTrajectory(text: string): CareerTrajectory {
  const roles = extractProfessionalRoles(text);
  if (roles.length < 2) {
    return { trajectory: "unclear", evidence: ["Not enough roles to determine trajectory"], recentRoleLevel: "unknown" };
  }

  // Sort by start date (oldest first)
  const sortedRoles = [...roles].sort((a, b) => a.startIndex - b.startIndex);

  const seniorTerms = ["senior", "sr.", "lead", "principal", "staff", "architect", "head", "director", "manager"];
  const juniorTerms = ["junior", "jr.", "intern", "stagiaire", "trainee", "entry", "graduate"];

  function getRoleLevel(title: string): number {
    const lower = title.toLowerCase();
    for (const term of seniorTerms) {
      if (lower.includes(term)) return 3;
    }
    for (const term of juniorTerms) {
      if (lower.includes(term)) return 1;
    }
    return 2; // Default to mid
  }

  const levels = sortedRoles.map((r) => ({
    title: r.title,
    level: getRoleLevel(r.title),
  }));

  const evidence: string[] = [];
  let ascending = 0;
  let descending = 0;

  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1];
    const curr = levels[i];
    if (curr.level > prev.level) {
      ascending++;
      evidence.push(`Promotion: ${prev.title} → ${curr.title}`);
    } else if (curr.level < prev.level) {
      descending++;
      evidence.push(`Downgrade: ${prev.title} → ${curr.title}`);
    }
  }

  // Determine most recent role level
  const recentLevel = levels.at(-1)?.level ?? 2;
  const recentRoleLevel: CareerTrajectory["recentRoleLevel"] =
    recentLevel >= 3 ? "senior" : recentLevel === 1 ? "junior" : "mid";

  let trajectory: CareerTrajectory["trajectory"];
  if (ascending > descending && ascending >= 1) {
    trajectory = "ascending";
  } else if (descending > ascending && descending >= 1) {
    trajectory = "descending";
  } else if (levels.length >= 3) {
    trajectory = "stable";
  } else {
    trajectory = "unclear";
  }

  return { trajectory, evidence: evidence.slice(0, 3), recentRoleLevel };
}

export function analyzeRecency(
  text: string,
  skills: RoleSkillSpec[],
  skillAliases: SkillAliases,
): RecencyAnalysis {
  const skillRecency: SkillRecency[] = skills.map((spec) => {
    const aliases = skillAliases[spec.skill] ?? [];
    const lastUsedYear = getSkillLastUsedYear(text, spec.skill, aliases);
    const { category, multiplier } = categorizeRecency(lastUsedYear);

    return {
      skill: spec.skill,
      lastUsedYear,
      recencyCategory: category,
      recencyMultiplier: multiplier,
    };
  });

  const careerTrajectory = detectCareerTrajectory(text);

  // Calculate overall recency score
  const validRecencies = skillRecency.filter((s) => s.recencyCategory !== "unknown");
  const avgMultiplier = validRecencies.length > 0
    ? validRecencies.reduce((sum, s) => sum + s.recencyMultiplier, 0) / validRecencies.length
    : 0.7;

  // Adjust based on career trajectory
  let trajectoryBonus = 0;
  if (careerTrajectory.trajectory === "ascending") trajectoryBonus = 0.1;
  else if (careerTrajectory.trajectory === "descending") trajectoryBonus = -0.15;

  const recencyScore = Math.max(0, Math.min(1, avgMultiplier + trajectoryBonus));

  return { skillRecency, careerTrajectory, recencyScore };
}

// ============================================================================
// RED FLAG DETECTION
// ============================================================================

type RoleWithDates = {
  title: string;
  startMonthIndex: number;
  endMonthIndex: number;
  durationMonths: number;
};

function extractRolesWithDates(text: string): RoleWithDates[] {
  const roles = extractProfessionalRoles(text);
  return roles.map((r) => ({
    title: r.title,
    startMonthIndex: r.startIndex,
    endMonthIndex: r.endIndex,
    durationMonths: r.months,
  }));
}

function detectJobHopping(roles: RoleWithDates[]): RedFlag[] {
  const flags: RedFlag[] = [];
  const now = new Date();
  const nowMonthIndex = now.getFullYear() * 12 + now.getMonth();

  // Only consider roles in the last 5 years
  const recentRoles = roles.filter((r) => nowMonthIndex - r.endMonthIndex < 60);

  // Count short stints (< 12 months)
  const shortStints = recentRoles.filter((r) => r.durationMonths < 12 && r.durationMonths > 0);

  if (shortStints.length >= 3) {
    flags.push({
      type: "job_hopping",
      severity: "high",
      evidence: `${shortStints.length} jobs lasted less than 1 year in last 5 years`,
      penalty: 10,
    });
  } else if (shortStints.length === 2) {
    flags.push({
      type: "job_hopping",
      severity: "medium",
      evidence: `${shortStints.length} jobs lasted less than 1 year`,
      penalty: 5,
    });
  }

  return flags;
}

function detectEmploymentGaps(roles: RoleWithDates[]): RedFlag[] {
  const flags: RedFlag[] = [];

  if (roles.length < 2) return flags;

  // Sort by end date
  const sorted = [...roles].sort((a, b) => a.endMonthIndex - b.endMonthIndex);

  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].endMonthIndex;
    const currStart = sorted[i].startMonthIndex;
    const gapMonths = currStart - prevEnd;

    if (gapMonths > 24) {
      flags.push({
        type: "employment_gap",
        severity: "high",
        evidence: `${Math.round(gapMonths / 12)} year gap between roles`,
        penalty: 8,
      });
    } else if (gapMonths > 12) {
      flags.push({
        type: "employment_gap",
        severity: "medium",
        evidence: `${gapMonths} month gap between roles`,
        penalty: 4,
      });
    }
  }

  return flags;
}

function detectTitleInflation(text: string, roles: RoleWithDates[]): RedFlag[] {
  const flags: RedFlag[] = [];
  const totalYears = estimateYearsExperience(text);

  if (totalYears === null) return flags;

  const seniorTitles = ["senior", "sr.", "lead", "principal", "staff", "architect"];
  const hasSeniorTitle = roles.some((r) => {
    const lower = r.title.toLowerCase();
    return seniorTitles.some((t) => lower.includes(t));
  });

  if (hasSeniorTitle && totalYears < 2) {
    flags.push({
      type: "title_inflation",
      severity: "high",
      evidence: `Senior title with only ${totalYears} years experience`,
      penalty: 10,
    });
  } else if (hasSeniorTitle && totalYears < 3) {
    flags.push({
      type: "title_inflation",
      severity: "medium",
      evidence: `Senior title with ${totalYears} years experience`,
      penalty: 5,
    });
  }

  // Check for Lead/Principal with < 4 years
  const leadershipTitles = ["lead", "principal", "architect", "head", "director"];
  const hasLeadershipTitle = roles.some((r) => {
    const lower = r.title.toLowerCase();
    return leadershipTitles.some((t) => lower.includes(t));
  });

  if (hasLeadershipTitle && totalYears < 4) {
    flags.push({
      type: "title_inflation",
      severity: "high",
      evidence: `Leadership title with only ${totalYears} years experience`,
      penalty: 8,
    });
  }

  return flags;
}

function detectCareerRegression(roles: RoleWithDates[]): RedFlag[] {
  const flags: RedFlag[] = [];

  if (roles.length < 2) return flags;

  // Sort by start date (oldest first)
  const sorted = [...roles].sort((a, b) => a.startMonthIndex - b.startMonthIndex);

  const seniorTerms = ["senior", "lead", "principal", "staff", "architect", "head", "director"];
  const juniorTerms = ["junior", "intern", "trainee", "entry"];

  for (let i = 1; i < sorted.length; i++) {
    const prevTitle = sorted[i - 1].title.toLowerCase();
    const currTitle = sorted[i].title.toLowerCase();

    const prevWasSenior = seniorTerms.some((t) => prevTitle.includes(t));
    const currIsJunior = juniorTerms.some((t) => currTitle.includes(t));

    if (prevWasSenior && currIsJunior) {
      flags.push({
        type: "career_regression",
        severity: "medium",
        evidence: `Moved from senior role to junior: ${sorted[i - 1].title} → ${sorted[i].title}`,
        penalty: 5,
      });
    }
  }

  return flags;
}

export function detectRedFlags(text: string): RedFlagAnalysis {
  const roles = extractRolesWithDates(text);

  const allFlags: RedFlag[] = [
    ...detectJobHopping(roles),
    ...detectEmploymentGaps(roles),
    ...detectTitleInflation(text, roles),
    ...detectCareerRegression(roles),
  ];

  // Cap total penalty at 25
  const totalPenalty = Math.min(
    25,
    allFlags.reduce((sum, f) => sum + f.penalty, 0),
  );

  return { flags: allFlags, totalPenalty };
}

// ============================================================================
// PROJECT SCALE SIGNALS
// ============================================================================

function extractUserScale(text: string): number | null {
  const patterns = [
    /(\d{1,3}(?:[,.\s]\d{3})*)\s*(?:\+\s*)?(users?|clients?|customers?|utilisateurs?)/gi,
    /(?:serving|supporting|handling)\s*(\d{1,3}(?:[,.\s]\d{3})*)\s*(?:\+\s*)?(users?|clients?)/gi,
    /(\d{1,3}(?:[,.\s]\d{3})*)\s*(?:\+\s*)?(employees?|employés?|salariés?)/gi,
  ];

  let maxScale = 0;

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const numStr = match[1].replaceAll(/[,.\s]/g, "");
      const num = Number.parseInt(numStr, 10);
      if (Number.isFinite(num) && num > maxScale) {
        maxScale = num;
      }
    }
  }

  return maxScale > 0 ? maxScale : null;
}

function extractTeamSize(text: string): number | null {
  const patterns = [
    /(?:team\s*of|équipe\s*de)\s*(\d{1,3})/gi,
    /(\d{1,3})\s*(?:team\s*members?|developers?|engineers?|développeurs?)/gi,
    /(?:managed|led|mentored)\s*(\d{1,3})\s*(?:people|developers?|engineers?)/gi,
  ];

  let maxSize = 0;

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const num = Number.parseInt(match[1], 10);
      if (Number.isFinite(num) && num > maxSize && num < 500) {
        maxSize = num;
      }
    }
  }

  return maxSize > 0 ? maxSize : null;
}

function detectCompanyTypes(text: string): ProjectScaleSignals["companyTypes"] {
  const types: ProjectScaleSignals["companyTypes"] = [];
  const textLower = text.toLowerCase();

  const enterprisePatterns = [
    /\b(enterprise|fortune\s*500|multinational|large[- ]scale|corporate)\b/i,
    /\b(bank|banking|insurance|telecom|healthcare)\b/i,
  ];

  const startupPatterns = [
    /\b(startup|start-up|early[- ]stage|seed|series\s*[a-c]|scale-up)\b/i,
  ];

  const agencyPatterns = [
    /\b(agency|agence|consulting|consultancy|digital\s*agency)\b/i,
  ];

  const freelancePatterns = [
    /\b(freelance|freelancer|indépendant|self[- ]employed|contractor)\b/i,
  ];

  for (const pattern of enterprisePatterns) {
    if (pattern.test(textLower)) {
      types.push("enterprise");
      break;
    }
  }

  for (const pattern of startupPatterns) {
    if (pattern.test(textLower)) {
      types.push("startup");
      break;
    }
  }

  for (const pattern of agencyPatterns) {
    if (pattern.test(textLower)) {
      types.push("agency");
      break;
    }
  }

  for (const pattern of freelancePatterns) {
    if (pattern.test(textLower)) {
      types.push("freelance");
      break;
    }
  }

  return types;
}

function extractImpactIndicators(text: string): string[] {
  const indicators: string[] = [];
  const textLower = text.toLowerCase();

  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /\b(production|production-ready|deployed|live)\b/i, label: "production" },
    { re: /\b(saas|software as a service)\b/i, label: "SaaS" },
    { re: /\b(b2b|business to business)\b/i, label: "B2B" },
    { re: /\b(b2c|business to consumer)\b/i, label: "B2C" },
    { re: /\b(platform|plateforme)\b/i, label: "platform" },
    { re: /\b(microservices|micro-services)\b/i, label: "microservices" },
    { re: /\b(high[- ]availability|ha|99\.9)/i, label: "high-availability" },
    { re: /\b(scaled|scaling|scalable|horizontal\s*scaling)\b/i, label: "scaled" },
    { re: /\b(real[- ]time|realtime|temps réel)\b/i, label: "real-time" },
  ];

  for (const { re, label } of patterns) {
    if (re.test(textLower) && !indicators.includes(label)) {
      indicators.push(label);
    }
  }

  return indicators;
}

export function analyzeProjectScale(text: string): ProjectScaleSignals {
  const maxUserScale = extractUserScale(text);
  const maxTeamSize = extractTeamSize(text);
  const companyTypes = detectCompanyTypes(text);
  const impactIndicators = extractImpactIndicators(text);

  // Calculate scale score
  let scaleScore = 0.3; // Base score

  // User scale contribution (max 0.3)
  if (maxUserScale !== null) {
    if (maxUserScale >= 100000) scaleScore += 0.3;
    else if (maxUserScale >= 10000) scaleScore += 0.25;
    else if (maxUserScale >= 1000) scaleScore += 0.15;
    else if (maxUserScale >= 100) scaleScore += 0.1;
  }

  // Team size contribution (max 0.2)
  if (maxTeamSize !== null) {
    if (maxTeamSize >= 20) scaleScore += 0.2;
    else if (maxTeamSize >= 10) scaleScore += 0.15;
    else if (maxTeamSize >= 5) scaleScore += 0.1;
  }

  // Company type contribution (max 0.1)
  if (companyTypes.includes("enterprise")) scaleScore += 0.1;
  else if (companyTypes.includes("startup")) scaleScore += 0.05;

  // Impact indicators contribution (max 0.1)
  scaleScore += Math.min(0.1, impactIndicators.length * 0.02);

  return {
    maxUserScale,
    maxTeamSize,
    companyTypes,
    impactIndicators,
    scaleScore: Math.min(1, scaleScore),
  };
}

// ============================================================================
// EDUCATION ANALYSIS
// ============================================================================

function extractEducationSection(text: string): string {
  const lines = text.split("\n");
  const normalizedLines = lines.map(normalizeHeadingToken);

  const educationHeads = new Set([
    "education",
    "formation",
    "formations",
    "diplome",
    "diplomes",
    "academics",
    "academic",
    "etudes",
    "parcours",
  ]);

  const endHeads = new Set([
    "experience",
    "experiences",
    "skills",
    "competences",
    "projects",
    "certifications",
    "languages",
  ]);

  let startLine = -1;
  for (let i = 0; i < normalizedLines.length; i++) {
    const token = normalizedLines[i];
    if (!token) continue;
    if (educationHeads.has(token) || token.startsWith("education") || token.startsWith("formation")) {
      startLine = i;
      break;
    }
  }

  if (startLine === -1) return "";

  let endLine = lines.length;
  for (let i = startLine + 1; i < normalizedLines.length; i++) {
    const token = normalizedLines[i];
    if (!token) continue;
    if (endHeads.has(token)) {
      endLine = i;
      break;
    }
  }

  return lines.slice(startLine, endLine).join("\n");
}

function extractDegrees(text: string): Degree[] {
  const educationText = extractEducationSection(text);
  const fullText = educationText || text;
  const degrees: Degree[] = [];

  const degreePatterns: Array<{ re: RegExp; type: Degree["type"] }> = [
    { re: /\b(ph\.?d|doctorate|doctorat)\b/i, type: "phd" },
    { re: /\b(master|msc|m\.s\.|mba|mastère|ingénieur|diplôme d'ingénieur)\b/i, type: "masters" },
    { re: /\b(bachelor|bsc|b\.s\.|licence|licencié|undergraduate)\b/i, type: "bachelors" },
    { re: /\b(associate|bts|dut|deug)\b/i, type: "associate" },
    { re: /\b(bootcamp|coding school|gomycode|ironhack|le wagon|hack reactor|general assembly|rbk|reboot kamp)\b/i, type: "bootcamp" },
  ];

  const csFieldPatterns = [
    /\b(computer science|informatique|génie logiciel|software engineering|cs degree)\b/i,
    /\b(computer engineering|génie informatique)\b/i,
  ];

  const engineeringPatterns = [
    /\b(engineering|ingénieur|ingénierie|engineer)\b/i,
    /\b(electrical|electronics|mécatronique|mechatronics)\b/i,
  ];

  for (const { re, type } of degreePatterns) {
    const match = re.exec(fullText);
    if (match) {
      // Try to determine field
      let field: Degree["field"] = "unknown";
      const context = fullText.slice(Math.max(0, match.index - 100), match.index + 200);

      for (const pattern of csFieldPatterns) {
        if (pattern.test(context)) {
          field = "cs";
          break;
        }
      }

      if (field === "unknown") {
        for (const pattern of engineeringPatterns) {
          if (pattern.test(context)) {
            field = "engineering";
            break;
          }
        }
      }

      // Try to extract year
      const yearMatch = /\b(19|20)\d{2}\b/.exec(context);
      const year = yearMatch ? Number.parseInt(yearMatch[0], 10) : null;

      // Try to extract institution (simplified)
      const institutionMatch = /(?:at|from|@|de|à)\s+([A-Z][A-Za-z\s]+(?:University|Institute|School|College|Université|École|Institut))/i.exec(context);
      const institution = institutionMatch?.[1]?.trim() ?? "";

      degrees.push({ type, field, institution, year });
    }
  }

  return degrees;
}

function extractCertifications(text: string): Certification[] {
  const certs: Certification[] = [];

  const relevantCertPatterns = [
    /\b(aws\s*(?:certified|solutions architect|developer|sysops))/gi,
    /\b(google\s*cloud\s*(?:certified|professional))/gi,
    /\b(azure\s*(?:certified|developer|administrator))/gi,
    /\b(kubernetes\s*(?:certified|cka|ckad))/gi,
    /\b(scrum\s*(?:master|certified|psm|csm))/gi,
    /\b(pmp|project\s*management\s*professional)/gi,
    /\b(cisco\s*(?:ccna|ccnp|certified))/gi,
    /\b(comptia\s*(?:a\+|network\+|security\+))/gi,
  ];

  for (const pattern of relevantCertPatterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[0].trim();
      if (!certs.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        certs.push({ name, isRelevant: true });
      }
    }
  }

  return certs;
}

export function analyzeEducation(text: string): EducationAnalysis {
  const degrees = extractDegrees(text);
  const certifications = extractCertifications(text);

  // Determine highest relevant degree
  const degreeRank: Record<Degree["type"], number> = {
    phd: 6,
    masters: 5,
    bachelors: 4,
    associate: 3,
    bootcamp: 2,
    certification: 1,
    unknown: 0,
  };

  let highestRelevantDegree: Degree["type"] | null = null;
  let highestScore = 0;

  for (const degree of degrees) {
    const isRelevant = degree.field === "cs" || degree.field === "engineering";
    const score = degreeRank[degree.type] * (isRelevant ? 1.5 : 1);
    if (score > highestScore) {
      highestScore = score;
      highestRelevantDegree = degree.type;
    }
  }

  // Calculate education score (for senior roles, this matters less)
  let educationScore = 0.5; // Base score

  if (highestRelevantDegree) {
    switch (highestRelevantDegree) {
      case "phd":
        educationScore = 1.0;
        break;
      case "masters":
        educationScore = 0.9;
        break;
      case "bachelors":
        educationScore = 0.8;
        break;
      case "associate":
        educationScore = 0.6;
        break;
      case "bootcamp":
        educationScore = 0.55;
        break;
      default:
        educationScore = 0.5;
    }
  }

  // Boost for relevant certifications
  const relevantCerts = certifications.filter((c) => c.isRelevant);
  educationScore = Math.min(1, educationScore + relevantCerts.length * 0.05);

  return {
    degrees,
    certifications,
    highestRelevantDegree,
    educationScore,
  };
}

function calculateParseQuality(
  text: string,
  datesParsed: number,
  experienceSectionFound: boolean,
  skillsMatched: number,
  totalSkills: number,
): ParseQuality {
  const issues: string[] = [];
  let confidenceScore = 0;

  // Text extraction quality
  let textExtraction: ParseQuality["textExtraction"] = "good";
  if (text.length < 200) {
    textExtraction = "poor";
    issues.push("Very low text extraction (< 200 chars)");
    confidenceScore -= 0.3;
  } else if (text.length < 500) {
    textExtraction = "partial";
    issues.push("Low text extraction (< 500 chars)");
    confidenceScore -= 0.15;
  } else if (text.length > 1000) {
    confidenceScore += 0.2;
  }

  // Check for garbled text (OCR issues)
  const garbledRatio = (text.match(/[^\x00-\x7F\u00C0-\u024F\u0600-\u06FF]/g) || []).length / text.length;
  if (garbledRatio > 0.1) {
    issues.push("Possible OCR issues detected");
    confidenceScore -= 0.1;
  }

  // Date parsing success
  if (datesParsed === 0) {
    issues.push("No dates parsed from CV");
    confidenceScore -= 0.25;
  } else if (datesParsed >= 3) {
    confidenceScore += 0.15;
  } else {
    confidenceScore += 0.05;
  }

  // Experience section detection
  if (experienceSectionFound) {
    confidenceScore += 0.15;
  } else {
    issues.push("Experience section not clearly identified");
    confidenceScore -= 0.1;
  }

  // Skills matching
  const skillMatchRatio = totalSkills > 0 ? skillsMatched / totalSkills : 0;
  if (skillMatchRatio >= 0.3) {
    confidenceScore += 0.2;
  } else if (skillMatchRatio > 0) {
    confidenceScore += 0.1;
  } else {
    issues.push("No skills matched from CV");
    confidenceScore -= 0.15;
  }

  // Normalize confidence to 0-1
  const confidence = Math.max(0, Math.min(1, 0.5 + confidenceScore));

  // Determine overall quality
  let overall: ParseQuality["overall"];
  if (confidence >= 0.7 && issues.length === 0) {
    overall = "high";
  } else if (confidence >= 0.4 && issues.length <= 2) {
    overall = "medium";
  } else {
    overall = "low";
  }

  return {
    overall,
    confidence,
    textExtraction,
    datesParsed,
    experienceSectionFound,
    skillsMatched,
    issues,
  };
}

export function extractFeatures(params: {
  text: string;
  mustHaveSkills: RoleSkillSpec[];
  niceToHaveSkills: RoleSkillSpec[];
  keywords: string[];
  skillAliases: SkillAliases;
  experienceRelevanceKeywords?: string[];
  seniorityIndicators?: SeniorityIndicators;
}): ExtractedFeatures {
  const warnings: string[] = [];

  if (params.text.length < 200) {
    warnings.push("Low extracted text. OCR fallback may be needed, scoring may be less accurate.");
  }

  const lines = toLines(params.text);
  const fuse = lines.length
    ? new Fuse(lines, {
        includeScore: true,
        threshold: 0.25,
        ignoreLocation: true,
        minMatchCharLength: 3,
      })
    : null;

  const mustHave = params.mustHaveSkills.map((s) => matchSkill(params.text, lines, fuse, s, params.skillAliases));
  const niceToHave = params.niceToHaveSkills.map((s) => matchSkill(params.text, lines, fuse, s, params.skillAliases));
  const keywordHits = params.keywords.map((k) => matchKeyword(params.text, lines, fuse, k));
  const yearsExperience = estimateYearsExperience(params.text);

  // Extract relevant experience (filtered by role keywords)
  const relevantExperience = extractRelevantExperience(
    params.text,
    params.experienceRelevanceKeywords ?? [],
  );

  // Calculate skill depth for must-have skills
  const allSkills = [...params.mustHaveSkills, ...params.niceToHaveSkills];
  const skillDepth = calculateSkillDepth(params.text, allSkills, params.skillAliases);

  // Detect seniority level
  const seniority = detectSeniority(params.text, params.seniorityIndicators);

  // Analyze skill recency and career trajectory
  const recencyAnalysis = analyzeRecency(params.text, allSkills, params.skillAliases);

  // Detect red flags (job hopping, gaps, title inflation)
  const redFlags = detectRedFlags(params.text);

  // Analyze project scale and enterprise experience
  const projectScale = analyzeProjectScale(params.text);

  // Analyze education and certifications
  const education = analyzeEducation(params.text);

  // Add warnings for potential issues
  if (relevantExperience.relevantYears !== null && relevantExperience.totalYears !== null) {
    const relevanceRatio = relevantExperience.relevantYears / relevantExperience.totalYears;
    if (relevanceRatio < 0.5 && relevantExperience.totalYears > 2) {
      warnings.push(
        `Only ${relevantExperience.relevantYears}/${relevantExperience.totalYears} years appear role-relevant.`,
      );
    }
  }

  if (seniority.level === "junior" && seniority.confidence > 0.6) {
    warnings.push("Candidate appears to be junior level based on title/experience indicators.");
  }

  // Add red flag warnings
  for (const flag of redFlags.flags) {
    if (flag.severity === "high") {
      warnings.push(`⚠️ ${flag.evidence}`);
    }
  }

  // Add recency warnings
  if (recencyAnalysis.careerTrajectory.trajectory === "descending") {
    warnings.push("Career trajectory appears to be descending (title downgrade detected).");
  }

  // Calculate parse quality
  const experienceText = extractLikelyExperienceText(params.text);
  const experienceSectionFound = experienceText !== params.text && experienceText.length > 50;
  const dateIntervals = extractDateIntervals(experienceText);
  const skillsMatched = mustHave.filter((s) => s.matched).length + niceToHave.filter((s) => s.matched).length;
  const totalSkills = mustHave.length + niceToHave.length;

  const parseQuality = calculateParseQuality(
    params.text,
    dateIntervals.length,
    experienceSectionFound,
    skillsMatched,
    totalSkills,
  );

  // Add parse quality warnings
  for (const issue of parseQuality.issues) {
    if (!warnings.includes(issue)) {
      warnings.push(issue);
    }
  }

  return {
    mustHave,
    niceToHave,
    keywordHits,
    yearsExperience,
    relevantExperience,
    skillDepth,
    seniority,
    recencyAnalysis,
    redFlags,
    projectScale,
    education,
    parseQuality,
    warnings,
  };
}


