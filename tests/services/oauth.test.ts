import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
  authorizationUrl,
  createPkce,
  encodeOAuthState,
  parseOAuthState,
  sameState,
} from "@/lib/services/oauth"
import type { ServiceDefinition } from "@/lib/services/protocol"

const google: ServiceDefinition = {
  slug: "google-calendar",
  name: "Google Calendar",
  purpose: "Read events",
  docsUrl: "https://developers.google.com/calendar",
  authKind: "oauth2",
  fields: [
    { name: "GOOGLE_CALENDAR_CLIENT_ID", label: "Client ID", kind: "public", help: "" },
    { name: "GOOGLE_CALENDAR_CLIENT_SECRET", label: "Client secret", kind: "secret", help: "" },
  ],
  allowedHosts: ["oauth2.googleapis.com", "www.googleapis.com"],
  oauth: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly", "openid"],
    params: { access_type: "offline", prompt: "consent" },
    clientIdField: "GOOGLE_CALENDAR_CLIENT_ID",
    clientSecretField: "GOOGLE_CALENDAR_CLIENT_SECRET",
  },
  check: null,
  setupSteps: "",
  notes: "",
}

describe("constants", () => {
  it("exposes the cookie name and lifetime", () => {
    expect(OAUTH_STATE_COOKIE).toBe("appxprompt_oauth_state")
    expect(OAUTH_STATE_MAX_AGE).toBe(1800)
  })
})

describe("createPkce", () => {
  it("derives an S256 challenge from a verifier of valid length", () => {
    const { verifier, challenge } = createPkce()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"))
  })

  it("returns a fresh verifier each time", () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier)
  })
})

describe("authorizationUrl", () => {
  it("builds the consent URL", () => {
    const url = new URL(authorizationUrl(google, "cid", "https://app.test/api/oauth/callback", "st", "ch"))
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    const p = url.searchParams
    expect(p.get("response_type")).toBe("code")
    expect(p.get("client_id")).toBe("cid")
    expect(p.get("redirect_uri")).toBe("https://app.test/api/oauth/callback")
    expect(p.get("scope")).toBe("https://www.googleapis.com/auth/calendar.readonly openid")
    expect(p.get("state")).toBe("st")
    expect(p.get("code_challenge")).toBe("ch")
    expect(p.get("code_challenge_method")).toBe("S256")
    expect(p.get("access_type")).toBe("offline")
    expect(p.get("prompt")).toBe("consent")
  })

  it("includes the expected raw parameter names", () => {
    const text = authorizationUrl(google, "cid", "https://app.test/cb", "st", "ch")
    for (const part of ["response_type=code", "client_id=", "redirect_uri=", "scope=", "state=", "code_challenge_method=S256", "access_type=offline", "prompt=consent"]) {
      expect(text).toContain(part)
    }
  })
})

describe("OAuth state", () => {
  const state = { state: "abc_-1", projectId: "proj123", slug: "google-calendar", verifier: "ver_-ifier" }

  it("round-trips", () => {
    expect(parseOAuthState(encodeOAuthState(state))).toEqual(state)
  })

  it("rejects malformed values", () => {
    expect(parseOAuthState(undefined)).toBeNull()
    expect(parseOAuthState("")).toBeNull()
    expect(parseOAuthState("a.b")).toBeNull()
    expect(parseOAuthState(`${encodeOAuthState(state)}.extra`)).toBeNull()
    expect(parseOAuthState("a..c.d")).toBeNull()
  })
})

describe("sameState", () => {
  it("compares in constant time with a length check", () => {
    expect(sameState("abc", "abc")).toBe(true)
    expect(sameState("abc", "abd")).toBe(false)
    expect(sameState("abc", "ab")).toBe(false)
  })
})
