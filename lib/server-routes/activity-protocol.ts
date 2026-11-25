// What the Activity panel and its route share. Safe to import from the browser.

export const SERVER_CALL_ERROR_CODES = ["not_connected", "sign_in", "bad_request", "unavailable", "preview"] as const
export type ServerCallErrorCode = (typeof SERVER_CALL_ERROR_CODES)[number]

export type ServerCallEntry = {
  id: number
  path: string
  method: string
  status: number
  errorCode: ServerCallErrorCode | null
  service: string | null
  durationMs: number
  createdAt: string
}

/** Which words describe a call's result: "ok", one of the error codes, or a bare failing status. */
export type ServerCallResult = ServerCallErrorCode | "ok" | "failed"

export function serverCallResult(call: Pick<ServerCallEntry, "status" | "errorCode">): ServerCallResult {
  if (call.errorCode) return call.errorCode
  return call.status >= 400 ? "failed" : "ok"
}
