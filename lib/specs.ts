import "server-only";

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

export type SalaryPeriod = "monthly" | "yearly";

export type RoleSkill = {
  skill: string;
  weight: number;
};

export type SeniorityIndicators = {
  senior: string[];
  mid: string[];
  junior: string[];
};

export type RoleSpec = {
  roleId: string;
  title: string;
  minYearsExperience: number;
  mustHaveSkills: RoleSkill[];
  niceToHaveSkills: RoleSkill[];
  keywords: string[];
  experienceRelevanceKeywords?: string[];
  seniorityIndicators?: SeniorityIndicators;
  responsibilities: string[];
  defaults: {
    salary: { currency: string; period: SalaryPeriod; min: number; max: number };
    contractLengthMonths: number;
  };
  scoring: {
    weights: {
      mustHaveSkills: number;
      niceToHaveSkills: number;
      experience: number;
      skillDepth?: number;
      seniority?: number;
      budget?: number;
      contract?: number;
    };
    hardFilters?: {
      minMustHaveMatchRatio?: number;
      requireAllMustHaveSkills?: boolean;
      minRelevantExperienceYears?: number;
    };
  };
};

export type ProjectSpec = {
  version: number;
  projectId: string;
  name: string;
  summary: string;
  domainKeywords: string[];
  techStack: Record<string, string[]>;
  roles: RoleSpec[];
  skillAliases: Record<string, string[]>;
};

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function fail<T>(sourceLabel: string, message: string): ParseResult<T> {
  return { ok: false, error: `${sourceLabel}: ${message}` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function parseProjectBaseFields(
  json: Record<string, unknown>,
  sourceLabel: string,
): ParseResult<{
  roles: unknown[];
}> {
  const { version, projectId, name, summary, domainKeywords, techStack, roles, skillAliases } = json;

  if (typeof version !== "number") return fail(sourceLabel, "version must be a number");
  if (typeof projectId !== "string") return fail(sourceLabel, "projectId must be a string");
  if (typeof name !== "string") return fail(sourceLabel, "name must be a string");
  if (typeof summary !== "string") return fail(sourceLabel, "summary must be a string");
  if (!isStringArray(domainKeywords)) return fail(sourceLabel, "domainKeywords must be string[]");
  if (!isPlainObject(techStack)) return fail(sourceLabel, "techStack must be an object");
  if (!Array.isArray(roles)) return fail(sourceLabel, "roles must be an array");
  if (!isPlainObject(skillAliases)) return fail(sourceLabel, "skillAliases must be an object");

  return { ok: true, value: { roles } };
}

function validateRoles(roles: unknown[], sourceLabel: string): ParseResult<void> {
  // Minimal deep validation for roles (just enough to safely drive UI + later scoring).
  for (const [idx, role] of roles.entries()) {
    if (!isPlainObject(role)) return fail(sourceLabel, `roles[${idx}] must be an object`);
    if (typeof role.roleId !== "string") return fail(sourceLabel, `roles[${idx}].roleId must be a string`);
    if (typeof role.title !== "string") return fail(sourceLabel, `roles[${idx}].title must be a string`);
    if (typeof role.minYearsExperience !== "number") {
      return fail(sourceLabel, `roles[${idx}].minYearsExperience must be a number`);
    }
  }
  return { ok: true, value: undefined };
}

function parseProjectSpec(json: unknown, sourceLabel: string): ParseResult<ProjectSpec> {
  if (!isPlainObject(json)) return fail(sourceLabel, "root must be an object");

  const base = parseProjectBaseFields(json, sourceLabel);
  if (!base.ok) return base;

  const rolesOk = validateRoles(base.value.roles, sourceLabel);
  if (!rolesOk.ok) return rolesOk;

  return { ok: true, value: json as ProjectSpec };
}

async function listProjectSpecFiles(specsDir: string): Promise<ParseResult<string[]>> {
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(specsDir, { withFileTypes: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(specsDir, `failed to read directory: ${message}`);
  }

  const files = dirents
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.toLowerCase().endsWith(".project.json"))
    .sort((a, b) => a.localeCompare(b));

  return { ok: true, value: files };
}

async function loadProjectSpecFile(specsDir: string, fileName: string): Promise<ParseResult<ProjectSpec>> {
  const absPath = path.join(specsDir, fileName);

  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(fileName, `failed to read: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(fileName, `invalid JSON: ${message}`);
  }

  return parseProjectSpec(parsed, fileName);
}

export async function loadProjectSpecs(): Promise<{ projects: ProjectSpec[]; errors: string[] }> {
  const specsDir = path.join(process.cwd(), "specs");
  const filesResult = await listProjectSpecFiles(specsDir);
  if (!filesResult.ok) {
    return { projects: [], errors: [filesResult.error] };
  }

  const projects: ProjectSpec[] = [];
  const errors: string[] = [];

  for (const fileName of filesResult.value) {
    const result = await loadProjectSpecFile(specsDir, fileName);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    projects.push(result.value);
  }

  return { projects, errors };
}


