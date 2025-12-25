import { NextResponse } from "next/server";

import { isSafeRoleId, listRolePdfs } from "@/lib/cvs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roleId = url.searchParams.get("roleId") ?? "";

  if (!roleId || !isSafeRoleId(roleId)) {
    return NextResponse.json(
      { error: "Invalid roleId. Expected a roleId like 'fullstack-nextjs-supabase'." },
      { status: 400 },
    );
  }

  const result = await listRolePdfs(roleId);

  return NextResponse.json({
    roleId,
    roleDir: result.roleDir,
    exists: result.exists,
    pdfs: result.pdfs.map((p) => ({
      fileName: p.fileName,
      sizeBytes: p.sizeBytes,
      modifiedMs: p.modifiedMs,
    })),
  });
}


