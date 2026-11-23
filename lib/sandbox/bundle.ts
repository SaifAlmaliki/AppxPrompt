import { isIP } from "node:net"
import { API_ROUTE_FILE, type AppPlan, type ServerRouteKind } from "@/lib/agent-protocol"
import type { ServiceSummary } from "@/lib/services/protocol"
import { compileServerFile } from "@/lib/sandbox/routes"

export { matchApiRoute } from "@/lib/sandbox/routes"

export const RUNTIME_VERSION = "1"
const SERVER_KEY_NAME = "APPXPROMPT_SERVER_KEY"

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
      secretNames: [...input.secretNames, SERVER_KEY_NAME],
    },
    env: { ...input.env, NODE_ENV: "production" },
    signature: input.signature,
  }
}
