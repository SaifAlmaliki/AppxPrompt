import type { ServiceCheck, ServiceDefinition } from "@/lib/services/protocol"

const TIMEOUT_MS = 10_000

export type CheckOutcome = "ok" | "rejected" | "unreachable"

export function buildCheckRequest(
  check: ServiceCheck,
  values: Record<string, string>,
): { url: string; init: RequestInit } {
  const value = values[check.credential] ?? ""
  const headers: Record<string, string> = {}
  let url = check.url
  if (check.placement.in === "header") {
    headers[check.placement.name] = check.placement.format.replaceAll("{value}", () => value)
  } else {
    const parsed = new URL(check.url)
    parsed.searchParams.append(check.placement.name, value)
    url = parsed.toString()
  }
  return { url, init: { method: check.method, headers } }
}

function allowed(definition: ServiceDefinition, url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" && definition.allowedHosts.includes(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function send(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) })
}

export async function runCheck(
  definition: ServiceDefinition,
  values: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckOutcome> {
  if (!definition.check) return "ok"
  try {
    const { url, init } = buildCheckRequest(definition.check, values)
    if (!allowed(definition, url)) return "unreachable"
    const response = await send(url, init, fetchImpl)
    if (response.status >= 200 && response.status < 300) return "ok"
    if (response.status === 401 || response.status === 403) return "rejected"
    return "unreachable"
  } catch {
    return "unreachable"
  }
}

function tokenRequest(definition: ServiceDefinition, params: Record<string, string>) {
  const tokenUrl = definition.oauth?.tokenUrl
  if (!tokenUrl || !allowed(definition, tokenUrl)) return null
  return {
    url: tokenUrl,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    } satisfies RequestInit,
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json()
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function exchangeCode(
  input: {
    definition: ServiceDefinition
    clientId: string
    clientSecret: string
    code: string
    verifier: string
    redirectUri: string
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshToken: string } | { error: "no_refresh_token" | "error" }> {
  const request = tokenRequest(input.definition, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.verifier,
  })
  if (!request) return { error: "error" }
  try {
    const response = await send(request.url, request.init, fetchImpl)
    if (response.status < 200 || response.status >= 300) return { error: "error" }
    const body = await readJson(response)
    if (!body) return { error: "error" }
    const refreshToken = body.refresh_token
    if (typeof refreshToken === "string" && refreshToken !== "") return { refreshToken }
    return { error: "no_refresh_token" }
  } catch {
    return { error: "error" }
  }
}

export async function refreshAccessToken(
  input: { definition: ServiceDefinition; clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CheckOutcome> {
  const request = tokenRequest(input.definition, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  })
  if (!request) return "unreachable"
  try {
    const response = await send(request.url, request.init, fetchImpl)
    if (response.status >= 200 && response.status < 300) return "ok"
    if (response.status === 400 || response.status === 401) {
      const body = await readJson(response)
      if (body?.error === "invalid_grant" || body?.error === "invalid_client") return "rejected"
    }
    return "unreachable"
  } catch {
    return "unreachable"
  }
}
