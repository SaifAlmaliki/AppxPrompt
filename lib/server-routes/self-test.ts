// Tries a freshly written server function once in the sandbox, so a broken one is fixed before the owner taps it.
// Server only. A result never holds a body, a header or a credential value: only the status, the error code
// and the diagnostic, which the runtime has already scrubbed.

import { apiRouteUrl } from "@/lib/agent-protocol"
import { DIAGNOSTIC_HEADER, decodeDiagnostic, type CallDiagnostic } from "@/lib/sandbox/diagnostic"
import { MAX_SERVER_BODY_BYTES } from "@/lib/sandbox/http"
import { SandboxUnavailableError, type SandboxRunner } from "@/lib/sandbox/runner"
import { SELF_TEST_REASONS } from "@/lib/server-routes/self-test-protocol"

export type SelfTestStatus = "passed" | "failed" | "skipped"

export type SelfTestResult = {
  status: SelfTestStatus
  httpStatus?: number
  errorCode?: string
  diagnostic?: CallDiagnostic
  reason?: string
}

export const SELF_TEST_BUDGET_MS = 40_000
export const SELF_TEST_RETRY_DELAY_MS = 10_000
/** A step with less than this left doesn't start a test. */
export const SELF_TEST_MIN_STEP_MS = 60_000

const SERVER_CALL_LIMIT_MS = 30_000
const HANDLED_CODES = ["sign_in", "not_connected", "bad_request"]
const MAX_ERROR_MESSAGE_LENGTH = 300
const NO_BODY_STATUSES = [204, 205]

const TOOK_TOO_LONG = "it took more than 30 seconds"

export type SelfTestClock = {
  now: () => number
  /** Resolves after `ms`, or when `signal` aborts. */
  delay: (ms: number, signal?: AbortSignal) => Promise<void>
}

const realClock: SelfTestClock = {
  now: () => Date.now(),
  delay: (ms, signal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
    }),
}

export type SelfTestInput = {
  projectId: string
  path: string
  testBody: unknown
  runner: SandboxRunner
  /** The services the route uses (the backend counts as one, by its own slug). */
  usesServices?: string[]
  /** The slugs of the services that are connected. */
  connectedServices?: string[]
  backendConnected?: boolean
  /** The slug that stands for the app's backend in `usesServices`. */
  backendSlug?: string
  clock?: SelfTestClock
  budgetMs?: number
}

const skipped = (reason: string): SelfTestResult => ({ status: "skipped", reason })

function headerOf(headers: Record<string, string>, name: string) {
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name) return value
  return undefined
}

function readDiagnostic(headers: Record<string, string>): CallDiagnostic | undefined {
  return decodeDiagnostic(headerOf(headers, DIAGNOSTIC_HEADER)) ?? undefined
}

/** The error body's code and whether its message is a plain sentence, or null when the body isn't the standard error. */
function readErrorBody(body: string): { code: string; plain: boolean } | null {
  try {
    const error = (JSON.parse(body) as { error?: { code?: unknown; message?: unknown } } | null)?.error
    if (!error || typeof error.code !== "string") return null
    const message = typeof error.message === "string" ? error.message.trim() : ""
    return { code: error.code, plain: message.length > 0 && message.length <= MAX_ERROR_MESSAGE_LENGTH && !/[\r\n]/.test(message) }
  } catch {
    return null
  }
}

type Attempt = { kind: "answer"; value: Awaited<ReturnType<SandboxRunner["invoke"]>> } | { kind: "error"; error: unknown } | { kind: "timeout" }

export async function selfTestRoute(input: SelfTestInput): Promise<SelfTestResult> {
  const { projectId, path, testBody, runner, clock = realClock, budgetMs = SELF_TEST_BUDGET_MS } = input
  const connected = new Set(input.connectedServices ?? [])
  const backend = input.backendSlug ?? "backend"
  const uses = input.usesServices ?? []
  if (uses.some((slug) => (slug === backend ? !input.backendConnected : !connected.has(slug)))) return skipped(SELF_TEST_REASONS.serviceNotConnected)

  const startedAt = clock.now()
  const remaining = () => budgetMs - (clock.now() - startedAt)
  const body = JSON.stringify(testBody)

  const attempt = async (): Promise<Attempt> => {
    const left = remaining()
    if (left <= 0) return { kind: "timeout" }
    const stop = new AbortController()
    try {
      const call = runner
        .invoke(projectId, { method: "POST", path: apiRouteUrl(path), headers: { "content-type": "application/json" }, body })
        .then((value): Attempt => ({ kind: "answer", value }))
        .catch((error: unknown): Attempt => ({ kind: "error", error }))
      return await Promise.race([call, clock.delay(left, stop.signal).then((): Attempt => ({ kind: "timeout" }))])
    } finally {
      stop.abort()
    }
  }

  // A server that is still starting, or one that failed to start, gets one more try after a pause, inside the same budget.
  const isStartTrouble = (value: Attempt) =>
    value.kind === "error" && value.error instanceof SandboxUnavailableError && (value.error.reason === "starting" || value.error.reason === "failed")
  let outcome = await attempt()
  if (isStartTrouble(outcome) && remaining() > SELF_TEST_RETRY_DELAY_MS) {
    await clock.delay(SELF_TEST_RETRY_DELAY_MS)
    outcome = await attempt()
  }

  if (outcome.kind === "timeout") return { status: "failed", reason: TOOK_TOO_LONG }
  if (outcome.kind === "error") {
    const error = outcome.error
    if (!(error instanceof SandboxUnavailableError)) return skipped(SELF_TEST_REASONS.couldNotReach)
    if (error.reason === "disabled") return skipped(SELF_TEST_REASONS.serverNotRunning)
    if (error.reason === "limit") return skipped(SELF_TEST_REASONS.paused)
    return skipped(error.reason === "starting" ? SELF_TEST_REASONS.stillStarting : SELF_TEST_REASONS.couldNotStart)
  }

  const answer = outcome.value
  const diagnostic = readDiagnostic(answer.headers)
  const base = { httpStatus: answer.status, ...(diagnostic ? { diagnostic } : {}) }

  if (Buffer.byteLength(answer.body) > MAX_SERVER_BODY_BYTES) return { status: "failed", ...base, reason: "its answer was over 1 MB" }

  const timedOut = answer.status === 504 || (diagnostic?.ms ?? 0) >= SERVER_CALL_LIMIT_MS - 1000
  if (answer.status >= 500) return { status: "failed", ...base, ...(timedOut ? { reason: TOOK_TOO_LONG } : {}) }

  const errorBody = answer.status >= 400 ? readErrorBody(answer.body) : null
  if (errorBody) {
    const handled = HANDLED_CODES.includes(errorBody.code) && errorBody.plain
    return { status: handled ? "passed" : "failed", ...base, errorCode: errorBody.code }
  }
  if (answer.status >= 300) return { status: "failed", ...base }

  if (NO_BODY_STATUSES.includes(answer.status) && answer.body === "") return { status: "passed", ...base }
  try {
    JSON.parse(answer.body)
  } catch {
    return { status: "failed", ...base, reason: "its answer wasn't JSON" }
  }
  return { status: "passed", ...base }
}

function fetchProblem(fetch: CallDiagnostic["fetches"][number]): string | null {
  if (fetch.error === "timeout") return `the request to ${fetch.host} timed out`
  if (fetch.error === "blocked") return `the request to ${fetch.host} was blocked`
  if (fetch.error === "network") return `the request to ${fetch.host} couldn't connect`
  if ((fetch.status ?? 0) >= 400) return `${fetch.host} answered ${fetch.status}`
  return null
}

const MAX_THROWN_TEXT = 120

/** Error text that is safe to put in a chat sentence: one line, no Markdown control characters, no links, and not long. */
export function plainText(text: string, max: number): string {
  const clean = text
    .replace(/https?:\/\/([^\s/?#:]*)\S*/gi, "$1")
    .replace(/[*_[\]()#>|~`\\]/g, "").replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

/** A short plain description of why a test failed. It names only hosts, statuses and the error's name and message. */
export function summarizeSelfTest(result: SelfTestResult): string {
  const parts: string[] = []
  if (result.reason) parts.push(result.reason)
  const thrown = result.diagnostic?.thrown
  if (thrown && result.reason !== TOOK_TOO_LONG) parts.push(`it threw ${plainText(thrown.name, MAX_THROWN_TEXT)}: ${plainText(thrown.message, MAX_THROWN_TEXT)}`)
  const problems = (result.diagnostic?.fetches ?? []).flatMap((fetch) => fetchProblem(fetch) ?? [])
  parts.push(...[...new Set(problems)].slice(0, 3))
  if (parts.length === 0) parts.push(result.httpStatus ? `it answered ${result.httpStatus}` : "it didn't work")
  return parts.join("; ")
}
