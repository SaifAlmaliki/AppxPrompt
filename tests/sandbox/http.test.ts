import { describe, expect, it } from "vitest"

import {
  MAX_SERVER_BODY_BYTES,
  SANDBOX_CORS_HEADERS,
  SANDBOX_RESPONSE_GUARD_HEADERS,
  forwardRequestHeaders,
  isDotSegment,
  readCappedBody,
  readSandboxError,
  safeResponseHeaders,
  serverErrorBody,
} from "@/lib/sandbox/http"

describe("forwardRequestHeaders", () => {
  it("keeps only what a server function may see", () => {
    const headers = new Headers({
      cookie: "session=1",
      "x-appxprompt-sandbox": "token",
      "x-appxprompt-internal": "secret",
      "x-forwarded-for": "1.2.3.4",
      authorization: "Bearer a",
      "content-type": "application/json",
      "x-device-id": "d",
    })
    expect(forwardRequestHeaders(headers)).toEqual({ authorization: "Bearer a", "content-type": "application/json", "x-device-id": "d" })
  })
})

describe("safeResponseHeaders", () => {
  it("drops cookies, CORS and everything else", () => {
    expect(
      safeResponseHeaders({ "set-cookie": "a", "content-type": "application/json", "access-control-allow-origin": "evil", "x-powered-by": "x" }),
    ).toEqual({ "content-type": "application/json", ...SANDBOX_RESPONSE_GUARD_HEADERS })
  })

  it("never forwards the diagnostic header", () => {
    expect(safeResponseHeaders({ "X-AppxPrompt-Diagnostic": "abc", "content-type": "application/json" })).toEqual({
      "content-type": "application/json",
      ...SANDBOX_RESPONSE_GUARD_HEADERS,
    })
  })

  it("always adds nosniff and a sandboxing CSP, and the VM cannot override them", () => {
    const headers = safeResponseHeaders({ "Content-Security-Policy": "default-src *", "X-Content-Type-Options": "sniff", "content-type": "text/html" })
    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["content-security-policy"]).toBe("sandbox")
  })

  it("keeps cache-control and content-language whatever their case", () => {
    expect(safeResponseHeaders({ "Cache-Control": "max-age=1", "Content-Language": "en" })).toEqual({
      "cache-control": "max-age=1",
      "content-language": "en",
      ...SANDBOX_RESPONSE_GUARD_HEADERS,
    })
  })
})

describe("isDotSegment", () => {
  it.each([".", "..", "%2e", "%2E%2e", ".%2e", "%2e."])("flags %s", (segment) => expect(isDotSegment(segment)).toBe(true))
  it.each(["a", "...", "a.b", ".hidden", "%2e%2e%2e", "%zz", ""])("lets %s through", (segment) => expect(isDotSegment(segment)).toBe(false))
})

describe("serverErrorBody", () => {
  it("carries the code, message and service", () => {
    expect(serverErrorBody("not_connected", "m", "google-calendar")).toEqual({
      error: { code: "not_connected", message: "m", service: "google-calendar" },
    })
  })

  it("leaves the service out when there is none", () => {
    expect(serverErrorBody("preview", "m").error).not.toHaveProperty("service")
  })
})

describe("SANDBOX_CORS_HEADERS", () => {
  it("allows the sandbox token header and never the server key", () => {
    expect(SANDBOX_CORS_HEADERS["access-control-allow-headers"]).toContain("x-appxprompt-sandbox")
    expect(SANDBOX_CORS_HEADERS["access-control-allow-headers"]).not.toContain("x-appxprompt-server-key")
    expect(SANDBOX_CORS_HEADERS["access-control-allow-origin"]).toBe("*")
  })
})

describe("readCappedBody", () => {
  const post = (body: string | null, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers })

  it("reads a body as text and an empty one as null", async () => {
    expect(await readCappedBody(post('{"a":1}'))).toBe('{"a":1}')
    expect(await readCappedBody(post(null))).toBeNull()
    expect(await readCappedBody(new Request("http://x/"))).toBeNull()
  })

  it("accepts exactly the limit and refuses one byte more", async () => {
    expect(await readCappedBody(post("a".repeat(MAX_SERVER_BODY_BYTES)))).toHaveLength(MAX_SERVER_BODY_BYTES)
    expect(await readCappedBody(post("a".repeat(MAX_SERVER_BODY_BYTES + 1)))).toBe("too-large")
  })

  it("refuses on a declared length without reading", async () => {
    expect(await readCappedBody(post("a", { "content-length": String(MAX_SERVER_BODY_BYTES + 1) }))).toBe("too-large")
  })

  it("counts bytes, not characters", async () => {
    expect(await readCappedBody(post("é".repeat(10)), 19)).toBe("too-large")
    expect(await readCappedBody(post("é".repeat(10)), 20)).toBe("é".repeat(10))
  })
})

describe("readSandboxError", () => {
  const json = { "content-type": "application/json" }

  it("reads the code and service of an error answer", () => {
    expect(readSandboxError(502, json, JSON.stringify({ error: { code: "not_connected", service: "stripe", message: "secret text" } }))).toEqual({
      code: "not_connected",
      service: "stripe",
    })
  })

  it("ignores successes, other content types and unreadable bodies", () => {
    expect(readSandboxError(200, json, '{"error":{"code":"x"}}')).toEqual({ code: null, service: null })
    expect(readSandboxError(500, { "content-type": "text/html" }, '{"error":{"code":"x"}}')).toEqual({ code: null, service: null })
    expect(readSandboxError(500, json, "not json")).toEqual({ code: null, service: null })
    expect(readSandboxError(500, json, "null")).toEqual({ code: null, service: null })
  })
})
