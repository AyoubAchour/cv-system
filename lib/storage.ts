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

function isSafeCacheRoleId(roleId: string): boolean {
  // Prevent path traversal: SAFE_ID_RE alone would allow "." and "..".
  return isSafeId(roleId) && roleId !== "." && roleId !== "..";
}

function roleTextCachePath(roleId: string, candidateId: string): string {
  return path.join(CACHE_ROOT, "roles", roleId, "text", `${candidateId}.json`);
}

function legacyTextCachePath(candidateId: string): string {
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

export async function readTextCache(roleId: string, candidateId: string): Promise<TextCacheRecord | null> {
  if (!isSafeCacheRoleId(roleId)) return null;
  if (!isCandidateId(candidateId)) return null;

  const perRolePath = roleTextCachePath(roleId, candidateId);
  const hit = await readJsonIfExists<TextCacheRecord>(perRolePath);
  if (hit) return hit;

  // Back-compat: older installs stored all text caches in a shared directory.
  const legacy = await readJsonIfExists<TextCacheRecord>(legacyTextCachePath(candidateId));
  if (!legacy) return null;

  // Best-effort migration into the per-role cache path.
  try {
    await writeJsonAtomic(perRolePath, legacy);
  } catch {
    // Ignore migration errors; we can still use the legacy cache in-memory.
  }

  return legacy;
}

export async function writeTextCache(roleId: string, record: TextCacheRecordV3): Promise<void> {
  if (!isSafeCacheRoleId(roleId)) throw new Error("Invalid roleId");
  if (!isCandidateId(record.candidateId)) throw new Error("Invalid candidateId");
  if (record.schemaVersion !== TEXT_CACHE_SCHEMA_VERSION) throw new Error("Invalid text cache schemaVersion");
  await writeJsonAtomic(roleTextCachePath(roleId, record.candidateId), record);
}


