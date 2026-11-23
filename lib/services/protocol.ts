export type ServiceFieldKind = "secret" | "public"

export type ServiceField = { name: string; label: string; kind: ServiceFieldKind; help: string }

export type OAuthConfig = {
  authUrl: string
  tokenUrl: string
  scopes: string[]
  params: Record<string, string>
  clientIdField: string
  clientSecretField: string
}

export type ServiceCheck = {
  method: "GET" | "POST"
  url: string
  credential: string
  placement: { in: "header"; name: string; format: string } | { in: "query"; name: string }
}

export type ServiceDefinition = {
  slug: string
  name: string
  purpose: string
  docsUrl: string
  authKind: "api_key" | "oauth2"
  fields: ServiceField[]
  allowedHosts: string[]
  oauth: OAuthConfig | null
  check: ServiceCheck | null
  setupSteps: string
  notes: string
}

export type ServiceStatus = "missing" | "connected" | "rejected"

export type CheckResult = "ok" | "rejected" | null

export type ServiceSummary = {
  slug: string
  name: string
  purpose: string
  docsUrl: string
  authKind: ServiceDefinition["authKind"]
  allowedHosts: string[]
  setupSteps: string
  status: ServiceStatus
  checkResult: CheckResult
  checkedAt: string | null
  fields: { name: string; label: string; kind: ServiceFieldKind; help: string; set: boolean; hint: string | null }[]
  oauthConnected: boolean
}

export type PlannerService = {
  slug: string
  name: string
  status: ServiceStatus
  fields: { name: string; set: boolean }[]
}

export const SERVICE_CONNECT_RESULTS = ["connected", "denied", "no_refresh_token", "error"] as const

export type ServiceConnectResult = (typeof SERVICE_CONNECT_RESULTS)[number]

export const OAUTH_CALLBACK_PATH = "/api/oauth/callback"

export function oauthRedirectUri(origin: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || origin}${OAUTH_CALLBACK_PATH}`
}

/** "google-calendar" -> "GOOGLE_CALENDAR" */
export function envPrefix(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_")
}

export function refreshTokenName(slug: string): string {
  return `${envPrefix(slug)}_REFRESH_TOKEN`
}
