import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SandboxUnavailableError, type SandboxRequest, type SandboxResponse } from "@/lib/sandbox/runner"

const runner = vi.hoisted(() => ({ invoke: vi.fn<(projectId: string, request: SandboxRequest) => Promise<SandboxResponse>>() }))
const limiter = vi.hoisted(() => ({ take: vi.fn(() => true) }))

vi.mock("@/lib/sandbox/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sandbox/runner")>()),
  getSandboxRunner: () => runner,
  takeSandboxRequest: limiter.take,
}))

import { DIAGNOSTIC_HEADER, MAX_DIAGNOSTIC_HEADER_LENGTH, encodeDiagnostic } from "@/lib/sandbox/diagnostic"
import { createServerProxy, sandboxPreflight } from "@/lib/sandbox/proxy"
import { createSandboxToken } from "@/lib/sandbox/token"

const PROJECT = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"

function call(proxy: ReturnType<typeof createServerProxy>, path: string[], init: RequestInit & { token?: string | null } = {}, projectId = PROJECT) {
  const { token = createSandboxToken(PROJECT, 1), ...rest } = init
  const headers = new Headers(rest.headers)
  if (token) headers.set("x-appxprompt-sandbox", token)
  const request = new Request(`http://x/api/apps/${projectId}/server/${path.join("/")}?a=1`, { ...rest, headers })
  return proxy(request, { params: Promise.resolve({ projectId, path }) })
}

beforeEach(() => {
  vi.stubEnv("CLOUDHIKE_ENCRYPTION_KEY", "test-secret")
  vi.stubEnv("APP_INTEGRATIONS", "1")
  runner.invoke.mockReset()
  runner.invoke.mockResolvedValue({ status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' })
  limiter.take.mockReset()
  limiter.take.mockReturnValue(true)
})

afterEach(() => vi.unstubAllEnvs())

describe("server proxy", () => {
  it("answers a preflight with the CORS headers", () => {
    const response = sandboxPreflight()
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })

  it("404s a bad project id as bad_request", async () => {
    const response = await call(createServerProxy(), ["x"], {}, "nope")
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe("bad_request")
  })

  it("503s unavailable when the flag is off", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "")
    const response = await call(createServerProxy(), ["x"])
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe("unavailable")
    expect(runner.invoke).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", () => null],
    ["tampered", () => "x" + createSandboxToken(PROJECT, 1)],
    ["for another project", () => createSandboxToken(OTHER, 1)],
    ["expired", () => createSandboxToken(PROJECT, 1, -10)],
  ])("403s preview for a %s token, without counting or calling", async (_name, token) => {
    const onCall = vi.fn()
    const response = await call(createServerProxy({ onCall }), ["x"], { method: "POST", body: "{}", token: token() })
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe("preview")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(limiter.take).not.toHaveBeenCalled()
    expect(runner.invoke).not.toHaveBeenCalled()
    expect(onCall).not.toHaveBeenCalled()
  })

  it("429s when the project is over its rate", async () => {
    limiter.take.mockReturnValue(false)
    const response = await call(createServerProxy(), ["x"])
    expect(response.status).toBe(429)
    expect((await response.json()).error.code).toBe("unavailable")
    expect(runner.invoke).not.toHaveBeenCalled()
  })

  it("413s a body over 1 MB", async () => {
    const response = await call(createServerProxy(), ["x"], { method: "POST", body: "a".repeat(1_048_577) })
    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe("bad_request")
    expect(runner.invoke).not.toHaveBeenCalled()
  })

  it("forwards the call without cookies or the token, and answers with safe headers", async () => {
    runner.invoke.mockResolvedValue({
      status: 201,
      headers: { "content-type": "application/json", "set-cookie": "a=b", "x-powered-by": "x", "access-control-allow-origin": "evil", "cache-control": "max-age=9" },
      body: '{"id":1}',
    })
    const response = await call(createServerProxy(), ["api", "a b", "c"], {
      method: "POST",
      body: '{"n":1}',
      headers: { cookie: "s=1", "content-type": "application/json", authorization: "Bearer t", "x-device-id": "d", "x-forwarded-for": "1.1.1.1" },
    })

    expect(runner.invoke).toHaveBeenCalledWith(PROJECT, {
      method: "POST",
      path: "/api/a%20b/c?a=1",
      headers: { "content-type": "application/json", authorization: "Bearer t", "x-device-id": "d" },
      body: '{"n":1}',
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 1 })
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("x-powered-by")).toBeNull()
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("marks every proxied answer nosniff and sandboxed", async () => {
    const response = await call(createServerProxy(), ["x"])
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toBe("sandbox")
  })

  it.each([
    [["api", "..", "__health"]],
    [["api", "%2e%2e", "__selfcheck"]],
    [["api", "%2E%2e", "x"]],
    [["api", ".", "x"]],
    [[".."]],
    [["api", "%2e", "x"]],
  ])("404s bad_request for the path %j without calling the runner", async (path) => {
    const response = await call(createServerProxy(), path)
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe("bad_request")
    expect(runner.invoke).not.toHaveBeenCalled()
  })

  it("only lets the listed owners through when SANDBOX_ALLOWED_USERS is set", async () => {
    vi.stubEnv("SANDBOX_ALLOWED_USERS", " 4, 1 ")
    expect((await call(createServerProxy(), ["x"])).status).toBe(200)

    vi.stubEnv("SANDBOX_ALLOWED_USERS", "4,5")
    const response = await call(createServerProxy(), ["x"])
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe("preview")
    expect(limiter.take).toHaveBeenCalledTimes(1)
    expect(runner.invoke).toHaveBeenCalledTimes(1)
  })

  it("lets everyone through when SANDBOX_ALLOWED_USERS is empty", async () => {
    vi.stubEnv("SANDBOX_ALLOWED_USERS", "  ")
    expect((await call(createServerProxy(), ["x"])).status).toBe(200)
  })

  it("sends no body for a GET", async () => {
    await call(createServerProxy(), ["x"])
    expect(runner.invoke.mock.calls[0][1].body).toBeNull()
  })

  it("passes a 204 through without a body", async () => {
    runner.invoke.mockResolvedValue({ status: 204, headers: {}, body: "" })
    const response = await call(createServerProxy(), ["x"], { method: "DELETE" })
    expect(response.status).toBe(204)
  })

  it("502s an answer over 1 MB or with an unusable status", async () => {
    runner.invoke.mockResolvedValueOnce({ status: 200, headers: {}, body: "a".repeat(1_048_577) })
    expect((await call(createServerProxy(), ["x"])).status).toBe(502)
    runner.invoke.mockResolvedValueOnce({ status: 101, headers: {}, body: "" })
    expect((await call(createServerProxy(), ["x"])).status).toBe(502)
  })

  it.each([
    ["disabled", "Server functions aren't running on this AppxPrompt server."],
    ["starting", "The test server is still starting. Try again in a moment."],
    ["limit", "Testing server functions is paused until tomorrow."],
    ["failed", "The test server couldn't start."],
  ] as const)("503s %s with its own message", async (reason, message) => {
    runner.invoke.mockRejectedValue(new SandboxUnavailableError(reason))
    const response = await call(createServerProxy(), ["x"])
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: "unavailable", message } })
  })

  it("logs only the name of an unexpected error and answers 503", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    runner.invoke.mockRejectedValue(new TypeError("secret detail"))
    const response = await call(createServerProxy(), ["x"])
    expect(response.status).toBe(503)
    expect(log).toHaveBeenCalledWith("Server function proxy failed", "TypeError")
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail")
    log.mockRestore()
  })
})

describe("server proxy onCall", () => {
  it("reports the path, method, status, error code and service, but not the query", async () => {
    const onCall = vi.fn()
    runner.invoke.mockResolvedValue({
      status: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: { code: "not_connected", message: "m", service: "stripe" } }),
    })
    await call(createServerProxy({ onCall }), ["api", "pay"], { method: "POST", body: "{}" })

    expect(onCall).toHaveBeenCalledTimes(1)
    expect(onCall).toHaveBeenCalledWith({
      projectId: PROJECT,
      path: "/api/pay",
      method: "POST",
      status: 502,
      errorCode: "not_connected",
      service: "stripe",
      durationMs: expect.any(Number),
      diagnostic: null,
    })
  })

  it("passes the VM's diagnostic to onCall and never to the app", async () => {
    const onCall = vi.fn()
    const diagnostic = { ms: 20, fetches: [{ host: "api.apify.com", status: 401, ms: 9 }], thrown: { name: "Error", message: "Apify answered 401" } }
    runner.invoke.mockResolvedValue({
      status: 500,
      headers: {
        "content-type": "application/json",
        [DIAGNOSTIC_HEADER]: encodeDiagnostic(diagnostic),
      },
      body: JSON.stringify({ error: { code: "unavailable", message: "Something went wrong. Try again." } }),
    })
    const response = await call(createServerProxy({ onCall }), ["api", "trends"], { method: "POST", body: "{}" })

    expect(response.headers.get(DIAGNOSTIC_HEADER)).toBeNull()
    expect(JSON.stringify([...response.headers])).not.toContain("apify")
    expect(await response.json()).toEqual({ error: { code: "unavailable", message: "Something went wrong. Try again." } })
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ status: 500, errorCode: "unavailable", diagnostic }))
  })

  it.each([
    ["malformed", "not base64 !!"],
    ["not JSON", Buffer.from("hello").toString("base64url")],
    ["off-shape", Buffer.from(JSON.stringify({ fetches: [] })).toString("base64url")],
    ["oversized", "A".repeat(MAX_DIAGNOSTIC_HEADER_LENGTH + 1)],
  ])("ignores a %s diagnostic header, and still strips it", async (_name, value) => {
    const onCall = vi.fn()
    runner.invoke.mockResolvedValue({ status: 200, headers: { "content-type": "application/json", "X-AppxPrompt-Diagnostic": value }, body: "{}" })
    const response = await call(createServerProxy({ onCall }), ["x"])
    expect(response.status).toBe(200)
    expect(response.headers.get(DIAGNOSTIC_HEADER)).toBeNull()
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ diagnostic: null }))
  })

  it("drops an outgoing call whose host carries a path or query, keeping the rest", async () => {
    const onCall = vi.fn()
    const header = Buffer.from(JSON.stringify({ ms: 1, fetches: [{ host: "a.com/x?t=1", ms: 1 }, { host: "b.com", ms: 2 }] })).toString("base64url")
    runner.invoke.mockResolvedValue({ status: 200, headers: { "content-type": "application/json", [DIAGNOSTIC_HEADER]: header }, body: "{}" })
    await call(createServerProxy({ onCall }), ["x"])
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ diagnostic: { ms: 1, fetches: [{ host: "b.com", ms: 2 }] } }))
  })

  it("reports a successful call with no error", async () => {
    const onCall = vi.fn()
    await call(createServerProxy({ onCall }), ["x"])
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ status: 200, errorCode: null, service: null }))
  })

  it("does not report a call the rate limit rejected", async () => {
    const onCall = vi.fn()
    limiter.take.mockReturnValue(false)
    const response = await call(createServerProxy({ onCall }), ["x"])
    expect(response.status).toBe(429)
    expect(onCall).not.toHaveBeenCalled()
  })

  it("reports a too-large request", async () => {
    const onCall = vi.fn()
    const response = await call(createServerProxy({ onCall }), ["x"], { method: "POST", body: "a".repeat(1_048_577) })
    expect(response.status).toBe(413)
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ status: 413, errorCode: "bad_request" }))
  })

  it("reports the proxy's own refusals after the token check and the rate limit", async () => {
    const onCall = vi.fn()
    runner.invoke.mockRejectedValue(new SandboxUnavailableError("starting"))
    await call(createServerProxy({ onCall }), ["y"])
    expect(onCall.mock.calls.map(([c]) => [c.status, c.errorCode])).toEqual([[503, "unavailable"]])
  })

  it("never lets a failing recorder change the answer", async () => {
    const response = await call(
      createServerProxy({
        onCall: () => {
          throw new Error("boom")
        },
      }),
      ["x"],
    )
    expect(response.status).toBe(200)
    const rejecting = await call(createServerProxy({ onCall: () => Promise.reject(new Error("boom")) }), ["x"])
    expect(rejecting.status).toBe(200)
  })

  it("defaults to doing nothing", async () => {
    expect((await call(createServerProxy(), ["x"])).status).toBe(200)
  })
})
