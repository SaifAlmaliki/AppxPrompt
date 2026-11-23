import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {}, projectCredentials: {}, projectServices: {} }))

import { SERVER_KEY_NAME, SYSTEM_SERVICE_SLUG, type CheckResult, type ServiceDefinition } from "@/lib/services/protocol"
import { connectedServiceCredentials } from "@/lib/services/store"

const openai: ServiceDefinition = {
  slug: "openai",
  name: "OpenAI",
  purpose: "Generate text",
  docsUrl: "https://platform.openai.com/docs",
  authKind: "api_key",
  fields: [{ name: "OPENAI_API_KEY", label: "API key", kind: "secret", help: "" }],
  allowedHosts: ["api.openai.com"],
  oauth: null,
  check: null,
  setupSteps: "",
  notes: "",
}

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
  allowedHosts: ["oauth2.googleapis.com", "www.googleapis.com", "calendar.example.com"],
  oauth: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["calendar"],
    params: {},
    clientIdField: "GOOGLE_CALENDAR_CLIENT_ID",
    clientSecretField: "GOOGLE_CALENDAR_CLIENT_SECRET",
  },
  check: null,
  setupSteps: "",
  notes: "",
}

const credentials = [
  { serviceSlug: "openai", name: "OPENAI_API_KEY" },
  { serviceSlug: "google-calendar", name: "GOOGLE_CALENDAR_CLIENT_ID" },
  { serviceSlug: "google-calendar", name: "GOOGLE_CALENDAR_CLIENT_SECRET" },
  { serviceSlug: "google-calendar", name: "GOOGLE_CALENDAR_REFRESH_TOKEN" },
  { serviceSlug: SYSTEM_SERVICE_SLUG, name: SERVER_KEY_NAME },
]

function services(openaiResult: CheckResult = "ok") {
  return [
    { slug: "openai", definition: openai, approvedHosts: ["api.openai.com"], checkResult: openaiResult },
    // A host was added after the owner approved the others.
    {
      slug: "google-calendar",
      definition: google,
      approvedHosts: ["oauth2.googleapis.com", "www.googleapis.com"],
      checkResult: "ok" as CheckResult,
    },
  ]
}

const names = (rows: { name: string }[]) => rows.map((row) => row.name)

describe("connectedServiceCredentials", () => {
  it("keeps connected services and the server key, and drops a service with an unapproved host", () => {
    expect(names(connectedServiceCredentials(services(), credentials))).toEqual(["OPENAI_API_KEY", SERVER_KEY_NAME])
  })

  it("drops the credentials of a rejected service but keeps the server key", () => {
    expect(names(connectedServiceCredentials(services("rejected"), credentials))).toEqual([SERVER_KEY_NAME])
  })

  it("gives only the server key when a service has no key stored", () => {
    const withoutKey = credentials.filter((credential) => credential.name !== "OPENAI_API_KEY")
    expect(names(connectedServiceCredentials(services(), withoutKey))).toEqual([SERVER_KEY_NAME])
  })

  it("drops credentials of a service that isn't saved at all", () => {
    expect(names(connectedServiceCredentials([], credentials))).toEqual([SERVER_KEY_NAME])
  })
})
