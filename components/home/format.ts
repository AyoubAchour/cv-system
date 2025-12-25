export const LOCALE = "fr-TN"

export function safeErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

export function score01To100Int(score01: number): number {
  return Math.round(clamp01(score01) * 100)
}

export function formatOutOf100From01(score01: number): string {
  return `${score01To100Int(score01)}/100`
}

export function formatOutOf100(score100: number): string {
  const safe = Number.isFinite(score100) ? score100 : 0
  return `${Math.round(safe)}/100`
}

export function formatBytes(bytes: number): string {
  const kb = 1024
  const mb = kb * 1024
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`
  if (bytes >= kb) return `${Math.round(bytes / kb)} KB`
  return `${bytes} B`
}

export function formatDateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(LOCALE)
  } catch {
    return String(ms)
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function fireAndForget(promise: Promise<unknown>): void {
  promise.catch(() => {})
}


