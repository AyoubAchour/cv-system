import "server-only";

import path from "node:path";

import { CACHE_ROOT, readJsonIfExists, writeJsonAtomic } from "@/lib/cache";

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;
const CANDIDATE_ID_RE = /^[a-f0-9]{64}$/i;

export function isSafeId(value: string): boolean {
  return SAFE_ID_RE.test(value);
}

export function isCandidateId(value: string): boolean {
  return CANDIDATE_ID_RE.test(value);
}

function textCachePath(candidateId: string): string {
  return path.join(CACHE_ROOT, "text", `${candidateId}.json`);
}

export const TEXT_CACHE_SCHEMA_VERSION = 3;

export type TextCacheRecordV1 = {
  schemaVersion: 1;
  candidateId: string;
  numpages: number | null;
  extractedTextChars: number;
  normalizedTextChars: number;
  normalizedText: string;
  createdAt: string;
};

export type TextCacheRecordV2 = {
  schemaVersion: 2;
  candidateId: string;
  numpages: number | null;
  extractedTextChars: number;
  normalizedTextChars: number;
  normalizedText: string;
  createdAt: string;
};

export type TextCacheRecordV3 = {
  schemaVersion: 3;
  candidateId: string;
  numpages: number | null;
  extractedTextChars: number;
  normalizedTextChars: number;
  normalizedText: string;
  createdAt: string;
  extractionMethod?: "pdf" | "ocr";
  ocrLanguages?: string[];
  ocrPages?: number;
  ocrScale?: number;
};

export type TextCacheRecord = TextCacheRecordV1 | TextCacheRecordV2 | TextCacheRecordV3;

export async function readTextCache(candidateId: string): Promise<TextCacheRecord | null> {
  if (!isCandidateId(candidateId)) return null;
  return readJsonIfExists<TextCacheRecord>(textCachePath(candidateId));
}

export async function writeTextCache(record: TextCacheRecordV3): Promise<void> {
  if (!isCandidateId(record.candidateId)) throw new Error("Invalid candidateId");
  if (record.schemaVersion !== TEXT_CACHE_SCHEMA_VERSION) throw new Error("Invalid text cache schemaVersion");
  await writeJsonAtomic(textCachePath(record.candidateId), record);
}


