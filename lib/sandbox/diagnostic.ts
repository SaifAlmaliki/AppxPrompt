// What the sandbox VM tells the proxy about one call: which hosts the function reached and what it threw.
// Web APIs only: it runs inside the VM (to write the header) and on the server (to read it).
// It holds hostnames, statuses and timings, and a scrubbed first line of an error. No path, query, header or body.

export const DIAGNOSTIC_HEADER = "x-appxprompt-diagnostic"
export const MAX_DIAGNOSTIC_HEADER_LENGTH = 2048
export const MAX_DIAGNOSTIC_FETCHES = 10
export const MAX_THROWN_NAME_LENGTH = 60
export const MAX_THROWN_MESSAGE_LENGTH = 200

export const FETCH_ERRORS = ["blocked", "timeout", "network"] as const
export type FetchError = (typeof FETCH_ERRORS)[number]

export type FetchDiagnostic = { host: string; status?: number; error?: FetchError; ms: number }
export type ThrownDiagnostic = { name: string; message: string }
export type CallDiagnostic = { ms: number; fetches: FetchDiagnostic[]; thrown?: ThrownDiagnostic }

const MAX_HOST_LENGTH = 253
const HOSTNAME = /^(?:[a-z0-9_](?:[a-z0-9_.-]*[a-z0-9_])?|\[[0-9a-f:.]+\])$/i

/** Whether a host can be stored and shown as is. The runtime records "invalid" for one that can't. */
export function isRecordableHost(host: string): boolean {
  return host.length > 0 && host.length <= MAX_HOST_LENGTH && HOSTNAME.test(host)
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647
}

function sanitizeFetch(value: unknown): FetchDiagnostic | null {
  if (!value || typeof value !== "object") return null
  const { host, status, error, ms } = value as Record<string, unknown>
  if (typeof host !== "string" || !isRecordableHost(host)) return null
  if (!isCount(ms)) return null
  const entry: FetchDiagnostic = { host: host.toLowerCase(), ms }
  if (status !== undefined) {
    if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) return null
    entry.status = status
  }
  if (error !== undefined) {
    if (!(FETCH_ERRORS as readonly unknown[]).includes(error)) return null
    entry.error = error as FetchError
  }
  return entry
}

/** The diagnostic as a fresh, checked object, or null if anything about it is off. */
export function sanitizeDiagnostic(value: unknown): CallDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const { ms, fetches, thrown } = value as Record<string, unknown>
  if (!isCount(ms) || !Array.isArray(fetches) || fetches.length > MAX_DIAGNOSTIC_FETCHES) return null

  const checked: FetchDiagnostic[] = []
  for (const item of fetches) {
    // One bad entry costs only itself, never the error text beside it.
    const entry = sanitizeFetch(item)
    if (entry) checked.push(entry)
  }

  const result: CallDiagnostic = { ms, fetches: checked }
  if (thrown !== undefined) {
    if (!thrown || typeof thrown !== "object") return null
    const { name, message } = thrown as Record<string, unknown>
    if (typeof name !== "string" || typeof message !== "string") return null
    if (name.length > MAX_THROWN_NAME_LENGTH || message.length > MAX_THROWN_MESSAGE_LENGTH) return null
    result.thrown = { name, message }
  }
  return result
}

function toBase64Url(text: string) {
  let binary = ""
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const MIN_KEPT_MESSAGE_LENGTH = 40

function failed(fetch: FetchDiagnostic) {
  return Boolean(fetch.error) || (fetch.status ?? 0) >= 400
}

/** The header value. Over the limit, the error text is shortened first, then successful calls go before failed ones. */
export function encodeDiagnostic(diagnostic: CallDiagnostic): string {
  const draft: CallDiagnostic = { ms: diagnostic.ms, fetches: [...diagnostic.fetches], ...(diagnostic.thrown ? { thrown: { ...diagnostic.thrown } } : {}) }
  const dropLast = (match: (fetch: FetchDiagnostic) => boolean) => {
    const index = draft.fetches.findLastIndex(match)
    if (index < 0) return false
    draft.fetches.splice(index, 1)
    return true
  }
  for (;;) {
    const encoded = toBase64Url(JSON.stringify(draft))
    if (encoded.length <= MAX_DIAGNOSTIC_HEADER_LENGTH) return encoded
    const message = draft.thrown?.message ?? ""
    if (draft.thrown && message.length > MIN_KEPT_MESSAGE_LENGTH) {
      draft.thrown.message = message.slice(0, Math.max(MIN_KEPT_MESSAGE_LENGTH, message.length >> 1))
    } else if (dropLast((fetch) => !failed(fetch))) {
      continue
    } else if (draft.fetches.filter(failed).length > 1) {
      dropLast(failed)
    } else if (draft.thrown && message.length > 0) {
      draft.thrown.message = message.slice(0, message.length >> 1)
    } else if (draft.thrown) {
      delete draft.thrown
    } else if (draft.fetches.length > 0) {
      draft.fetches.pop()
    } else {
      return ""
    }
  }
}

/** Reads the header value. Anything oversized, malformed or off-shape is ignored. */
export function decodeDiagnostic(header: string | null | undefined): CallDiagnostic | null {
  if (!header || header.length > MAX_DIAGNOSTIC_HEADER_LENGTH || !/^[A-Za-z0-9_-]+$/.test(header)) return null
  try {
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return sanitizeDiagnostic(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
  } catch {
    return null
  }
}
