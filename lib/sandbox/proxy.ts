// The cookie-less proxy from a generated app to its project's sandbox (the owner's preview only).

import { NextResponse } from "next/server"

import { integrationsEnabled } from "@/lib/services/flags"
import { DIAGNOSTIC_HEADER, decodeDiagnostic, type CallDiagnostic } from "./diagnostic"
import {
  MAX_SERVER_BODY_BYTES,
  SANDBOX_CORS_HEADERS,
  forwardRequestHeaders,
  isDotSegment,
  readCappedBody,
  readSandboxError,
  safeResponseHeaders,
  serverErrorBody,
  type ServerErrorCode,
} from "./http"
import { SandboxUnavailableError, getSandboxRunner, takeSandboxRequest } from "./runner"
import { sandboxAllowedFor } from "./allowed"
import { SANDBOX_TOKEN_HEADER, sandboxTokenUserId, verifySandboxToken } from "./token"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_BODY_STATUSES = new Set([204, 205, 304])

const UNAVAILABLE_MESSAGES = {
  disabled: "Server functions aren't running on this AppxPrompt server.",
  starting: "The test server is still starting. Try again in a moment.",
  limit: "Testing server functions is paused until tomorrow.",
  failed: "The test server couldn't start.",
}

/** What the Activity panel is told about one call. It never holds a body, a header or a query string. */
export type ServerCall = {
  projectId: string
  path: string
  method: string
  status: number
  errorCode: string | null
  service: string | null
  durationMs: number
  /** Which hosts the function reached and what it threw. For the owner's Activity tab only. */
  diagnostic?: CallDiagnostic | null
}

export type ServerProxyOptions = {
  onCall?: (call: ServerCall) => void | Promise<void>
}

type Context = { params: Promise<{ projectId: string; path: string[] }> }

/** The VM's diagnostic for the call. Read here and never forwarded: safeResponseHeaders keeps only a short list of headers. */
function readDiagnostic(headers: Record<string, string>): CallDiagnostic | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === DIAGNOSTIC_HEADER) return decodeDiagnostic(value)
  }
  return null
}

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { ...SANDBOX_CORS_HEADERS, "cache-control": "no-store" } })
}

export function sandboxPreflight() {
  return new NextResponse(null, { status: 204, headers: SANDBOX_CORS_HEADERS })
}

export function createServerProxy({ onCall = () => {} }: ServerProxyOptions = {}) {
  return async function proxy(request: Request, { params }: Context): Promise<Response> {
    const { projectId, path } = await params
    if (!UUID_PATTERN.test(projectId)) return reply(serverErrorBody("bad_request", "This app isn't connected to a backend."), 404)
    if (!integrationsEnabled()) return reply(serverErrorBody("unavailable", "Server functions aren't available."), 503)

    const token = request.headers.get(SANDBOX_TOKEN_HEADER)
    const userId = token ? sandboxTokenUserId(token) : null
    if (!token || userId === null || !verifySandboxToken(token, projectId) || !sandboxAllowedFor(userId)) {
      return reply(serverErrorBody("preview", "Server functions only run in the owner's preview before publishing."), 403)
    }
    if (path.some(isDotSegment)) return reply(serverErrorBody("bad_request", "That path isn't a server function."), 404)

    const startedAt = Date.now()
    const method = request.method
    const callPath = "/" + path.map(encodeURIComponent).join("/")

    const finish = (response: Response, errorCode: string | null, service: string | null = null, diagnostic: CallDiagnostic | null = null) => {
      try {
        const result = onCall({
          projectId,
          path: callPath,
          method,
          status: response.status,
          errorCode,
          service,
          durationMs: Date.now() - startedAt,
          diagnostic,
        })
        if (result) result.catch(() => {})
      } catch {
        // Recording a call must never change its answer.
      }
      return response
    }
    const fail = (code: ServerErrorCode, message: string, status: number) => finish(reply(serverErrorBody(code, message), status), code)

    if (!takeSandboxRequest(projectId)) {
      return reply(serverErrorBody("unavailable", "Too many requests. Try again in a minute."), 429)
    }

    const body = request.method === "GET" || request.method === "HEAD" ? null : await readCappedBody(request)
    if (body === "too-large") return fail("bad_request", "That request is too large.", 413)

    try {
      const search = new URL(request.url).search
      const answer = await getSandboxRunner().invoke(projectId, {
        method,
        path: callPath + search,
        headers: forwardRequestHeaders(request.headers),
        body,
      })

      if (answer.status < 200 || answer.status > 599) return fail("unavailable", "The server function gave an unusable answer.", 502)
      if (Buffer.byteLength(answer.body) > MAX_SERVER_BODY_BYTES) return fail("unavailable", "The server function's answer is too large.", 502)

      const diagnostic = readDiagnostic(answer.headers)
      const error = readSandboxError(answer.status, answer.headers, answer.body)
      const response = new NextResponse(NO_BODY_STATUSES.has(answer.status) ? null : answer.body, {
        status: answer.status,
        headers: { ...safeResponseHeaders(answer.headers), ...SANDBOX_CORS_HEADERS, "cache-control": "no-store" },
      })
      return finish(response, error.code, error.service, diagnostic)
    } catch (error) {
      if (error instanceof SandboxUnavailableError) return fail("unavailable", UNAVAILABLE_MESSAGES[error.reason], 503)
      console.error("Server function proxy failed", error instanceof Error ? error.name : "unknown")
      return fail("unavailable", "The test server couldn't answer. Try again in a moment.", 503)
    }
  }
}
