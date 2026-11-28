// What the Activity panel and its route share. Safe to import from the browser.

export const SERVER_CALL_ERROR_CODES = ["not_connected", "sign_in", "bad_request", "unavailable", "preview"] as const
export type ServerCallErrorCode = (typeof SERVER_CALL_ERROR_CODES)[number]

import { failurePath, type ServerFailureContext } from "@/lib/agent-protocol"
import type { CallDiagnostic, FetchDiagnostic } from "@/lib/sandbox/diagnostic"

export type ServerCallEntry = {
  id: number
  path: string
  method: string
  status: number
  errorCode: ServerCallErrorCode | null
  service: string | null
  durationMs: number
  /** Hosts the function reached and the first line of what it threw. Null when there is nothing to tell. */
  detail: CallDiagnostic | null
  createdAt: string
}

/** Words for one outgoing call: a message key under preview.activity.detail plus its values. */
export type FetchDescription = { key: "status" | "blocked" | "timeout" | "network"; host: string; status?: number }

export function describeFetch(fetch: FetchDiagnostic): FetchDescription {
  if (fetch.error) return { key: fetch.error, host: fetch.host }
  return { key: "status", host: fetch.host, status: fetch.status }
}

/** The outgoing call that most likely explains a failure: one that was blocked, timed out, couldn't connect or answered an error. */
export function failingFetch(detail: CallDiagnostic | null): FetchDiagnostic | null {
  if (!detail) return null
  return detail.fetches.find((fetch) => fetch.error) ?? detail.fetches.find((fetch) => (fetch.status ?? 0) >= 400) ?? null
}

/**
 * Why a call failed, as a kind of reason with only the host and status of an outgoing call. Never the text it threw,
 * which can come from a service: the sentence sent to the agent is ours alone, and the facts travel in the failure block.
 */
export type FailureReason = { key: FetchDescription["key"] | "thrown" | "result"; host?: string; status?: number }

export function failureReason(call: Pick<ServerCallEntry, "detail">): FailureReason {
  const problem = failingFetch(call.detail)
  if (problem) return describeFetch(problem)
  return call.detail?.thrown ? { key: "thrown" } : { key: "result" }
}

export type ActivityTranslator = (key: string, values?: Record<string, string | number>) => string

/** The sentence the owner sends to fix a failed call, from `preview.activity`. It names the function and a reason of ours, and no text from the call. */
export function fixMessage(call: Pick<ServerCallEntry, "path" | "status" | "errorCode" | "detail">, t: ActivityTranslator): string {
  const reason = failureReason(call)
  const text =
    reason.key === "result"
      ? t(`results.${serverCallResult(call)}`, { status: call.status })
      : t(`fix.reason.${reason.key}`, { host: reason.host ?? "", status: reason.status ?? 0 })
  return t("fix.message", { function: failurePath(call.path) || "?", reason: text.replace(/[.\s]+$/, "") })
}

/** Whether the owner can ask the agent to fix this call: the function broke or didn't understand what it was sent. */
export function canFixCall(call: Pick<ServerCallEntry, "status" | "errorCode">): boolean {
  return call.status >= 500 || call.errorCode === "unavailable" || call.errorCode === "bad_request"
}

/** What the agent is told about a stored call: its address, status and the diagnostic already checked and scrubbed. Never a body, header or value. */
export function serverFailureOf(call: ServerCallEntry): ServerFailureContext {
  return { path: call.path, status: call.status, diagnostic: call.detail ?? { ms: call.durationMs, fetches: [] } }
}

/** Which words describe a call's result: "ok", one of the error codes, or a bare failing status. */
export type ServerCallResult = ServerCallErrorCode | "ok" | "failed"

export function serverCallResult(call: Pick<ServerCallEntry, "status" | "errorCode">): ServerCallResult {
  if (call.errorCode) return call.errorCode
  return call.status >= 400 ? "failed" : "ok"
}
