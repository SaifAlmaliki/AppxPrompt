import { createHash } from "node:crypto"
import { isIP } from "node:net"
import { eq, sql } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import { db, projectCredentials, projectServices, projects, serverRoutes } from "@/db"
import { API_ROUTE_FILE, type AppPlan, type ServerRouteKind } from "@/lib/agent-protocol"
import { generatedServerFiles } from "@/lib/generated-app/server-files"
import { compileServerFile } from "@/lib/sandbox/routes"
import { listServerRoutes } from "@/lib/server-routes/store"
import { SERVER_KEY_NAME, type ServiceSummary } from "@/lib/services/protocol"
import { ensureServerKey } from "@/lib/services/server-key"
import { listServiceSummaries, loadProjectEnvironment } from "@/lib/services/store"

export { matchApiRoute } from "@/lib/sandbox/routes"

export const RUNTIME_VERSION = "1"

/** What the sandbox runs. Holds no credential values. */
export type RuntimeBundle = { files: Record<string, string>; routes: string[]; allowedHosts: string[]; secretNames: string[] }
export type SandboxBundle = { runtime: RuntimeBundle; env: Record<string, string>; signature: string }

type ServerFile = { path: string; code: string }

function allowedHost(host: string) {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, "")
  if (!name || name === "localhost" || name.endsWith(".localhost") || isIP(name)) return null
  return name
}

function urlHost(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? allowedHost(url.hostname) : null
  } catch {
    return null
  }
}

/** The hosts server code may call: approved hosts of connected services, plus the app's own site and auth. */
export function serverAllowedHosts(plan: AppPlan, services: Pick<ServiceSummary, "allowedHosts" | "status">[]) {
  const hosts = new Set<string>()
  for (const service of services) {
    if (service.status !== "connected") continue
    for (const host of service.allowedHosts) {
      const name = allowedHost(host)
      if (name) hosts.add(name)
    }
  }
  if (plan.backend) {
    for (const value of [process.env.NEXT_PUBLIC_APP_URL, plan.backend.authUrl]) {
      const host = urlHost(value)
      if (host) hosts.add(host)
    }
  }
  return [...hosts].sort()
}

/** The source of every server file, uncompiled. What the sandbox runs and what a deploy ships. */
export function serverSources(systemFiles: ServerFile[], rows: { path: string; code: string | null }[]): ServerFile[] {
  const files = new Map<string, string>()
  for (const file of systemFiles) files.set(file.path, file.code)
  for (const row of rows) if (row.code !== null) files.set(row.path, row.code)
  return [...files].map(([path, code]) => ({ path, code })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export function assembleBundle(input: {
  plan: AppPlan
  rows: { path: string; kind: ServerRouteKind; code: string | null }[]
  systemFiles: ServerFile[]
  services: Pick<ServiceSummary, "allowedHosts" | "status">[]
  env: Record<string, string>
  secretNames: string[]
  signature: string
}): SandboxBundle {
  const sources = serverSources(input.systemFiles, input.rows)
  const files: Record<string, string> = {}
  for (const { path, code } of sources) files[path] = compileServerFile(path, code)
  const routes = sources.map((file) => file.path).filter((path) => API_ROUTE_FILE.test(path))
  return {
    runtime: {
      files,
      routes,
      allowedHosts: serverAllowedHosts(input.plan, input.services),
      // Every name must have a value in env, or the sandbox's self-check counts fewer credentials than the host expects.
      secretNames: [...new Set([...input.secretNames.filter((name) => name in input.env), SERVER_KEY_NAME])],
    },
    env: { ...input.env, NODE_ENV: "production" },
    signature: input.signature,
  }
}

async function projectPlan(projectId: string): Promise<AppPlan | null> {
  const [row] = await db.select({ plan: projects.plan }).from(projects).where(eq(projects.id, projectId))
  if (!row) throw new Error("The project doesn't exist.")
  return row.plan
}

export async function serverSourceFiles(projectId: string): Promise<ServerFile[]> {
  const [plan, rows] = await Promise.all([projectPlan(projectId), listServerRoutes(projectId)])
  return serverSources(generatedServerFiles(plan), rows)
}

function tableStats(table: PgTable, projectColumn: PgColumn, updatedColumn: PgColumn, projectId: string) {
  return sql`(select concat_ws(':', max(${updatedColumn})::text, count(*)::text) from ${table} where ${projectColumn} = ${projectId})`
}

/** Changes whenever anything the sandbox is built from changes, so a running VM can tell it is stale. One query, no credential values. */
export async function sandboxSignature(projectId: string): Promise<string> {
  const rows = await db.execute<{
    routes: string | null
    credentials: string | null
    services: string | null
    backend: string | null
    planned: string | null
  }>(sql`
    select
      ${tableStats(serverRoutes, serverRoutes.projectId, serverRoutes.updatedAt, projectId)} as routes,
      ${tableStats(projectCredentials, projectCredentials.projectId, projectCredentials.updatedAt, projectId)} as credentials,
      ${tableStats(projectServices, projectServices.projectId, projectServices.updatedAt, projectId)} as services,
      (select ${projects.plan}->'backend' from ${projects} where ${projects.id} = ${projectId})::text as backend,
      (select ${projects.plan}->'serverRoutes' from ${projects} where ${projects.id} = ${projectId})::text as planned
  `)
  const row = rows[0]
  const parts = [row?.routes, row?.credentials, row?.services, row?.backend, row?.planned, RUNTIME_VERSION]
  return createHash("sha256").update(parts.map((part) => part ?? "").join("\n")).digest("hex")
}

export async function buildSandboxBundle(projectId: string): Promise<SandboxBundle> {
  const [plan, rows, services] = await Promise.all([projectPlan(projectId), listServerRoutes(projectId), listServiceSummaries(projectId)])
  if (!plan) throw new Error("The project has no plan.")
  await ensureServerKey(projectId)
  const { env, secretNames } = await loadProjectEnvironment(projectId)
  return assembleBundle({
    plan,
    rows,
    systemFiles: generatedServerFiles(plan),
    services,
    env,
    secretNames,
    signature: await sandboxSignature(projectId),
  })
}
