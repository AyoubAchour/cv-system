"use client"

import * as React from "react"
import { AlertCircle, Search } from "lucide-react"

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
                <span className="font-medium text-foreground">Must-have</span>: weighted match ratio of must-have skills
                found in the CV text.
              </div>
              <div>
                <span className="font-medium text-foreground">Nice-to-have</span>: weighted match ratio of nice-to-have
                skills found in the CV text.
              </div>
              <div>
                <span className="font-medium text-foreground">Experience</span>: based on detected years vs. the role’s{" "}
                <span className="font-medium text-foreground">minYearsExperience</span>. If we can’t detect it, we use{" "}
                <span className="font-medium text-foreground">0/100</span>.
              </div>
              <div>
                <span className="font-medium text-foreground">Overall</span>: weighted average of the 3 parts (weights
                come from the role spec and are normalized).
              </div>
              {weights ? (
                <div className="text-xs">
                  Weights: Must-have <span className="font-medium text-foreground">{Math.round(weights.mustHaveSkills * 100)}%</span>,{" "}
                  Nice-to-have <span className="font-medium text-foreground">{Math.round(weights.niceToHaveSkills * 100)}%</span>,{" "}
                  Experience <span className="font-medium text-foreground">{Math.round(weights.experience * 100)}%</span>.
                </div>
              ) : (
                <div className="text-xs">
                  Weights are defined in the role spec (fallback default is 70% / 20% / 10%).
                </div>
              )}
              {hardFilters ? (
                <div className="text-xs">
                  <span className="font-medium text-foreground">Below threshold</span> can be triggered by hard filters
                  (e.g. min must-have ratio, or “require all must-haves”).
                </div>
              ) : (
                <div className="text-xs">
                  <span className="font-medium text-foreground">Below threshold</span> is only used when hard filters are
                  configured for the role.
                </div>
              )}
              <div className="text-xs">
                The <span className="font-medium text-foreground">Keywords</span> tab is extra context only — it does{" "}
                <span className="font-medium text-foreground">not</span> change the score.
              </div>
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
            <AlertDescription>Select a role and click “Parse & Rank”.</AlertDescription>
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
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead className="w-28 text-right">Score</TableHead>
                    <TableHead className="w-32 text-right">Must-have</TableHead>
                    <TableHead className="w-32 text-right">Nice-to-have</TableHead>
                    <TableHead className="w-32 text-right">Experience</TableHead>
                    <TableHead className="w-36 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        No matches.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((c, idx) => <CandidateRow key={c.candidateId} idx={idx} c={c} onSelect={onCandidateSelect} />)
                  )}
                </TableBody>
              </Table>
            </ScrollArea>

            <div className="text-xs text-muted-foreground">
              Tip: Click a candidate to see matched/missing skills and evidence snippets.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
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
  return (
    <TableRow className="cursor-pointer" onClick={() => onSelect(c.candidateId)}>
      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
      <TableCell>
        <div className="flex flex-col">
          <div className="truncate font-medium">{c.fileName}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{c.candidateId.slice(0, 10)}…</div>
        </div>
      </TableCell>
      <TableCell className="text-right font-semibold">{formatOutOf100(c.score.overallScore)}</TableCell>
      <TableCell className="text-right">{formatOutOf100From01(c.score.breakdown.mustHaveSkillsScore)}</TableCell>
      <TableCell className="text-right">{formatOutOf100From01(c.score.breakdown.niceToHaveSkillsScore)}</TableCell>
      <TableCell className="text-right">{formatOutOf100From01(c.score.breakdown.experienceScore)}</TableCell>
      <TableCell className="text-right">
        {c.score.belowThreshold ? <Badge variant="secondary">Below threshold</Badge> : <span className="text-xs text-muted-foreground">OK</span>}
      </TableCell>
    </TableRow>
  )
}


