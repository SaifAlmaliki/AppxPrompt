import { describe, expect, it } from "vitest"
import {
  buildCheckRequest,
  exchangeCode as exchangeCodeWith,
  refreshAccessToken as refreshAccessTokenWith,
  runCheck as runCheckWith,
} from "@/lib/services/check"
import type { ServiceCheck, ServiceDefinition } from "@/lib/services/protocol"

const headerCheck: ServiceCheck = {
  method: "GET",
  url: "https://api.openai.com/v1/models",
  credential: "OPENAI_API_KEY",
  placement: { in: "header", name: "Authorization", format: "Bearer {value}" },
}

const openai: ServiceDefinition = {
  slug: "openai",
  name: "OpenAI",
  purpose: "Generate text",
  docsUrl: "https://platform.openai.com/docs",
  authKind: "api_key",
  fields: [{ name: "OPENAI_API_KEY", label: "API key", kind: "secret", help: "" }],
  allowedHosts: ["api.openai.com"],
  oauth: null,
  check: headerCheck,
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
  allowedHosts: ["oauth2.googleapis.com", "www.googleapis.com"],
  oauth: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    params: { access_type: "offline", prompt: "consent" },
    clientIdField: "GOOGLE_CALENDAR_CLIENT_ID",
    clientSecretField: "GOOGLE_CALENDAR_CLIENT_SECRET",
  },
  check: null,
  setupSteps: "",
  notes: "",
}

type Resolver = (host: string) => Promise<boolean>

const publicHost: Resolver = async () => true
const privateHost: Resolver = async () => false

const runCheck = (definition: ServiceDefinition, values: Record<string, string>, fetchImpl: typeof fetch, resolver = publicHost) =>
  runCheckWith(definition, values, fetchImpl, resolver)
const exchangeCode = (input: Parameters<typeof exchangeCodeWith>[0], fetchImpl: typeof fetch, resolver = publicHost) =>
  exchangeCodeWith(input, fetchImpl, resolver)
const refreshAccessToken = (input: Parameters<typeof refreshAccessTokenWith>[0], fetchImpl: typeof fetch, resolver = publicHost) =>
  refreshAccessTokenWith(input, fetchImpl, resolver)

type Call = { url: string; init: RequestInit }

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return respond()
  }) as typeof fetch
  return { calls, impl }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("buildCheckRequest", () => {
  it("places the credential in a header", () => {
    const { url, init } = buildCheckRequest(headerCheck, { OPENAI_API_KEY: "sk-x" })
    expect(url).toBe("https://api.openai.com/v1/models")
    expect(init.method).toBe("GET")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-x")
  })

  it("appends the credential as a query parameter, keeping the existing query", () => {
    const check: ServiceCheck = {
      method: "GET",
      url: "https://api.example.com/v1/ping?a=1",
      credential: "EX_KEY",
      placement: { in: "query", name: "key" },
    }
    expect(buildCheckRequest(check, { EX_KEY: "sk-x" }).url).toBe("https://api.example.com/v1/ping?a=1&key=sk-x")
    expect(buildCheckRequest({ ...check, url: "https://api.example.com/v1/ping" }, { EX_KEY: "sk-x" }).url).toBe(
      "https://api.example.com/v1/ping?key=sk-x",
    )
  })
})

describe("runCheck", () => {
  it("returns ok for a 2xx", async () => {
    const f = fakeFetch(() => json({}))
    expect(await runCheck(openai, { OPENAI_API_KEY: "sk-x" }, f.impl)).toBe("ok")
    expect(f.calls[0].init.redirect).toBe("manual")
    expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal)
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-x")
  })

  it("returns rejected for 401 and 403", async () => {
    expect(await runCheck(openai, { OPENAI_API_KEY: "k" }, fakeFetch(() => json({}, 401)).impl)).toBe("rejected")
    expect(await runCheck(openai, { OPENAI_API_KEY: "k" }, fakeFetch(() => json({}, 403)).impl)).toBe("rejected")
  })

  it("returns unreachable for a provider outage, redirect or thrown error", async () => {
    expect(await runCheck(openai, { OPENAI_API_KEY: "k" }, fakeFetch(() => json({}, 503)).impl)).toBe("unreachable")
    expect(await runCheck(openai, { OPENAI_API_KEY: "k" }, fakeFetch(() => json({}, 429)).impl)).toBe("unreachable")
    expect(await runCheck(openai, { OPENAI_API_KEY: "k" }, fakeFetch(() => new Response(null, { status: 302 })).impl)).toBe(
      "unreachable",
    )
    const throwing = (async () => {
      throw new Error("network down sk-secret")
    }) as typeof fetch
    expect(await runCheck(openai, { OPENAI_API_KEY: "k" }, throwing)).toBe("unreachable")
  })

  it("can't test without a check, so it never says ok", async () => {
    const f = fakeFetch(() => json({}, 500))
    expect(await runCheck({ ...openai, check: null }, {}, f.impl)).toBe("unreachable")
    expect(f.calls).toHaveLength(0)
  })

  it("never fetches a non-default port or a URL with userinfo", async () => {
    const f = fakeFetch(() => json({}))
    for (const url of [
      "https://api.openai.com:8443/v1/models",
      "https://user:pass@api.openai.com/v1/models",
      "https://user@api.openai.com/v1/models",
    ]) {
      const def = { ...openai, check: { ...headerCheck, url } }
      expect(await runCheck(def, { OPENAI_API_KEY: "sk-x" }, f.impl)).toBe("unreachable")
    }
    expect(f.calls).toHaveLength(0)
  })

  it("accepts the default https port written out", async () => {
    const f = fakeFetch(() => json({}))
    const def = { ...openai, check: { ...headerCheck, url: "https://api.openai.com:443/v1/models" } }
    expect(await runCheck(def, { OPENAI_API_KEY: "sk-x" }, f.impl)).toBe("ok")
  })

  it("never fetches a host that resolves to an internal address", async () => {
    const f = fakeFetch(() => json({}))
    const asked: string[] = []
    const resolver: Resolver = async (host) => {
      asked.push(host)
      return false
    }
    expect(await runCheck(openai, { OPENAI_API_KEY: "sk-x" }, f.impl, resolver)).toBe("unreachable")
    expect(asked).toEqual(["api.openai.com"])
    expect(f.calls).toHaveLength(0)
  })

  it("never fetches a host that isn't allowed", async () => {
    const f = fakeFetch(() => json({}))
    const def = { ...openai, check: { ...headerCheck, url: "https://evil.example.com/v1/models" } }
    expect(await runCheck(def, { OPENAI_API_KEY: "sk-x" }, f.impl)).toBe("unreachable")
    expect(f.calls).toHaveLength(0)
  })

  it("never fetches over http", async () => {
    const f = fakeFetch(() => json({}))
    const def = { ...openai, check: { ...headerCheck, url: "http://api.openai.com/v1/models" } }
    expect(await runCheck(def, { OPENAI_API_KEY: "sk-x" }, f.impl)).toBe("unreachable")
    expect(f.calls).toHaveLength(0)
  })
})

const exchangeInput = {
  definition: google,
  clientId: "cid",
  clientSecret: "csecret",
  code: "the-code",
  verifier: "the-verifier",
  redirectUri: "https://app.test/api/oauth/callback",
}

describe("exchangeCode", () => {
  it("returns the refresh token and posts a form body", async () => {
    const f = fakeFetch(() => json({ refresh_token: "rt", access_token: "a" }))
    expect(await exchangeCode(exchangeInput, f.impl)).toEqual({ refreshToken: "rt" })
    const call = f.calls[0]
    expect(call.url).toBe("https://oauth2.googleapis.com/token")
    expect(call.init.method).toBe("POST")
    expect(call.init.redirect).toBe("manual")
    expect(call.init.signal).toBeInstanceOf(AbortSignal)
    expect((call.init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded")
    const body = new URLSearchParams(String(call.init.body))
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("code")).toBe("the-code")
    expect(body.get("code_verifier")).toBe("the-verifier")
    expect(body.get("redirect_uri")).toBe(exchangeInput.redirectUri)
    expect(body.get("client_id")).toBe("cid")
    expect(body.get("client_secret")).toBe("csecret")
    expect(String(call.init.body)).toContain("code_verifier=")
  })

  it("reports a missing refresh token", async () => {
    const f = fakeFetch(() => json({ access_token: "a" }))
    expect(await exchangeCode(exchangeInput, f.impl)).toEqual({ error: "no_refresh_token" })
  })

  it("reports an error for a 400, bad JSON or thrown fetch", async () => {
    expect(await exchangeCode(exchangeInput, fakeFetch(() => json({ error: "invalid_grant" }, 400)).impl)).toEqual({ error: "error" })
    expect(await exchangeCode(exchangeInput, fakeFetch(() => new Response("nope", { status: 200 })).impl)).toEqual({ error: "error" })
    const throwing = (async () => {
      throw new Error("boom")
    }) as typeof fetch
    expect(await exchangeCode(exchangeInput, throwing)).toEqual({ error: "error" })
  })

  it("never fetches a token host that isn't allowed", async () => {
    const f = fakeFetch(() => json({ refresh_token: "rt" }))
    const definition = { ...google, oauth: { ...google.oauth!, tokenUrl: "https://evil.example.com/token" } }
    expect(await exchangeCode({ ...exchangeInput, definition }, f.impl)).toEqual({ error: "error" })
    expect(f.calls).toHaveLength(0)
  })

  it("errors without oauth config", async () => {
    const f = fakeFetch(() => json({}))
    expect(await exchangeCode({ ...exchangeInput, definition: openai }, f.impl)).toEqual({ error: "error" })
    expect(f.calls).toHaveLength(0)
  })
})

describe("internal destinations", () => {
  it("exchangeCode refuses a token host that resolves internally", async () => {
    const f = fakeFetch(() => json({ refresh_token: "rt" }))
    expect(await exchangeCode(exchangeInput, f.impl, privateHost)).toEqual({ error: "error" })
    expect(f.calls).toHaveLength(0)
  })
  it("refreshAccessToken refuses a token host that resolves internally", async () => {
    const f = fakeFetch(() => json({}))
    const input = { definition: google, clientId: "cid", clientSecret: "csecret", refreshToken: "rt" }
    expect(await refreshAccessToken(input, f.impl, privateHost)).toBe("unreachable")
    expect(f.calls).toHaveLength(0)
  })
  it("refuses a token URL with a port or userinfo", async () => {
    const f = fakeFetch(() => json({ refresh_token: "rt" }))
    for (const tokenUrl of ["https://oauth2.googleapis.com:8443/token", "https://a:b@oauth2.googleapis.com/token"]) {
      const definition = { ...google, oauth: { ...google.oauth!, tokenUrl } }
      expect(await exchangeCode({ ...exchangeInput, definition }, f.impl)).toEqual({ error: "error" })
    }
    expect(f.calls).toHaveLength(0)
  })
})

describe("refreshAccessToken", () => {
  const input = { definition: google, clientId: "cid", clientSecret: "csecret", refreshToken: "rt" }

  it("is rejected for invalid_grant and invalid_client", async () => {
    expect(await refreshAccessToken(input, fakeFetch(() => json({ error: "invalid_grant" }, 400)).impl)).toBe("rejected")
    expect(await refreshAccessToken(input, fakeFetch(() => json({ error: "invalid_client" }, 401)).impl)).toBe("rejected")
  })

  it("is ok for a 200 and posts a refresh grant", async () => {
    const f = fakeFetch(() => json({ access_token: "a" }))
    expect(await refreshAccessToken(input, f.impl)).toBe("ok")
    const body = new URLSearchParams(String(f.calls[0].init.body))
    expect(body.get("grant_type")).toBe("refresh_token")
    expect(body.get("refresh_token")).toBe("rt")
    expect(body.get("client_id")).toBe("cid")
    expect(body.get("client_secret")).toBe("csecret")
    expect(f.calls[0].init.redirect).toBe("manual")
    expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it("is unreachable for outages, other errors and thrown fetches", async () => {
    expect(await refreshAccessToken(input, fakeFetch(() => json({}, 503)).impl)).toBe("unreachable")
    expect(await refreshAccessToken(input, fakeFetch(() => json({ error: "temporarily_unavailable" }, 400)).impl)).toBe("unreachable")
    expect(await refreshAccessToken(input, fakeFetch(() => new Response("x", { status: 400 })).impl)).toBe("unreachable")
    const throwing = (async () => {
      throw new Error("boom")
    }) as typeof fetch
    expect(await refreshAccessToken(input, throwing)).toBe("unreachable")
  })

  it("never fetches a token host that isn't allowed", async () => {
    const f = fakeFetch(() => json({}))
    const definition = { ...google, oauth: { ...google.oauth!, tokenUrl: "http://oauth2.googleapis.com/token" } }
    expect(await refreshAccessToken({ ...input, definition }, f.impl)).toBe("unreachable")
    expect(f.calls).toHaveLength(0)
  })
})
