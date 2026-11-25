// What the owner sees of their app's server function calls. Server only. A row holds
// the function's path, method, status, error code, service and duration, and nothing
// else: no body, header, query string, address or token ever reaches this file's table.

import { desc, eq, notInArray, and } from "drizzle-orm"

import { db, serverRouteCalls } from "@/db"
import { SERVER_CALL_ERROR_CODES, type ServerCallEntry } from "@/lib/server-routes/activity-protocol"

export const MAX_STORED_CALLS = 200
const MAX_PATH_LENGTH = 300
const MAX_METHOD_LENGTH = 10
const MAX_SERVICE_LENGTH = 64

export type ServerCallInput = {
  projectId: string
  path: string
  method: string
  status: number
  errorCode: string | null
  service: string | null
  durationMs: number
}

/** The row to store: the query string is cut off and every field is held to a safe shape. */
export function toCallRow(call: ServerCallInput) {
  const code = (SERVER_CALL_ERROR_CODES as readonly string[]).includes(call.errorCode ?? "") ? call.errorCode : null
  const service = call.service && /^[a-z0-9][a-z0-9_-]*$/i.test(call.service) ? call.service.slice(0, MAX_SERVICE_LENGTH) : null
  return {
    projectId: call.projectId,
    path: call.path.split(/[?#]/)[0].slice(0, MAX_PATH_LENGTH),
    method: call.method.toUpperCase().slice(0, MAX_METHOD_LENGTH),
    status: Math.trunc(call.status),
    errorCode: code as ServerCallEntry["errorCode"],
    service,
    durationMs: Math.max(0, Math.trunc(call.durationMs)),
  }
}

/** Never throws: a failure to record must not break the call it describes. */
export async function recordServerCall(call: ServerCallInput): Promise<void> {
  try {
    const row = toCallRow(call)
    await db.insert(serverRouteCalls).values(row)
    const newest = db
      .select({ id: serverRouteCalls.id })
      .from(serverRouteCalls)
      .where(eq(serverRouteCalls.projectId, row.projectId))
      .orderBy(desc(serverRouteCalls.id))
      .limit(MAX_STORED_CALLS)
    await db.delete(serverRouteCalls).where(and(eq(serverRouteCalls.projectId, row.projectId), notInArray(serverRouteCalls.id, newest)))
  } catch (error) {
    console.error("Recording a server call failed", error instanceof Error ? error.name : "unknown")
  }
}

/** The project's calls, newest first. */
export async function listServerCalls(projectId: string, limit = 100): Promise<ServerCallEntry[]> {
  const rows = await db
    .select()
    .from(serverRouteCalls)
    .where(eq(serverRouteCalls.projectId, projectId))
    .orderBy(desc(serverRouteCalls.id))
    .limit(Math.min(Math.max(1, Math.trunc(limit)), MAX_STORED_CALLS))
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    method: row.method,
    status: row.status,
    errorCode: row.errorCode,
    service: row.service,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  }))
}
