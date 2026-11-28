// The parts of the server-function proxy that need no database, no sandbox and no Next.js.

import { DIAGNOSTIC_HEADER } from "./diagnostic"

export type ServerErrorCode = "not_connected" | "sign_in" | "bad_request" | "unavailable" | "preview"

export const MAX_SERVER_BODY_BYTES = 1_048_576

export const SANDBOX_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-device-id, x-appxprompt-sandbox",
  "access-control-max-age": "86400",
}

/** Whatever a server function returns is data for the app: the browser must not sniff it into a page or run scripts from it. */
export const SANDBOX_RESPONSE_GUARD_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox",
}

const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "accept-language", "authorization", "x-device-id"]
const KEPT_RESPONSE_HEADERS = ["content-type", "cache-control", "content-language"]

export function serverErrorBody(code: ServerErrorCode, message: string, service?: string) {
  return { error: { code, message, ...(service ? { service } : {}) } }
}

/** Cookies, the sandbox token and anything the platform added never reach the VM. */
export function forwardRequestHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = headers.get(name)
    if (value !== null) kept[name] = value
  }
  return kept
}

/** The few headers of a VM's answer that may reach the browser (never the diagnostic), plus the guard headers, which the VM can't change. */
export function safeResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower !== DIAGNOSTIC_HEADER && KEPT_RESPONSE_HEADERS.includes(lower)) kept[lower] = value
  }
  return { ...kept, ...SANDBOX_RESPONSE_GUARD_HEADERS }
}

/** A path segment that would climb out of the route, written plainly or percent-encoded. */
export function isDotSegment(segment: string): boolean {
  const candidates = [segment]
  try {
    candidates.push(decodeURIComponent(segment))
  } catch {
    // Not valid percent-encoding: the plain form is all there is to check.
  }
  return candidates.some((value) => value === "." || value === "..")
}

/** The request's body as text (null when there is none), or "too-large" without reading past the limit. */
export async function readCappedBody(request: Request, limit = MAX_SERVER_BODY_BYTES): Promise<string | null | "too-large"> {
  if (!request.body) return null
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) return "too-large"

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      return "too-large"
    }
    chunks.push(value)
  }
  if (size === 0) return null
  return Buffer.concat(chunks).toString("utf8")
}

/** The error the sandbox's own response carries, if it is one: only the code and service are read. */
export function readSandboxError(status: number, headers: Record<string, string>, body: string): { code: string | null; service: string | null } {
  if (status < 400 || !/json/i.test(headers["content-type"] ?? "")) return { code: null, service: null }
  try {
    const error = (JSON.parse(body) as { error?: { code?: unknown; service?: unknown } } | null)?.error
    return {
      code: typeof error?.code === "string" ? error.code : null,
      service: typeof error?.service === "string" ? error.service : null,
    }
  } catch {
    return { code: null, service: null }
  }
}
