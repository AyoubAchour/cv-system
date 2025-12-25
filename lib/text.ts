export function normalizeText(raw: string): string {
  // Normalize common PDF text artifacts while preserving line breaks for evidence snippets.
  let text = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  // Non‑breaking space shows up frequently in PDF extraction.
  text = text.replaceAll("\u00a0", " ");

  // Soft hyphen (often inserted for hyphenation) should be removed.
  text = text.replaceAll("\u00ad", "");

  // Some PDFs include embedded NUL/control chars.
  // NUL often behaves like a separator (sometimes replacing a dash in date ranges).
  text = text.replaceAll("\u0000", " - ");
  // Keep \n and \t, but remove the rest of ASCII control chars.
  // eslint-disable-next-line no-control-regex
  text = text.replaceAll(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

  // De-hyphenate line breaks: "micro-\nservices" -> "microservices".
  // This improves keyword/skill matching without OCR.
  text = text.replaceAll(/(\p{L})-\n(\p{L})/gu, "$1$2");

  const lines = text.split("\n").map((line) => line.replaceAll(/[ \t]+/g, " ").trimEnd());

  // Collapse large blank runs but preserve line breaks for evidence.
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    const isBlank = line.trim().length === 0;
    if (isBlank) {
      blankRun += 1;
      if (blankRun <= 2) out.push("");
      continue;
    }
    blankRun = 0;
    out.push(line);
  }

  return out.join("\n").trim();
}

export function toLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function truncateMiddle(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const head = Math.floor((maxLen - 3) / 2);
  const tail = maxLen - 3 - head;
  return s.slice(0, head) + "..." + s.slice(s.length - tail);
}

export function lineSnippetAtIndex(text: string, index: number, maxLen = 220): string {
  const start = Math.max(0, text.lastIndexOf("\n", index) + 1);
  const end = text.indexOf("\n", index);
  const line = (end === -1 ? text.slice(start) : text.slice(start, end)).trim();
  if (line.length > 0) return truncateMiddle(line, maxLen);

  // Fallback: small context window.
  const contextStart = Math.max(0, index - 80);
  const contextEnd = Math.min(text.length, index + 140);
  return truncateMiddle(text.slice(contextStart, contextEnd).replaceAll(/\s+/g, " ").trim(), maxLen);
}


