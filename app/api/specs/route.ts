import { NextResponse } from "next/server";

import { loadProjectSpecs } from "@/lib/specs";

export async function GET() {
  const { projects, errors } = await loadProjectSpecs();

  const payload = {
    projects: projects.map((p) => ({
      version: p.version,
      projectId: p.projectId,
      name: p.name,
      summary: p.summary,
      roles: p.roles.map((r) => ({
        roleId: r.roleId,
        title: r.title,
      })),
    })),
    errors,
  };

  return NextResponse.json(payload);
}


