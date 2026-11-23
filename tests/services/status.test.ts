import { describe, expect, it } from "vitest"
import type { ServiceDefinition } from "@/lib/services/protocol"
import { credentialHint, plannerServices, serviceStatus, summarizeService } from "@/lib/services/status"
import type { StoredCredential } from "@/lib/services/status"

const openai = {
  slug: "openai",
  name: "OpenAI",
  purpose: "Generate text",
  docsUrl: "https://platform.openai.com/docs",
  authKind: "api_key",
  fields: [{ name: "OPENAI_API_KEY", label: "API key", kind: "secret", help: "From the API keys page" }],
  allowedHosts: ["api.openai.com"],
  oauth: null,
  check: null,
  setupSteps: "Create a key.",
  notes: "",
} as ServiceDefinition

const google = {
  slug: "google-calendar",
  name: "Google Calendar",
  purpose: "Read events",
  docsUrl: "https://developers.google.com/calendar",
  authKind: "oauth2",
  fields: [
    { name: "GOOGLE_CALENDAR_CLIENT_ID", label: "Client ID", kind: "public", help: "OAuth client id" },
    { name: "GOOGLE_CALENDAR_CLIENT_SECRET", label: "Client secret", kind: "secret", help: "OAuth client secret" },
  ],
  allowedHosts: ["oauth2.googleapis.com", "www.googleapis.com"],
  oauth: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    params: {},
    clientIdField: "GOOGLE_CALENDAR_CLIENT_ID",
    clientSecretField: "GOOGLE_CALENDAR_CLIENT_SECRET",
  },
  check: null,
  setupSteps: "Create an OAuth client.",
  notes: "",
} as ServiceDefinition

const googleHosts = ["oauth2.googleapis.com", "www.googleapis.com"]

describe("credentialHint", () => {
  it("keeps a recognisable prefix and the last four characters", () => {
    expect(credentialHint("sk-proj-" + "a".repeat(36) + "a1b2", "secret")).toBe("sk-proj-…a1b2")
    expect(credentialHint("GOCSPX-abcdefghijklmnop1234", "secret")).toBe("GOCSPX-…1234")
  })

  it("hides short secrets entirely", () => {
    expect(credentialHint("short", "secret")).toBe("••••")
  })

  it("shows public values whole", () => {
    expect(credentialHint("123.apps.googleusercontent.com", "public")).toBe("123.apps.googleusercontent.com")
  })
})

describe("serviceStatus", () => {
  it("is connected when the key is set and approved hosts cover the service", () => {
    expect(serviceStatus(openai, new Set(["OPENAI_API_KEY"]), ["api.openai.com"], null)).toBe("connected")
  })

  it("is rejected when the check was rejected", () => {
    expect(serviceStatus(openai, new Set(["OPENAI_API_KEY"]), ["api.openai.com"], "rejected")).toBe("rejected")
  })

  it("is missing when a field is not set", () => {
    expect(serviceStatus(openai, new Set(), ["api.openai.com"], null)).toBe("missing")
  })

  it("is missing when an allowed host is not approved", () => {
    const wider = { ...openai, allowedHosts: ["api.openai.com", "files.openai.com"] }
    expect(serviceStatus(wider, new Set(["OPENAI_API_KEY"]), ["api.openai.com"], null)).toBe("missing")
  })

  it("needs a refresh token for oauth2 services", () => {
    const client = new Set(["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"])
    expect(serviceStatus(google, client, googleHosts, null)).toBe("missing")
    const withToken = new Set([...client, "GOOGLE_CALENDAR_REFRESH_TOKEN"])
    expect(serviceStatus(google, withToken, googleHosts, null)).toBe("connected")
    expect(serviceStatus(google, withToken, googleHosts, "rejected")).toBe("rejected")
  })
})

describe("summarizeService", () => {
  const credentials: StoredCredential[] = [
    { name: "GOOGLE_CALENDAR_CLIENT_ID", kind: "public", hint: "123.apps.googleusercontent.com", publicValue: "123.apps.googleusercontent.com" },
    { name: "GOOGLE_CALENDAR_CLIENT_SECRET", kind: "secret", hint: "GOCSPX-…1234", publicValue: null },
    { name: "GOOGLE_CALENDAR_REFRESH_TOKEN", kind: "oauth_token", hint: null, publicValue: null },
  ]

  it("reports hints and oauth state without secret values", () => {
    const decoy = { name: "DECOY", kind: "secret", hint: null, publicValue: null, sealed: "SEALED-SECRET-VALUE" }
    const summary = summarizeService(
      google,
      [...credentials, decoy as StoredCredential],
      googleHosts,
      null,
      new Date("2026-11-22T10:00:00Z"),
    )
    expect(summary.status).toBe("connected")
    expect(summary.oauthConnected).toBe(true)
    expect(summary.checkedAt).toBe("2026-11-22T10:00:00.000Z")
    expect(summary.fields[0]).toMatchObject({ name: "GOOGLE_CALENDAR_CLIENT_ID", set: true, hint: "123.apps.googleusercontent.com" })
    expect(summary.fields[1]).toMatchObject({ name: "GOOGLE_CALENDAR_CLIENT_SECRET", set: true, hint: "GOCSPX-…1234" })
    expect(JSON.stringify(summary)).not.toContain("SEALED-SECRET-VALUE")
  })

  it("marks unset fields and a missing refresh token", () => {
    const summary = summarizeService(google, [credentials[0]], googleHosts, null, null)
    expect(summary.status).toBe("missing")
    expect(summary.oauthConnected).toBe(false)
    expect(summary.checkedAt).toBeNull()
    expect(summary.fields[1]).toMatchObject({ set: false, hint: null })
  })
})

describe("plannerServices", () => {
  it("exposes only slug, name, status and field set state", () => {
    const summary = summarizeService(
      openai,
      [{ name: "OPENAI_API_KEY", kind: "secret", hint: "sk-…abcd", publicValue: null }],
      ["api.openai.com"],
      null,
      null,
    )
    expect(plannerServices([summary])).toEqual([
      { slug: "openai", name: "OpenAI", status: "connected", fields: [{ name: "OPENAI_API_KEY", set: true }] },
    ])
  })
})
