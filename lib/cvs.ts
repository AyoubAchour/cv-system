import "server-only";

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

export type PdfEntry = {
  fileName: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedMs: number;
};

const ROLE_ID_RE = /^[a-zA-Z0-9._-]+$/;

export function isSafeRoleId(roleId: string): boolean {
  return ROLE_ID_RE.test(roleId);
}

export async function listRolePdfs(roleId: string): Promise<{
  roleDir: string;
  exists: boolean;
  pdfs: PdfEntry[];
}> {
  const cvsRoot = path.resolve(process.cwd(), "cvs");
  const roleDir = path.resolve(cvsRoot, roleId);

  // Prevent path traversal (roleDir must stay under cvsRoot).
  if (!roleDir.startsWith(cvsRoot + path.sep)) {
    return { roleDir, exists: false, pdfs: [] };
  }

  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(roleDir, { withFileTypes: true });
  } catch {
    return { roleDir, exists: false, pdfs: [] };
  }

  const pdfFiles = dirents
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.localeCompare(b));

  const pdfs: PdfEntry[] = [];
  for (const fileName of pdfFiles) {
    const absolutePath = path.join(roleDir, fileName);
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) continue;
      pdfs.push({
        fileName,
        absolutePath,
        sizeBytes: stat.size,
        modifiedMs: stat.mtimeMs,
      });
    } catch {
      // Ignore unreadable files; show what we can.
    }
  }

  return { roleDir, exists: true, pdfs };
}


