// The server functions, agents and helpers of a project's app. Server only, and the only
// module that reads or writes the `server_routes` table.

import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm"

import { db, projects, serverRoutes, type ServerRoute } from "@/db"
import type { AppPlan, ScreenStatus } from "@/lib/agent-protocol"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export function listServerRoutes(projectId: string): Promise<ServerRoute[]> {
  return db.select().from(serverRoutes).where(eq(serverRoutes.projectId, projectId)).orderBy(asc(serverRoutes.path))
}

/**
 * Makes the table match the plan before a build: every planned route has a row, those that
 * aren't built are waiting again, and routes the plan dropped are gone. Helpers stay.
 */
export async function prepareServerRoutes(projectId: string, plan: AppPlan): Promise<ServerRoute[]> {
  const planned = plan.serverRoutes ?? []
  const paths = planned.map((route) => route.path)
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(serverRoutes).where(eq(serverRoutes.projectId, projectId))
    const byPath = new Map(existing.map((row) => [row.path, row]))

    const added = planned.filter((route) => !byPath.has(route.path))
    if (added.length > 0) {
      await tx
        .insert(serverRoutes)
        .values(added.map((route) => ({ projectId, path: route.path, kind: route.kind, purpose: route.purpose })))
        .onConflictDoNothing()
    }

    for (const route of planned) {
      const row = byPath.get(route.path)
      if (!row || row.status === "done") continue
      await tx
        .update(serverRoutes)
        .set({ status: "pending", kind: route.kind, purpose: route.purpose })
        .where(and(eq(serverRoutes.projectId, projectId), eq(serverRoutes.path, route.path)))
    }

    const routeRows = and(eq(serverRoutes.projectId, projectId), inArray(serverRoutes.kind, ["function", "agent"]))
    await tx.delete(serverRoutes).where(paths.length > 0 ? and(routeRows, notInArray(serverRoutes.path, paths)) : routeRows)
  })
  return listServerRoutes(projectId)
}

export async function setServerRouteStatus(
  projectId: string,
  path: string,
  status: ScreenStatus,
  code?: string,
): Promise<ServerRoute> {
  const [row] = await db
    .update(serverRoutes)
    .set({ status, ...(code === undefined ? {} : { code }), ...(status === "generating" ? { selfTest: null, selfTestDetail: null } : {}) })
    .where(and(eq(serverRoutes.projectId, projectId), eq(serverRoutes.path, path)))
    .returning()
  if (!row) throw new Error(`The server route ${path} doesn't exist.`)
  return row
}

/** How the one try of a built route went, as kept with it. */
export type SelfTestRecord = { status: "passed" | "failed" | "skipped"; detail: string | null }

/** Saves a finished route, and in the same transaction drops its queued change, if it had one, from the plan. */
export async function finishServerRoute(projectId: string, path: string, code: string, selfTest: SelfTestRecord | null = null): Promise<ServerRoute> {
  return db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ plan: sql`${projects.plan} #- ${`{pendingChanges,serverRoutes,"${path}"}`}::text[]` })
      .where(eq(projects.id, projectId))
    const [row] = await tx
      .update(serverRoutes)
      .set({ status: "done", code, selfTest: selfTest?.status ?? null, selfTestDetail: selfTest?.detail ?? null })
      .where(and(eq(serverRoutes.projectId, projectId), eq(serverRoutes.path, path)))
      .returning()
    if (!row) throw new Error(`The server route ${path} doesn't exist.`)
    return row
  })
}

export async function saveServerHelper(projectId: string, path: string, purpose: string, code: string): Promise<ServerRoute> {
  const [row] = await db
    .insert(serverRoutes)
    .values({ projectId, path, kind: "helper", purpose, code, status: "done" })
    .onConflictDoUpdate({
      target: [serverRoutes.projectId, serverRoutes.path],
      set: { purpose, code, status: "done", updatedAt: new Date() },
      // Only a helper is replaced: a function or agent at this path keeps its own row.
      setWhere: eq(serverRoutes.kind, "helper"),
    })
    .returning()
  if (!row) throw new Error(`${path} is a server route, not a helper.`)
  return row
}

/** A build that stopped leaves its waiting routes failed, so they can be tried again. */
export function failWaitingServerRoutes(projectId: string): Promise<ServerRoute[]> {
  return db
    .update(serverRoutes)
    .set({ status: "failed" })
    .where(and(eq(serverRoutes.projectId, projectId), inArray(serverRoutes.status, ["pending", "generating"])))
    .returning()
}

export async function removeServerRoutes(tx: Transaction, projectId: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await tx.delete(serverRoutes).where(and(eq(serverRoutes.projectId, projectId), inArray(serverRoutes.path, paths)))
}

/** Copies every route and helper as it is. Nothing is charged: a copied route with code counts as built. */
export async function copyServerRoutes(tx: Transaction, fromProjectId: string, toProjectId: string): Promise<void> {
  const rows = await tx.select().from(serverRoutes).where(eq(serverRoutes.projectId, fromProjectId))
  if (rows.length === 0) return
  await tx.insert(serverRoutes).values(
    rows.map((row) => ({
      projectId: toProjectId,
      path: row.path,
      kind: row.kind,
      purpose: row.purpose,
      code: row.code,
      status: row.status,
      selfTest: row.selfTest,
      selfTestDetail: row.selfTestDetail,
    })),
  )
}
