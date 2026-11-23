import { describe, expect, it } from "vitest"
import { addedHosts, normalizeService, serviceDefinitionSchema, validateValues } from "@/lib/services/definition"
import { envPrefix, refreshTokenName } from "@/lib/services/protocol"
import type { z } from "zod"

type Input = z.infer<typeof serviceDefinitionSchema>

function openaiInput(overrides: Partial<Input> = {}): Input {
  return {
    slug: "openai",
    name: "OpenAI",
    purpose: "Generate text",
    docsUrl: "https://platform.openai.com/docs",
    authKind: "api_key",
    fields: [{ name: "OPENAI_API_KEY", label: "API key", kind: "secret", help: "From the API keys page" }],
    allowedHosts: ["api.openai.com"],
    oauth: null,
    check: {
      method: "GET",
      url: "https://api.openai.com/v1/models",
      credential: "OPENAI_API_KEY",
      placement: { in: "header", name: "Authorization", format: "Bearer {value}" },
    },
    setupSteps: "Create a key.",
    notes: "Use the chat completions API.",
    ...overrides,
  }
}

function googleInput(overrides: Partial<Input> = {}): Input {
  return {
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
      params: [
        { key: "access_type", value: "offline" },
        { key: "prompt", value: "consent" },
      ],
      clientIdField: "GOOGLE_CALENDAR_CLIENT_ID",
      clientSecretField: "GOOGLE_CALENDAR_CLIENT_SECRET",
      rotatesRefreshToken: false,
    },
    check: null,
    setupSteps: "Create an OAuth client.",
    notes: "",
    ...overrides,
  }
}

function openaiDefinition() {
  const definition = normalizeService(openaiInput())
  if (typeof definition === "string") throw new Error(definition)
  return definition
}

describe("normalizeService", () => {
  it("accepts a valid api_key service", () => {
    const definition = normalizeService(openaiInput())
    expect(typeof definition).toBe("object")
    if (typeof definition === "string") return
    expect(definition.allowedHosts).toEqual(["api.openai.com"])
  })

  it("accepts a valid oauth2 service", () => {
    expect(typeof normalizeService(googleInput())).toBe("object")
  })

  it("requires field names to start with the service prefix", () => {
    const result = normalizeService(
      openaiInput({ fields: [{ name: "API_KEY", label: "Key", kind: "secret", help: "" }] }),
    )
    expect(result).toContain("OPENAI_")
  })

  it("lowercases and dedupes hosts", () => {
    const result = normalizeService(openaiInput({ allowedHosts: ["API.OpenAI.com", "api.openai.com"] }))
    expect(typeof result).toBe("object")
    if (typeof result !== "string") expect(result.allowedHosts).toEqual(["api.openai.com"])
  })

  it("refuses IP literals and localhost", () => {
    expect(typeof normalizeService(openaiInput({ allowedHosts: ["127.0.0.1"] }))).toBe("string")
    expect(typeof normalizeService(openaiInput({ allowedHosts: ["localhost"] }))).toBe("string")
  })

  it("refuses a check URL on a host that isn't allowed", () => {
    const base = openaiInput()
    const result = normalizeService(openaiInput({ check: { ...base.check!, url: "https://evil.example.com/v1/models" } }))
    expect(typeof result).toBe("string")
  })

  it("refuses a token URL on a host that isn't allowed", () => {
    const base = googleInput()
    const result = normalizeService(
      googleInput({ oauth: { ...base.oauth!, tokenUrl: "https://evil.example.com/token" } }),
    )
    expect(typeof result).toBe("string")
  })

  it("refuses check, token and auth URLs with a port or userinfo", () => {
    const api = openaiInput()
    for (const url of ["https://api.openai.com:8443/v1/models", "https://user:pw@api.openai.com/v1/models"]) {
      expect(typeof normalizeService(openaiInput({ check: { ...api.check!, url } }))).toBe("string")
    }
    const google = googleInput()
    for (const tokenUrl of ["https://oauth2.googleapis.com:8443/token", "https://a@oauth2.googleapis.com/token"]) {
      expect(typeof normalizeService(googleInput({ oauth: { ...google.oauth!, tokenUrl } }))).toBe("string")
    }
    for (const authUrl of ["https://accounts.google.com:444/auth", "https://a:b@accounts.google.com/auth"]) {
      expect(typeof normalizeService(googleInput({ oauth: { ...google.oauth!, authUrl } }))).toBe("string")
    }
  })

  it("accepts the default port written out", () => {
    const api = openaiInput()
    expect(typeof normalizeService(openaiInput({ check: { ...api.check!, url: "https://api.openai.com:443/v1/models" } }))).toBe("object")
  })

  it("refuses refresh token rotation", () => {
    const base = googleInput()
    const result = normalizeService(googleInput({ oauth: { ...base.oauth!, rotatesRefreshToken: true } }))
    expect(result).toBe("Google Calendar issues a new refresh token on every refresh, which isn't supported yet.")
  })

  it("refuses reserved authorization params", () => {
    const base = googleInput()
    const result = normalizeService(googleInput({ oauth: { ...base.oauth!, params: [{ key: "redirect_uri", value: "x" }] } }))
    expect(typeof result).toBe("string")
  })

  it("stores authorization params as a record, with later duplicates winning", () => {
    const base = googleInput()
    const result = normalizeService(
      googleInput({
        oauth: {
          ...base.oauth!,
          params: [
            { key: "access_type", value: "online" },
            { key: "prompt", value: "consent" },
            { key: "access_type", value: "offline" },
          ],
        },
      }),
    )
    expect(typeof result).toBe("object")
    if (typeof result !== "string") expect(result.oauth?.params).toEqual({ access_type: "offline", prompt: "consent" })
  })

  it("refuses credentials in service text", () => {
    const result = normalizeService(openaiInput({ notes: "key is sk-proj-" + "a".repeat(40) }))
    expect(result).toBe("Service text can't contain credentials.")
  })
})

describe("validateValues", () => {
  it("trims values", () => {
    expect(validateValues(openaiDefinition(), { OPENAI_API_KEY: "  sk-x  " })).toEqual({ OPENAI_API_KEY: "sk-x" })
  })

  it("drops empty values", () => {
    expect(validateValues(openaiDefinition(), { OPENAI_API_KEY: "" })).toEqual({})
  })

  it("refuses unknown fields", () => {
    expect(validateValues(openaiDefinition(), { OTHER: "x" })).toBe("Unknown field OTHER.")
  })

  it("refuses values that are too long", () => {
    expect(typeof validateValues(openaiDefinition(), { OPENAI_API_KEY: "x".repeat(4097) })).toBe("string")
  })
})

describe("addedHosts", () => {
  it("lists only newly allowed hosts", () => {
    expect(addedHosts(["a.com"], ["a.com", "b.com"])).toEqual(["b.com"])
    expect(addedHosts(["a.com", "b.com"], ["a.com"])).toEqual([])
  })
})

describe("protocol helpers", () => {
  it("derives env names from the slug", () => {
    expect(envPrefix("google-calendar")).toBe("GOOGLE_CALENDAR")
    expect(refreshTokenName("google-calendar")).toBe("GOOGLE_CALENDAR_REFRESH_TOKEN")
  })
})
