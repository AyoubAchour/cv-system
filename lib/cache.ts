import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

export const CACHE_ROOT = path.join(process.cwd(), ".cv-cache", "v1");

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const raw = JSON.stringify(value, null, 2) + "\n";
  await fs.writeFile(tmpPath, raw, "utf8");
  await fs.rename(tmpPath, filePath);
}


