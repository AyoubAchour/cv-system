"use client"

import * as React from "react"
import { AlertCircle, Github, Globe, Linkedin, Mail, Phone } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { formatOutOf100, formatOutOf100From01 } from "@/components/home/format"
import type { RankedCandidate } from "@/components/home/types"
import type { SkillMatch } from "@/lib/scoring"
import { cn } from "@/lib/utils"

export function CandidateSheet({
  candidate,
  open,
  onOpenChange,
}: Readonly<{
  candidate: RankedCandidate | null
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const keywordHits = candidate?.keywordHits ?? []
  const matchedKeywordHits = keywordHits.filter((k) => k.matched)
  const missingKeywordHits = keywordHits.filter((k) => !k.matched)
  const missingKeywordLabel = missingKeywordHits.length
    ? `${missingKeywordHits
        .slice(0, 14)
        .map((k) => k.keyword)
        .join(", ")}${missingKeywordHits.length > 14 ? "…" : ""}`
    : ""

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-0 w-[min(1100px,95vw)] sm:max-w-none">
        <SheetHeader className="border-b">
          <SheetTitle className="text-base">{candidate ? candidate.fileName : "Candidate"}</SheetTitle>
          <SheetDescription>
            {candidate ? <span className="font-mono text-xs">{candidate.candidateId}</span> : null}
          </SheetDescription>
        </SheetHeader>

        {!candidate ? (
          <div className="p-4 text-sm text-muted-foreground">No candidate selected.</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid gap-4 p-4">
              {(() => {
                const c = candidate.contacts
                const email = c.emails?.[0] ?? null
                const phone = c.phones?.[0] ?? null
                const links: Array<{ href: string; label: string; Icon: React.ComponentType<{ className?: string }> }> =
                  []

                if (c.linkedin) links.push({ href: c.linkedin, label: "LinkedIn", Icon: Linkedin })
                if (c.github) links.push({ href: c.github, label: "GitHub", Icon: Github })
                if (c.portfolio) links.push({ href: c.portfolio, label: "Portfolio", Icon: Globe })

                const hasAny = Boolean(email || phone || links.length)
                if (!hasAny) return null

                return (
                  <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm">
                    <div className="text-muted-foreground">Contacts</div>
                    <div className="flex flex-wrap gap-2">
                      {email ? (
                        <a
                          href={`mailto:${email}`}
                          className="inline-flex max-w-[420px] items-center gap-2 rounded-md border bg-background px-2 py-1 hover:bg-muted cursor-pointer"
                          title={email}
                        >
                          <Mail className="h-4 w-4" />
                          <span className="truncate">{email}</span>
                        </a>
                      ) : null}

                      {phone ? (
                        <a
                          href={`tel:${phone.e164}`}
                          className="inline-flex max-w-[420px] items-center gap-2 rounded-md border bg-background px-2 py-1 hover:bg-muted cursor-pointer"
                          title={phone.e164}
                        >
                          <Phone className="h-4 w-4" />
                          <span className="truncate">{phone.display}</span>
                        </a>
                      ) : null}

                      {links.map(({ href, label, Icon }) => (
                        <a
                          key={href}
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-[420px] items-center gap-2 rounded-md border bg-background px-2 py-1 hover:bg-muted cursor-pointer"
                          title={href}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="truncate">{label}</span>
                        </a>
                      ))}

                    </div>
                  </div>
                )
              })()}

              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Overall score</div>
                <div className="text-xl font-semibold">{formatOutOf100(candidate.score.overallScore)}</div>
              </div>

              <div className="grid gap-1 rounded-md border bg-muted/20 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Must-have</span>
                  <span className="font-medium">{formatOutOf100From01(candidate.score.breakdown.mustHaveSkillsScore)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nice-to-have</span>
                  <span className="font-medium">{formatOutOf100From01(candidate.score.breakdown.niceToHaveSkillsScore)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Experience</span>
                  <span className="font-medium">{formatOutOf100From01(candidate.score.breakdown.experienceScore)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm">
                <div className="text-muted-foreground">Status</div>
                <div>
                  {candidate.score.belowThreshold ? (
                    <Badge variant="secondary">Below threshold</Badge>
                  ) : (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">OK</Badge>
                  )}
                </div>
              </div>

              {candidate.parseWarnings.length ? (
                <Alert>
                  <AlertCircle />
                  <AlertTitle>Warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-1 list-disc pl-5">
                      {candidate.parseWarnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>

            <Separator />

            <div className="flex min-h-0 flex-1 flex-col">
              <Tabs defaultValue="skills" className="min-h-0 flex-1">
                <div className="px-4 pt-4 shrink-0">
                  <TabsList className="w-full">
                    <TabsTrigger value="skills" className="flex-1">
                      Skills
                    </TabsTrigger>
                    <TabsTrigger value="keywords" className="flex-1">
                      Keywords
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="skills" className="min-h-0 flex-1 p-4 pt-3">
                  <ScrollArea className="h-full pr-3">
                    <div className="grid gap-4">
                      <SkillList title="Must-have skills" skills={candidate.mustHave} />
                      <SkillList title="Nice-to-have skills" skills={candidate.niceToHave} />
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="keywords" className="min-h-0 flex-1 p-4 pt-3">
                  <ScrollArea className="h-full pr-3">
                    <div className="grid gap-3">
                      <div className="text-sm text-muted-foreground">
                        Keywords are extra signals from the role spec. They do <span className="font-medium text-foreground">not</span>{" "}
                        change the score.
                      </div>

                      {keywordHits.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No keywords configured for this role.</div>
                      ) : matchedKeywordHits.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          No keyword hits found.{" "}
                          {missingKeywordLabel ? (
                            <>
                              Role keywords: <span className="font-medium text-foreground">{missingKeywordLabel}</span>
                            </>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <div className="text-xs text-muted-foreground">
                            Matched{" "}
                            <span className="font-medium text-foreground">{matchedKeywordHits.length}</span>/{keywordHits.length}
                          </div>
                          {matchedKeywordHits.map((k) => (
                            <div key={k.keyword} className="rounded-md border bg-background p-3">
                              <div className="font-medium">{k.keyword}</div>
                              {k.evidence[0] ? (
                                <div className="mt-2 rounded bg-muted/40 p-2 font-mono text-[11px]">
                                  {k.evidence[0]}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function SkillList({ title, skills }: Readonly<{ title: string; skills: SkillMatch[] }>) {
  const matched = skills.filter((s) => s.matched)
  const missing = skills.filter((s) => !s.matched)

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">
          {matched.length}/{skills.length} matched
        </div>
      </div>
      <div className="grid gap-2">
        {[...matched, ...missing].map((s) => (
          <div
            key={s.skill}
            className={cn(
              "rounded-md border p-3",
              s.matched ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">
                {s.skill} <span className="text-xs text-muted-foreground">(w={s.weight})</span>
              </div>
              {s.matched ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">Matched</Badge>
              ) : (
                <Badge variant="destructive">Missing</Badge>
              )}
            </div>
            {s.evidence[0] ? (
              <div className="mt-2 rounded bg-background/70 p-2 font-mono text-[11px]">
                {s.evidence[0]}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}


