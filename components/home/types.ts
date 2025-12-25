import type { HardFilters, KeywordHit, ScoreResult, SkillMatch } from "@/lib/scoring"

export type ApiSpecsResponse = {
  projects: {
    version: number
    projectId: string
    name: string
    summary: string
    roles: { roleId: string; title: string }[]
  }[]
  errors: string[]
}

export type ApiCandidatesResponse = {
  roleId: string
  roleDir: string
  exists: boolean
  pdfs: { fileName: string; sizeBytes: number; modifiedMs: number }[]
}

export type ApiRankResponse = {
  project: { projectId: string; name: string }
  role: {
    roleId: string
    title: string
    minYearsExperience: number
    hardFilters: HardFilters | null
  }
  scan: {
    roleDir: string
    exists: boolean
    pdfCount: number
  }
  candidates: Array<{
    candidateId: string
    fileName: string
    numpages: number | null
    extractedTextChars: number
    normalizedTextChars: number
    parseWarnings: string[]
    contacts: {
      emails: string[]
      phones: Array<{ e164: string; display: string }>
      linkedin: string | null
      github: string | null
      portfolio: string | null
      otherLinks: string[]
    }
    yearsExperience: number | null
    mustHave: SkillMatch[]
    niceToHave: SkillMatch[]
    keywordHits: KeywordHit[]
    score: ScoreResult
  }>
  parsingErrors: string[]
  specErrors: string[]
}

export type RankedCandidate = ApiRankResponse["candidates"][number]


