import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import type { ServiceDefinition } from "@/lib/services/protocol"

export const OAUTH_STATE_COOKIE = "appxprompt_oauth_state"
export const OAUTH_STATE_MAX_AGE = 1800

export type OAuthState = { state: string; projectId: string; slug: string; verifier: string }

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

export function authorizationUrl(
  definition: ServiceDefinition,
  clientId: string,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const oauth = definition.oauth
  if (!oauth) throw new Error(`${definition.slug} has no OAuth configuration`)
  const url = new URL(oauth.authUrl)
  for (const [key, value] of Object.entries(oauth.params)) url.searchParams.set(key, value)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", oauth.scopes.join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

export function encodeOAuthState(s: OAuthState): string {
  return [s.state, s.projectId, s.slug, s.verifier].join(".")
}

export function parseOAuthState(cookie: string | undefined): OAuthState | null {
  if (!cookie) return null
  const parts = cookie.split(".")
  if (parts.length !== 4 || parts.some((part) => part === "")) return null
  const [state, projectId, slug, verifier] = parts
  return { state, projectId, slug, verifier }
}

export function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
