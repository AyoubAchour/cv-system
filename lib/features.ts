import "server-only";

import Fuse from "fuse.js";

import { lineSnippetAtIndex, toLines, truncateMiddle } from "@/lib/text";
import type { KeywordHit, SkillMatch } from "@/lib/scoring";

export type RoleSkillSpec = { skill: string; weight: number };
export type SkillAliases = Record<string, string[]>;

export type ExtractedFeatures = {
  mustHave: SkillMatch[];
  niceToHave: SkillMatch[];
  keywordHits: KeywordHit[];
  yearsExperience: number | null;
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
    .replaceAll("’", "'")
    .replaceAll(/\s+/g, " ")
    .replaceAll("à", "a");
  return (
    t === "present" ||
    t === "current" ||
    t === "présent" ||
    t === "actuel" ||
    t === "aujourd'hui" ||
    t === "aujourd’hui" ||
    t === "a ce jour" ||
    t === "ce jour" ||
    t === "to date" ||
    t === "today" ||
    t === "en cours" ||
    t === "ongoing"
  );
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
    "certification",
    "certifications",
    "project",
    "projects",
    "projet",
    "projets",
    "academicproject",
    "academicprojects",
    "languages",
    "langues",
  ]);

  const lines = text.split("\n");
  const normalizedLines = lines.map(normalizeHeadingToken);

  let startLine = -1;
  for (let i = 0; i < normalizedLines.length; i++) {
    const token = normalizedLines[i];
    if (!token) continue;
    if (startHeads.has(token)) {
      startLine = i;
      break;
    }
    // Catch headings that include extra words but still start with a known head.
    if (token.startsWith("experience") || token.startsWith("experiences")) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return text;

  let endLine = lines.length;
  for (let i = startLine + 1; i < normalizedLines.length; i++) {
    const token = normalizedLines[i];
    if (!token) continue;
    if (endHeads.has(token)) {
      endLine = i;
      break;
    }
  }

  // Skip the heading line itself.
  return lines.slice(startLine + 1, endLine).join("\n");
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
  ];
}

export function estimateYearsExperience(text: string): number | null {
  const explicit = parseExplicitYearsExperience(text);
  if (explicit !== null) return explicit;

  const scoped = extractLikelyExperienceText(text);
  let intervals = extractDateIntervals(scoped);
  // If we fail to detect any date interval in the scoped "Experience" section, fall back to full text.
  // This helps with multi-column PDFs where headings/sections can be interleaved in extraction order.
  if (intervals.length === 0 && scoped !== text) {
    intervals = extractDateIntervals(text);
  }
  if (intervals.length === 0) return null;

  const merged = mergeIntervals(intervals);
  const totalMonths = merged.reduce((sum, i) => sum + (i.end - i.start), 0);
  const years = totalMonths / 12;
  if (!Number.isFinite(years)) return null;
  if (years < 0) return null;
  if (years > 50) return 50;
  return Math.round(years * 10) / 10;
}

export function extractFeatures(params: {
  text: string;
  mustHaveSkills: RoleSkillSpec[];
  niceToHaveSkills: RoleSkillSpec[];
  keywords: string[];
  skillAliases: SkillAliases;
}): ExtractedFeatures {
  const warnings: string[] = [];

  if (params.text.length < 200) {
    warnings.push("Low extracted text. OCR fallback is not implemented yet, scoring may be less accurate.");
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

  return { mustHave, niceToHave, keywordHits, yearsExperience, warnings };
}


