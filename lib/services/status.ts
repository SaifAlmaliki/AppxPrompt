import { refreshTokenName } from "./protocol"
import type { CheckResult, PlannerService, ServiceDefinition, ServiceStatus, ServiceSummary } from "./protocol"

export type StoredCredential = {
  name: string
  kind: "secret" | "public" | "oauth_token"
  hint: string | null
  publicValue: string | null
}

const HINT_PREFIX = /^[A-Za-z]{2,8}[-_](?:proj-)?/

export function credentialHint(value: string, kind: "secret" | "public"): string {
  if (kind === "public") return value
  if (value.length < 12) return "••••"
  const prefix = HINT_PREFIX.exec(value)?.[0] ?? ""
  return `${prefix}…${value.slice(-4)}`
}

export function serviceStatus(
  definition: ServiceDefinition,
  setNames: ReadonlySet<string>,
  approvedHosts: readonly string[],
  checkResult: CheckResult,
): ServiceStatus {
  if (definition.allowedHosts.some((host) => !approvedHosts.includes(host))) return "missing"
  const required = definition.fields.map((field) => field.name)
  if (definition.authKind === "oauth2") required.push(refreshTokenName(definition.slug))
  if (required.some((name) => !setNames.has(name))) return "missing"
  return checkResult === "rejected" ? "rejected" : "connected"
}

export function summarizeService(
  definition: ServiceDefinition,
  credentials: StoredCredential[],
  approvedHosts: readonly string[],
  checkResult: CheckResult,
  checkedAt: Date | null,
): ServiceSummary {
  const byName = new Map(credentials.map((credential) => [credential.name, credential]))
  const setNames = new Set(byName.keys())
  return {
    slug: definition.slug,
    name: definition.name,
    purpose: definition.purpose,
    docsUrl: definition.docsUrl,
    authKind: definition.authKind,
    allowedHosts: definition.allowedHosts,
    setupSteps: definition.setupSteps,
    status: serviceStatus(definition, setNames, approvedHosts, checkResult),
    checkResult,
    checkedAt: checkedAt ? checkedAt.toISOString() : null,
    fields: definition.fields.map((field) => ({
      name: field.name,
      label: field.label,
      kind: field.kind,
      help: field.help,
      set: setNames.has(field.name),
      hint: byName.get(field.name)?.hint ?? null,
    })),
    oauthConnected: setNames.has(refreshTokenName(definition.slug)),
  }
}

export function plannerServices(summaries: ServiceSummary[]): PlannerService[] {
  return summaries.map((summary) => ({
    slug: summary.slug,
    name: summary.name,
    status: summary.status,
    fields: summary.fields.map((field) => ({ name: field.name, set: field.set })),
  }))
}
