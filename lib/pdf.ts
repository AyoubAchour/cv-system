import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PDFParse } from "pdf-parse";

export type PdfParseSummary = {
  text: string;
  numpages: number | null;
};

export type PdfLinkAnnotation = {
  url: string;
  rect: [number, number, number, number] | null;
  page: number;
};

export type PdfOcrResult = {
  text: string;
  numpages: number;
  usedPages: number;
};

export type PdfOcrOptions = {
  languages: string[];
  tessdataDir: string;
  maxPages?: number;
  scale?: number;
};

let workerConfigured = false;

function ensurePdfJsWorkerConfigured(): void {
  if (workerConfigured) return;
  workerConfigured = true;

  // In Next.js dev, pdfjs-dist can be bundled into `.next/.../chunks`, so the default
  // relative "./pdf.worker.mjs" path breaks. Point it explicitly at the real file in node_modules.
  const workerFsPath = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
  const workerPath = pathToFileURL(workerFsPath).toString();
  PDFParse.setWorker(workerPath);
}

function getPdfJsWorkerSrc(): string {
  const workerFsPath = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
  return pathToFileURL(workerFsPath).toString();
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function extractPdfText(buffer: Buffer): Promise<PdfParseSummary> {
  ensurePdfJsWorkerConfigured();
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    const text = typeof textResult.text === "string" ? textResult.text : "";
    const numpages = typeof textResult.total === "number" ? textResult.total : null;
    return { text, numpages };
  } finally {
    await parser.destroy();
  }
}

function coerceAnnotationUrl(ann: unknown): string | null {
  if (!ann || typeof ann !== "object") return null;
  const obj = ann as Record<string, unknown>;
  const url = typeof obj.url === "string" ? obj.url : null;
  if (url) return url;
  const unsafeUrl = typeof obj.unsafeUrl === "string" ? obj.unsafeUrl : null;
  if (unsafeUrl) return unsafeUrl;
  return null;
}

function coerceAnnotationRect(ann: unknown): [number, number, number, number] | null {
  if (!ann || typeof ann !== "object") return null;
  const obj = ann as Record<string, unknown>;
  const rect = obj.rect;
  if (!Array.isArray(rect) || rect.length !== 4) return null;
  const nums = rect.map(Number);
  const [x1, y1, x2, y2] = nums;
  if ([x1, y1, x2, y2].some((n) => !Number.isFinite(n))) return null;
  return [x1, y1, x2, y2];
}

function normalizeLinkUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  if (u.length > 2048) return null;
  return u;
}

export async function extractPdfLinkAnnotations(buffer: Buffer, options?: { maxPages?: number }): Promise<PdfLinkAnnotation[]> {
  const maxPages =
    typeof options?.maxPages === "number" && options.maxPages > 0 ? Math.floor(options.maxPages) : 1;

  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = getPdfJsWorkerSrc();

  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;

  const usedPages = Math.min(doc.numPages, maxPages);
  const out: PdfLinkAnnotation[] = [];

  for (let pageNum = 1; pageNum <= usedPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const annotations = await page.getAnnotations();
    for (const ann of annotations ?? []) {
      const raw = coerceAnnotationUrl(ann);
      if (!raw) continue;
      const url = normalizeLinkUrl(raw);
      if (!url) continue;
      const rect = coerceAnnotationRect(ann);
      out.push({ url, rect, page: pageNum });
    }
  }

  return out;
}

export async function extractPdfLinkUrls(buffer: Buffer, options?: { maxPages?: number }): Promise<string[]> {
  const urls = new Set<string>();

  for (const ann of await extractPdfLinkAnnotations(buffer, options)) urls.add(ann.url);

  return Array.from(urls);
}

async function ensureTessdataFiles(params: { languages: string[]; tessdataDir: string }): Promise<void> {
  await fs.mkdir(params.tessdataDir, { recursive: true });

  const missing: string[] = [];

  for (const lang of params.languages) {
    const trained = path.join(params.tessdataDir, `${lang}.traineddata`);
    const trainedGz = path.join(params.tessdataDir, `${lang}.traineddata.gz`);

    // If either exists, we're good (tesseract.js prefers .traineddata from cache).
    try {
      await fs.access(trained);
      continue;
    } catch {
      // ignore
    }

    try {
      await fs.access(trainedGz);
      continue;
    } catch {
      // ignore
    }

    // Auto-provision from npm language packages (offline-friendly at runtime).
    const packagedGz = path.join(
      process.cwd(),
      "node_modules",
      "@tesseract.js-data",
      lang,
      "4.0.0",
      `${lang}.traineddata.gz`,
    );

    try {
      await fs.access(packagedGz);
      await fs.copyFile(packagedGz, trainedGz);
    } catch {
      missing.push(`${lang}.traineddata.gz`);
    }
  }

  if (missing.length) {
    throw new Error(
      `OCR language data missing. Install "@tesseract.js-data/eng" and "@tesseract.js-data/fra", or place ${missing.join(
        ", ",
      )} into ${params.tessdataDir}.`,
    );
  }
}

export async function ocrPdfText(buffer: Buffer, options: PdfOcrOptions): Promise<PdfOcrResult> {
  const maxPages = typeof options.maxPages === "number" && options.maxPages > 0 ? Math.floor(options.maxPages) : 6;
  const scale = typeof options.scale === "number" && options.scale > 0 ? options.scale : 2;

  if (!options.languages.length) {
    throw new Error("OCR languages are required (e.g. ['eng','fra']).");
  }
  if (!options.tessdataDir) {
    throw new Error("OCR tessdataDir is required.");
  }

  await ensureTessdataFiles({ languages: options.languages, tessdataDir: options.tessdataDir });

  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = getPdfJsWorkerSrc();

  const { createCanvas } = await import("@napi-rs/canvas");
  const { createWorker } = await import("tesseract.js");

  const tesseractWorkerPath = path.join(
    process.cwd(),
    "node_modules",
    "tesseract.js",
    "src",
    "worker-script",
    "node",
    "index.js",
  );

  const worker = await createWorker(options.languages, 1, {
    workerPath: tesseractWorkerPath,
    langPath: options.tessdataDir,
    cachePath: options.tessdataDir,
    gzip: true,
    // Keep caching enabled (default) so OCR doesn’t re-download / re-load language data.
  });

  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    const doc = await task.promise;
    const numpages = doc.numPages;
    const usedPages = Math.min(numpages, maxPages);

    const texts: string[] = [];

    for (let pageNum = 1; pageNum <= usedPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      await page.render({ canvasContext: ctx as any, viewport }).promise;

      const png = canvas.toBuffer("image/png");
      const result = await worker.recognize(png);
      const pageText = typeof result?.data?.text === "string" ? result.data.text : "";
      if (pageText.trim().length) texts.push(pageText);
    }

    return { text: texts.join("\n\n"), numpages, usedPages };
  } finally {
    await worker.terminate();
  }
}



