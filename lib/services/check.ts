import * as Sentry from "@sentry/nextjs"

import { pinnedFetch, type PinnedInit } from "@/lib/research/safe-fetch"
import { resolvesToPublicAddress } from "@/lib/services/public-host"
import type { ServiceCheck, ServiceDefinition } from "@/lib/services/protocol"

const TIMEOUT_MS = 10_000

export type CheckOutcome = "ok" | "rejected" | "unreachable"

type HostResolver = (host: string) => Promise<boolean>
type CheckFetch = (url: string, init: PinnedInit) => Promise<Response>

// Connects only to public addresses, checked at connect time, closing the gap a pre-check alone leaves.
export const DEFAULT_CHECK_FETCH: CheckFetch = pinnedFetch

export function buildCheckRequest(
  check: ServiceCheck,
  values: Record<string, string>,
): { url: string; init: PinnedInit } {
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

/** The host to call, or null when the URL isn't https on the default port, has userinfo, or isn't an allowed host. */
function allowedHost(definition: ServiceDefinition, url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" || parsed.port !== "" || parsed.username !== "" || parsed.password !== "") return null
    const host = parsed.hostname.toLowerCase()
    return definition.allowedHosts.includes(host) ? host : null
  } catch {
    return null
  }
}

// The request carries the owner's credential, so it stays out of traces.
function send(url: string, init: PinnedInit, fetchImpl: CheckFetch): Promise<Response> {
  return Sentry.suppressTracing(() =>
    fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) }),
  )
}

export async function runCheck(
  definition: ServiceDefinition,
  values: Record<string, string>,
  fetchImpl: CheckFetch = DEFAULT_CHECK_FETCH,
  resolver: HostResolver = resolvesToPublicAddress,
): Promise<CheckOutcome> {
  if (!definition.check) return "unreachable"
  try {
    const { url, init } = buildCheckRequest(definition.check, values)
    const host = allowedHost(definition, url)
    if (!host || !(await resolver(host))) return "unreachable"
    const response = await send(url, init, fetchImpl)
    if (response.status >= 200 && response.status < 300) return "ok"
    if (response.status === 401 || response.status === 403) return "rejected"
    return "unreachable"
  } catch {
    return "unreachable"
  }
}

async function tokenRequest(definition: ServiceDefinition, params: Record<string, string>, resolver: HostResolver) {
  const tokenUrl = definition.oauth?.tokenUrl
  if (!tokenUrl) return null
  const host = allowedHost(definition, tokenUrl)
  if (!host || !(await resolver(host))) return null
  return {
    url: tokenUrl,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    } satisfies PinnedInit,
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
  fetchImpl: CheckFetch = DEFAULT_CHECK_FETCH,
  resolver: HostResolver = resolvesToPublicAddress,
): Promise<{ refreshToken: string } | { error: "no_refresh_token" | "error" }> {
  const request = await tokenRequest(input.definition, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.verifier,
  }, resolver)
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
  fetchImpl: CheckFetch = DEFAULT_CHECK_FETCH,
  resolver: HostResolver = resolvesToPublicAddress,
): Promise<CheckOutcome> {
  const request = await tokenRequest(input.definition, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  }, resolver)
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
