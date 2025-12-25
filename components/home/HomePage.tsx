"use client"

import * as React from "react"
import { Loader2, Moon, Play, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

import { CandidateSheet } from "@/components/home/CandidateSheet"
import { fireAndForget, safeErrorMessage } from "@/components/home/format"
import { RankingCard } from "@/components/home/RankingCard"
import { SetupCard } from "@/components/home/SetupCard"
import type { ApiCandidatesResponse, ApiRankResponse, ApiSpecsResponse } from "@/components/home/types"

function isApiSpecsResponse(value: unknown): value is ApiSpecsResponse {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.projects) && Array.isArray(v.errors)
}

function isApiCandidatesResponse(value: unknown): value is ApiCandidatesResponse {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.roleId === "string" &&
    typeof v.roleDir === "string" &&
    typeof v.exists === "boolean" &&
    Array.isArray(v.pdfs)
  )
}

function isApiRankResponse(value: unknown): value is ApiRankResponse {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.project === "object" &&
    v.project !== null &&
    typeof v.role === "object" &&
    v.role !== null &&
    typeof v.scan === "object" &&
    v.scan !== null &&
    Array.isArray(v.candidates) &&
    Array.isArray(v.parsingErrors) &&
    Array.isArray(v.specErrors)
  )
}

type Theme = "dark" | "light"

const THEME_STORAGE_KEY = "cv-system-theme"

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === "dark") root.classList.add("dark")
  else root.classList.remove("dark")
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

export function HomePage() {
  const [loadingSpecs, setLoadingSpecs] = React.useState(true)
  const [specsError, setSpecsError] = React.useState<string | null>(null)
  const [specs, setSpecs] = React.useState<ApiSpecsResponse | null>(null)

  const [theme, setTheme] = React.useState<Theme>("dark")

  const [projectId, setProjectId] = React.useState("")
  const [roleId, setRoleId] = React.useState("")

  const [scanLoading, setScanLoading] = React.useState(false)
  const [scanError, setScanError] = React.useState<string | null>(null)
  const [scan, setScan] = React.useState<ApiCandidatesResponse | null>(null)

  const [rankLoading, setRankLoading] = React.useState(false)
  const [rankError, setRankError] = React.useState<string | null>(null)
  const [rank, setRank] = React.useState<ApiRankResponse | null>(null)

  const [searchQuery, setSearchQuery] = React.useState("")
  const [hideBelowThreshold, setHideBelowThreshold] = React.useState(false)

  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const nextTheme = readStoredTheme()
    setTheme(nextTheme)
    applyTheme(nextTheme)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function run() {
      setLoadingSpecs(true)
      setSpecsError(null)
      try {
        const res = await fetch("/api/specs", { cache: "no-store" })
        const json: unknown = await res.json()
        if (!res.ok) throw new Error(`Failed to load specs (${res.status})`)
        if (!isApiSpecsResponse(json)) throw new Error("Invalid /api/specs response")
        if (cancelled) return
        setSpecs(json)
      } catch (e) {
        if (cancelled) return
        setSpecsError(safeErrorMessage(e))
      } finally {
        if (!cancelled) setLoadingSpecs(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    // Reset role selection when switching projects.
    setRoleId("")
    setScan(null)
    setScanError(null)
    setRank(null)
    setRankError(null)
    setSelectedCandidateId(null)
    setSearchQuery("")
    setHideBelowThreshold(false)
  }, [projectId])

  async function loadRoleFolder(nextRoleId: string) {
    setScanLoading(true)
    setScanError(null)
    setScan(null)
    try {
      const res = await fetch(`/api/candidates?roleId=${encodeURIComponent(nextRoleId)}`, {
        cache: "no-store",
      })
      const json: unknown = await res.json()
      if (!res.ok) {
        const maybeError =
          typeof json === "object" && json !== null && typeof (json as Record<string, unknown>).error === "string"
            ? (json as { error: string }).error
            : `Failed to scan cvs folder (${res.status})`
        throw new Error(maybeError)
      }
      if (!isApiCandidatesResponse(json)) throw new Error("Invalid /api/candidates response")
      setScan(json)
    } catch (e) {
      setScanError(safeErrorMessage(e))
    } finally {
      setScanLoading(false)
    }
  }

  async function runRanking() {
    if (!projectId || !roleId) return
    setRankLoading(true)
    setRankError(null)
    setRank(null)
    setSelectedCandidateId(null)
    try {
      const res = await fetch(
        `/api/rank?projectId=${encodeURIComponent(projectId)}&roleId=${encodeURIComponent(roleId)}`,
        { cache: "no-store" }
      )
      const json: unknown = await res.json()
      if (!res.ok) {
        const maybeError =
          typeof json === "object" && json !== null && typeof (json as Record<string, unknown>).error === "string"
            ? (json as { error: string }).error
            : `Failed to rank candidates (${res.status})`
        throw new Error(maybeError)
      }
      if (!isApiRankResponse(json)) throw new Error("Invalid /api/rank response")
      setRank(json)
    } catch (e) {
      setRankError(safeErrorMessage(e))
    } finally {
      setRankLoading(false)
    }
  }

  const selectedCandidate = React.useMemo(() => {
    if (!rank || !selectedCandidateId) return null
    return rank.candidates.find((c) => c.candidateId === selectedCandidateId) ?? null
  }, [rank, selectedCandidateId])

  const roleFolderLabel = roleId ? `cvs/${roleId}/` : "cvs/<roleId>/"
  const roleFolderCopyText = scan?.roleDir ?? roleFolderLabel

  return (
    <div className="min-h-screen bg-background">
      {/* reduced side padding + larger usable width */}
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <h1 className="text-2xl font-semibold tracking-tight">CV System</h1>
            <p className="text-sm text-muted-foreground">
              Select a role, then rank PDFs with explainable results.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <Sun className={theme === "light" ? "size-4 text-foreground" : "size-4 text-muted-foreground"} />
              <Switch
                aria-label="Toggle theme"
                checked={theme === "dark"}
                onCheckedChange={(checked) => {
                  const nextTheme: Theme = checked ? "dark" : "light"
                  setTheme(nextTheme)
                  applyTheme(nextTheme)
                  try {
                    localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
                  } catch {}
                }}
              />
              <Moon className={theme === "dark" ? "size-4 text-foreground" : "size-4 text-muted-foreground"} />
            </div>
            <Button onClick={() => fireAndForget(runRanking())} disabled={!projectId || !roleId || rankLoading}>
              {rankLoading ? <Loader2 className="animate-spin" /> : <Play />}
              Parse & Rank
            </Button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-6">
            <SetupCard
              loadingSpecs={loadingSpecs}
              specsError={specsError}
              specs={specs}
              projectId={projectId}
              onProjectIdChange={setProjectId}
              roleId={roleId}
              onRoleIdChange={(nextRoleId) => {
                setRoleId(nextRoleId)
                setScan(null)
                setScanError(null)
                setRank(null)
                setRankError(null)
                setSelectedCandidateId(null)
                if (nextRoleId) fireAndForget(loadRoleFolder(nextRoleId))
              }}
              scanLoading={scanLoading}
              scanError={scanError}
              scan={scan}
              roleFolderLabel={roleFolderLabel}
              roleFolderCopyText={roleFolderCopyText}
              onRefreshScan={() => {
                if (roleId) fireAndForget(loadRoleFolder(roleId))
              }}
            />
          </div>

          <div className="flex flex-col gap-6">
            <RankingCard
              rank={rank}
              rankError={rankError}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              hideBelowThreshold={hideBelowThreshold}
              onHideBelowThresholdChange={setHideBelowThreshold}
              onCandidateSelect={setSelectedCandidateId}
            />
          </div>
        </div>

        <CandidateSheet
          candidate={selectedCandidate}
          open={selectedCandidateId !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedCandidateId(null)
          }}
        />
      </div>
    </div>
  )
}


