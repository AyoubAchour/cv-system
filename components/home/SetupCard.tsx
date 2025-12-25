"use client"

import * as React from "react"
import { Check, Copy, Folder, RefreshCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

import { copyToClipboard } from "@/components/home/format"
import type { ApiCandidatesResponse, ApiSpecsResponse } from "@/components/home/types"

function ProjectPicker({
  loadingSpecs,
  specsError,
  specs,
  projectId,
  onProjectIdChange,
}: Readonly<{
  loadingSpecs: boolean
  specsError: string | null
  specs: ApiSpecsResponse | null
  projectId: string
  onProjectIdChange: (projectId: string) => void
}>) {
  if (loadingSpecs) return <div className="text-sm text-muted-foreground">Loading specs…</div>
  if (specsError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load specs</AlertTitle>
        <AlertDescription>{specsError}</AlertDescription>
      </Alert>
    )
  }

  return (
    <Select value={projectId} onValueChange={onProjectIdChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a project…" />
      </SelectTrigger>
      <SelectContent>
        {(specs?.projects ?? []).map((p) => (
          <SelectItem key={p.projectId} value={p.projectId}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ScanStatus({
  roleId,
  scanLoading,
  scan,
}: Readonly<{
  roleId: string
  scanLoading: boolean
  scan: ApiCandidatesResponse | null
}>) {
  if (roleId.length === 0) {
    return <div className="text-sm text-muted-foreground">Select a role to scan its folder.</div>
  }
  if (scanLoading) return <div className="text-sm text-muted-foreground">Scanning…</div>

  if (scan?.exists === false) {
    return (
      <Alert>
        <AlertTitle>Folder not found</AlertTitle>
        <AlertDescription>
          Create <span className="font-mono">{scan.roleDir}</span> and add PDFs.
        </AlertDescription>
      </Alert>
    )
  }

  if (scan?.exists === true && scan.pdfs.length === 0) {
    return (
      <Alert>
        <AlertTitle>No PDFs yet</AlertTitle>
        <AlertDescription>
          Add PDFs to <span className="font-mono">{scan.roleDir}</span>.
        </AlertDescription>
      </Alert>
    )
  }

  if (scan?.exists === true) {
    return (
      <div className="text-sm text-muted-foreground">
        Found <span className="font-semibold text-foreground">{scan.pdfs.length}</span> PDF(s).
      </div>
    )
  }

  return null
}

export function SetupCard({
  loadingSpecs,
  specsError,
  specs,
  projectId,
  onProjectIdChange,
  roleId,
  onRoleIdChange,
  scanLoading,
  scanError,
  scan,
  roleFolderLabel,
  roleFolderCopyText,
  onRefreshScan,
}: Readonly<{
  loadingSpecs: boolean
  specsError: string | null
  specs: ApiSpecsResponse | null
  projectId: string
  onProjectIdChange: (projectId: string) => void
  roleId: string
  onRoleIdChange: (roleId: string) => void
  scanLoading: boolean
  scanError: string | null
  scan: ApiCandidatesResponse | null
  roleFolderLabel: string
  roleFolderCopyText: string
  onRefreshScan: () => void
}>) {
  const [copyState, setCopyState] = React.useState<"idle" | "ok">("idle")

  const selectedProject = React.useMemo(() => {
    if (!specs) return null
    return specs.projects.find((p) => p.projectId === projectId) ?? null
  }, [specs, projectId])

  const roles = selectedProject?.roles ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Folder className="size-4" />
          Setup
        </CardTitle>
        <CardDescription>
          Pick a Project and Role, then put PDFs in the folder and click “Parse & Rank”.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label>Project</Label>
          <ProjectPicker
            loadingSpecs={loadingSpecs}
            specsError={specsError}
            specs={specs}
            projectId={projectId}
            onProjectIdChange={onProjectIdChange}
          />

          {specs?.errors?.length ? (
            <Alert>
              <AlertTitle>Spec warnings ({specs.errors.length})</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-5">
                  {specs.errors.slice(0, 3).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {specs.errors.length > 3 ? <li>…</li> : null}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label>Role</Label>
          <Select
            value={roleId}
            onValueChange={onRoleIdChange}
            disabled={!selectedProject}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={selectedProject ? "Select a role…" : "Select a project first"}
              />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.roleId} value={r.roleId}>
                  {r.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <div className="font-mono">{roleFolderLabel}</div>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={async () => {
              const ok = await copyToClipboard(roleFolderCopyText)
              setCopyState(ok ? "ok" : "idle")
              if (ok) setTimeout(() => setCopyState("idle"), 900)
            }}
          >
            {copyState === "ok" ? <Check /> : <Copy />}
          </Button>
        </div>

        <Separator />

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Folder scan</div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={!roleId || scanLoading}
              onClick={onRefreshScan}
            >
              <RefreshCw className={scanLoading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>

          {scanError ? (
            <Alert variant="destructive">
              <AlertTitle>Scan failed</AlertTitle>
              <AlertDescription>{scanError}</AlertDescription>
            </Alert>
          ) : null}
          <ScanStatus roleId={roleId} scanLoading={scanLoading} scan={scan} />
        </div>
      </CardContent>
    </Card>
  )
}


