"use client"

import * as React from "react"
import { AlertCircle, AlertTriangle, FileCheck, FileWarning, FileX, Search } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { formatOutOf100, formatOutOf100From01 } from "@/components/home/format"
import type { ApiRankResponse, RankedCandidate } from "@/components/home/types"

export function RankingCard({
  rank,
  rankError,
  searchQuery,
  onSearchQueryChange,
  hideBelowThreshold,
  onHideBelowThresholdChange,
  onCandidateSelect,
}: Readonly<{
  rank: ApiRankResponse | null
  rankError: string | null
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  hideBelowThreshold: boolean
  onHideBelowThresholdChange: (value: boolean) => void
  onCandidateSelect: (candidateId: string) => void
}>) {
  const candidates = rank?.candidates ?? []
  const weights = candidates[0]?.score?.effectiveWeights ?? null
  const hardFilters = rank?.role?.hardFilters ?? null

  const filtered = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return candidates.filter((c) => {
      if (hideBelowThreshold && c.score.belowThreshold) return false
      if (!q) return true
      return c.fileName.toLowerCase().includes(q) || c.candidateId.toLowerCase().includes(q)
    })
  }, [candidates, hideBelowThreshold, searchQuery])

  const hasParsingErrors = (rank?.parsingErrors?.length ?? 0) > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Ranking</span>
          {rank ? (
            <Badge variant="secondary">
              {filtered.length}/{candidates.length}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription className="space-y-2">
          <div>
            Scores are out of <span className="font-medium text-foreground">100</span>. Higher is better.
          </div>
          <details className="rounded-md border bg-muted/20 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">How scoring works</summary>
            <div className="mt-2 grid gap-2 text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Must-have</span>: weighted match ratio of must-have skills.
              </div>
              <div>
                <span className="font-medium text-foreground">Nice-to-have</span>: weighted match ratio of nice-to-have skills.
              </div>
              <div>
                <span className="font-medium text-foreground">Experience</span>: based on <strong>relevant</strong> years
                (filtered by role keywords) vs. minYearsExperience.
              </div>
              <div>
                <span className="font-medium text-foreground">Skill Depth</span>: how deeply skills are demonstrated
                (frequency, context quality).
              </div>
              <div>
                <span className="font-medium text-foreground">Seniority</span>: detected seniority level from titles.
              </div>
              <div>
                <span className="font-medium text-foreground">Recency</span>: how current are the candidate's skills and roles.
              </div>
              <div>
                <span className="font-medium text-foreground">Project Scale</span>: enterprise experience, team size, user scale.
              </div>
              <div>
                <span className="font-medium text-foreground">Education</span>: degrees and relevant certifications.
              </div>
              <div>
                <span className="font-medium text-amber-600">Red Flags</span>: penalties for job hopping,
                employment gaps, or title inflation (subtracted from score).
              </div>
              {weights ? (
                <div className="text-xs">
                  Weights: Must-have <span className="font-medium text-foreground">{Math.round(weights.mustHaveSkills * 100)}%</span>,{" "}
                  Nice-to-have <span className="font-medium text-foreground">{Math.round(weights.niceToHaveSkills * 100)}%</span>,{" "}
                  Experience <span className="font-medium text-foreground">{Math.round(weights.experience * 100)}%</span>,{" "}
                  Skill Depth <span className="font-medium text-foreground">{Math.round((weights.skillDepth ?? 0) * 100)}%</span>,{" "}
                  Seniority <span className="font-medium text-foreground">{Math.round((weights.seniority ?? 0) * 100)}%</span>,{" "}
                  Recency <span className="font-medium text-foreground">{Math.round((weights.recency ?? 0) * 100)}%</span>,{" "}
                  Scale <span className="font-medium text-foreground">{Math.round((weights.projectScale ?? 0) * 100)}%</span>,{" "}
                  Education <span className="font-medium text-foreground">{Math.round((weights.education ?? 0) * 100)}%</span>.
                </div>
              ) : (
                <div className="text-xs">
                  Weights are defined in the role spec.
                </div>
              )}
              {hardFilters ? (
                <div className="text-xs">
                  <span className="font-medium text-foreground">Below threshold</span> can be triggered by: min must-have ratio,
                  min relevant experience years, high red flag penalties, or junior candidates for senior roles.
                </div>
              ) : null}
            </div>
          </details>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {rankError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Ranking failed</AlertTitle>
            <AlertDescription>{rankError}</AlertDescription>
          </Alert>
        ) : null}

        {!rank ? (
          <Alert>
            <AlertCircle />
            <AlertTitle>Ready when you are</AlertTitle>
            <AlertDescription>Select a role and click "Parse & Rank".</AlertDescription>
          </Alert>
        ) : (
          <>
            {hasParsingErrors ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Parsing errors ({rank?.parsingErrors.length})</AlertTitle>
                <AlertDescription>
                  <ScrollArea className="mt-2 max-h-40 w-full rounded-md border bg-background p-2">
                    <ul className="list-disc pl-5">
                      {rank?.parsingErrors.slice(0, 50).map((e) => (
                        <li key={e} className="mb-1 wrap-break-word">
                          {e}
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by filename…"
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="hide-below"
                  checked={hideBelowThreshold}
                  onCheckedChange={onHideBelowThresholdChange}
                />
                <Label htmlFor="hide-below" className="text-sm text-muted-foreground">
                  Hide below threshold
                </Label>
              </div>
            </div>

            <ScrollArea className="h-[60vh] rounded-md border">
              <TooltipProvider>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead className="w-20 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">Score</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium">Final Score (0-100)</p>
                            <p className="text-xs text-muted-foreground">Weighted sum of all factors minus red flag penalties. Higher is better.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-16 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">Skills</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium">Skills Match</p>
                            <p className="text-xs text-muted-foreground">Combined score: 70% must-have skills + 30% nice-to-have skills found in CV text.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-16 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">Exp</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium">Relevant Experience</p>
                            <p className="text-xs text-muted-foreground">Years of experience in relevant roles (dev/engineering) vs. the role's minimum requirement. Non-relevant roles are filtered out.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-16 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">Level</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium">Seniority Level</p>
                            <p className="text-xs text-muted-foreground">Detected from job titles: Sr (Senior/Lead), Mid (Developer/Engineer), Jr (Junior/Intern). For senior roles, senior candidates score higher.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-16 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">Recency</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium">Skill Recency & Trajectory</p>
                            <p className="text-xs text-muted-foreground">How current are the candidate's skills. ↑ = ascending career, → = stable, ↓ = descending. Current skills score higher than stale ones.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-16 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">Scale</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium">Project Scale</p>
                            <p className="text-xs text-muted-foreground">Enterprise experience, team size managed, user scale. Higher scores for production systems, large teams, B2B/SaaS experience.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-16 text-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">Flags</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium">Red Flags (Penalties)</p>
                            <p className="text-xs text-muted-foreground">Deductions for: job hopping (&lt;12mo stints), employment gaps (&gt;12mo), title inflation (senior title + little experience). Max -25 points.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-28 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">Status</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium">Threshold Status</p>
                            <p className="text-xs text-muted-foreground">"Below threshold" if: must-have skills below minimum, insufficient relevant experience, too many red flags, or junior for senior role.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                        No matches.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((c, idx) => <CandidateRow key={c.candidateId} idx={idx} c={c} onSelect={onCandidateSelect} />)
                  )}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </ScrollArea>

            <div className="text-xs text-muted-foreground">
              Tip: Click a candidate to see matched/missing skills, red flags, and evidence snippets.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function formatSeniority(level: string): string {
  switch (level) {
    case "senior": return "Sr"
    case "mid": return "Mid"
    case "junior": return "Jr"
    default: return "—"
  }
}

function formatTrajectory(trajectory: string): string {
  switch (trajectory) {
    case "ascending": return "↑"
    case "descending": return "↓"
    case "stable": return "→"
    default: return "—"
  }
}

function CandidateRow({
  idx,
  c,
  onSelect,
}: Readonly<{
  idx: number
  c: RankedCandidate
  onSelect: (candidateId: string) => void
}>) {
  const relExpYears = c.relevantExperience?.relevantYears
  const relExpDisplay = relExpYears !== null && relExpYears !== undefined 
    ? `${relExpYears}y` 
    : "—"
  
  const redFlagCount = c.redFlags?.flags?.length ?? 0
  const redFlagPenalty = c.redFlags?.totalPenalty ?? 0
  const hasHighSeverity = c.redFlags?.flags?.some((f) => f.severity === "high") ?? false

  const scaleScore = c.projectScale?.scaleScore ?? 0
  const recencyScore = c.recencyAnalysis?.recencyScore ?? 0

  // Combine must-have and nice-to-have into single column
  const skillsScore = (c.score.breakdown.mustHaveSkillsScore * 0.7 + c.score.breakdown.niceToHaveSkillsScore * 0.3)

  // Parse quality indicator
  const parseQuality = c.parseQuality?.overall ?? "medium"
  const parseConfidence = c.parseQuality?.confidence ?? 0.5

  return (
    <TooltipProvider>
      <TableRow className="cursor-pointer" onClick={() => onSelect(c.candidateId)}>
        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-help">
                  {parseQuality === "high" ? (
                    <FileCheck className="size-4 text-green-500" />
                  ) : parseQuality === "medium" ? (
                    <FileWarning className="size-4 text-amber-500" />
                  ) : (
                    <FileX className="size-4 text-red-500" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">Parse Quality: {parseQuality}</p>
                <p className="text-xs text-muted-foreground">Confidence: {Math.round(parseConfidence * 100)}%</p>
                <p className="text-xs text-muted-foreground">Text: {c.parseQuality?.textExtraction ?? "unknown"}</p>
                <p className="text-xs text-muted-foreground">Dates found: {c.parseQuality?.datesParsed ?? 0}</p>
                {c.parseQuality?.issues?.length ? (
                  <div className="mt-1 text-xs text-amber-500">
                    {c.parseQuality.issues.slice(0, 3).map((issue, i) => (
                      <p key={i}>• {issue}</p>
                    ))}
                  </div>
                ) : null}
              </TooltipContent>
            </Tooltip>
            <div className="flex flex-col">
              <div className="max-w-[160px] truncate font-medium">{c.fileName}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{c.candidateId.slice(0, 8)}…</div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex flex-col items-end">
            <span className="font-bold">{formatOutOf100(c.score.overallScore)}</span>
            {c.score.rawScore !== c.score.overallScore && (
              <span className="text-[10px] text-muted-foreground">({c.score.rawScore} - {redFlagPenalty})</span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right">{formatOutOf100From01(skillsScore)}</TableCell>
        <TableCell className="text-right">
          <div className="flex flex-col items-end">
            <span>{formatOutOf100From01(c.score.breakdown.relevantExperienceScore)}</span>
            <span className="text-[10px] text-muted-foreground">{relExpDisplay}</span>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant={c.seniority?.level === "senior" ? "default" : c.seniority?.level === "junior" ? "secondary" : "outline"}
                className="cursor-help"
              >
                {formatSeniority(c.seniority?.level ?? "unknown")}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Seniority: {c.seniority?.level ?? "unknown"}</p>
              <p className="text-xs text-muted-foreground">Confidence: {Math.round((c.seniority?.confidence ?? 0) * 100)}%</p>
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="text-right">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center justify-end gap-1 cursor-help">
                <span className="text-sm">{formatOutOf100From01(recencyScore)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatTrajectory(c.recencyAnalysis?.careerTrajectory?.trajectory ?? "unclear")}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Career: {c.recencyAnalysis?.careerTrajectory?.trajectory ?? "unclear"}</p>
              {c.recencyAnalysis?.careerTrajectory?.evidence?.slice(0, 2).map((e, i) => (
                <p key={i} className="text-xs text-muted-foreground">{e}</p>
              ))}
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="text-right">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">{formatOutOf100From01(scaleScore)}</span>
            </TooltipTrigger>
            <TooltipContent>
              {c.projectScale?.maxUserScale && <p>Max users: {c.projectScale.maxUserScale.toLocaleString()}</p>}
              {c.projectScale?.maxTeamSize && <p>Max team: {c.projectScale.maxTeamSize}</p>}
              {c.projectScale?.companyTypes?.length ? (
                <p>Types: {c.projectScale.companyTypes.join(", ")}</p>
              ) : null}
              {c.projectScale?.impactIndicators?.length ? (
                <p className="text-xs">{c.projectScale.impactIndicators.join(", ")}</p>
              ) : null}
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="text-center">
          {redFlagCount > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center gap-1 cursor-help">
                  <AlertTriangle className={`size-4 ${hasHighSeverity ? "text-red-500" : "text-amber-500"}`} />
                  <span className={`text-xs ${hasHighSeverity ? "text-red-500" : "text-amber-500"}`}>
                    -{redFlagPenalty}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1">
                  {c.redFlags?.flags?.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Badge variant={f.severity === "high" ? "destructive" : "secondary"} className="text-[10px]">
                        {f.severity}
                      </Badge>
                      <span className="text-xs">{f.evidence}</span>
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground">✓</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {c.score.belowThreshold ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="text-[10px] cursor-help">
                  Below threshold
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <ul className="space-y-1">
                  {c.score.thresholdReasons?.map((r, i) => (
                    <li key={i} className="text-xs">{r}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground">OK</span>
          )}
        </TableCell>
      </TableRow>
    </TooltipProvider>
  )
}
