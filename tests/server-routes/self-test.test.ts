import { describe, expect, it, vi } from "vitest"

import { DIAGNOSTIC_HEADER, encodeDiagnostic, type CallDiagnostic } from "@/lib/sandbox/diagnostic"
import { SandboxUnavailableError, type SandboxResponse, type SandboxRunner } from "@/lib/sandbox/runner"
import { selfTestRoute, summarizeSelfTest, type SelfTestClock } from "@/lib/server-routes/self-test"

const PATH = "app/api/trends/feed+api.ts"

const json = (status: number, body: unknown, diagnostic?: CallDiagnostic): SandboxResponse => ({
  status,
  headers: { "content-type": "application/json", ...(diagnostic ? { [DIAGNOSTIC_HEADER]: encodeDiagnostic(diagnostic) } : {}) },
  body: JSON.stringify(body),
})

const errorBody = (code: string, message = "Sign in to see this.") => ({ error: { code, message } })

function fakeClock() {
  let now = 0
  const timers: { at: number; resolve: () => void }[] = []
  const clock: SelfTestClock = {
    now: () => now,
    delay: (ms, signal) => {
      // A wait with no signal is the retry pause: it passes at once.
      if (!signal) {
        now += ms
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        timers.push({ at: now + ms, resolve })
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
    },
  }
  return {
    clock,
    advance(ms: number) {
      now += ms
      for (const timer of timers.filter((candidate) => candidate.at <= now)) timer.resolve()
    },
  }
}

const runnerOf = (invoke: SandboxRunner["invoke"]): SandboxRunner & { invoke: ReturnType<typeof vi.fn> } => ({
  invoke: vi.fn(invoke),
  reload: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
})

const base = { projectId: "p1", path: PATH, testBody: { query: "coffee" } }

describe("selfTestRoute", () => {
  it("calls the route as an anonymous POST with the sample body, and passes a 200", async () => {
    const runner = runnerOf(async () => json(200, { items: [] }))
    const result = await selfTestRoute({ ...base, runner })
    expect(result).toMatchObject({ status: "passed", httpStatus: 200 })
    expect(runner.invoke).toHaveBeenCalledWith("p1", {
      method: "POST",
      path: "/api/trends/feed",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "coffee" }),
    })
  })

  it.each(["sign_in", "not_connected", "bad_request"])("passes a plain %s answer", async (code) => {
    const runner = runnerOf(async () => json(code === "sign_in" ? 401 : 400, errorBody(code)))
    expect(await selfTestRoute({ ...base, runner })).toMatchObject({ status: "passed", errorCode: code })
  })

  it("fails an error answer with another code, or with no plain message", async () => {
    expect(await selfTestRoute({ ...base, runner: runnerOf(async () => json(402, errorBody("quota"))) })).toMatchObject({ status: "failed" })
    expect(await selfTestRoute({ ...base, runner: runnerOf(async () => json(400, errorBody("bad_request", ""))) })).toMatchObject({ status: "failed" })
  })

  it("fails a 500 that threw, with the diagnostic kept and nothing else", async () => {
    const diagnostic: CallDiagnostic = { ms: 120, fetches: [], thrown: { name: "TypeError", message: "Cannot read properties of undefined" } }
    const runner = runnerOf(async () => json(500, errorBody("unavailable", "Something went wrong."), diagnostic))
    const result = await selfTestRoute({ ...base, runner })
    expect(result).toMatchObject({ status: "failed", httpStatus: 500, diagnostic })
    expect(summarizeSelfTest(result)).toContain("it threw TypeError: Cannot read properties of undefined")
    expect(JSON.stringify(result)).not.toContain("Something went wrong.")
    expect(Object.keys(result).sort()).toEqual(["diagnostic", "httpStatus", "status"])
  })

  it("fails a non-JSON answer and an answer over 1 MB", async () => {
    const html = runnerOf(async () => ({ status: 200, headers: { "content-type": "text/html" }, body: "<html>" }))
    expect(await selfTestRoute({ ...base, runner: html })).toMatchObject({ status: "failed", reason: "its answer wasn't JSON" })
    const big = runnerOf(async () => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "a".repeat(1_100_000) }) }))
    expect(await selfTestRoute({ ...base, runner: big })).toMatchObject({ status: "failed", reason: "its answer was over 1 MB" })
  })

  it("retries a starting server once after 10 seconds", async () => {
    const { clock } = fakeClock()
    let calls = 0
    const runner = runnerOf(async () => {
      if (++calls === 1) throw new SandboxUnavailableError("starting")
      return json(200, { ok: true })
    })
    expect(await selfTestRoute({ ...base, runner, clock })).toMatchObject({ status: "passed" })
    expect(runner.invoke).toHaveBeenCalledTimes(2)
    expect(clock.now()).toBe(10_000)
  })

  it("skips when the server is still starting on the retry", async () => {
    const { clock } = fakeClock()
    const runner = runnerOf(async () => {
      throw new SandboxUnavailableError("starting")
    })
    expect(await selfTestRoute({ ...base, runner, clock })).toMatchObject({ status: "skipped" })
    expect(runner.invoke).toHaveBeenCalledTimes(2)
  })

  it("skips without calling when a service the route uses isn't connected", async () => {
    const runner = runnerOf(async () => json(200, {}))
    const input = { ...base, runner, usesServices: ["apify"], connectedServices: [] as string[] }
    expect(await selfTestRoute(input)).toEqual({ status: "skipped", reason: "a service isn't connected" })
    expect(await selfTestRoute({ ...input, usesServices: ["backend"], backendConnected: false })).toEqual({
      status: "skipped",
      reason: "a service isn't connected",
    })
    expect(runner.invoke).not.toHaveBeenCalled()

    expect(await selfTestRoute({ ...input, connectedServices: ["apify"] })).toMatchObject({ status: "passed" })
    expect(await selfTestRoute({ ...input, usesServices: ["backend"], backendConnected: true })).toMatchObject({ status: "passed" })
  })

  it("gives up after 40 seconds in all", async () => {
    const { clock, advance } = fakeClock()
    const runner = runnerOf(() => new Promise<SandboxResponse>(() => {}))
    const pending = selfTestRoute({ ...base, runner, clock })
    await Promise.resolve()
    advance(39_999)
    let settled = false
    void pending.then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    advance(1)
    expect(await pending).toEqual({ status: "failed", reason: "it took more than 30 seconds" })
  })

  it("counts the retry pause inside the 40 seconds", async () => {
    const { clock, advance } = fakeClock()
    let calls = 0
    const runner = runnerOf(() => {
      if (++calls === 1) return Promise.reject(new SandboxUnavailableError("starting"))
      return new Promise<SandboxResponse>(() => {})
    })
    const pending = selfTestRoute({ ...base, runner, clock })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clock.now()).toBe(10_000)
    advance(29_999)
    await new Promise((resolve) => setTimeout(resolve, 0))
    advance(1)
    expect(await pending).toMatchObject({ status: "failed" })
  })

  it("skips when the test server isn't there, and fails when it can't start", async () => {
    const throws = (reason: "disabled" | "limit" | "failed") =>
      runnerOf(async () => {
        throw new SandboxUnavailableError(reason)
      })
    expect(await selfTestRoute({ ...base, runner: throws("disabled") })).toMatchObject({ status: "skipped" })
    expect(await selfTestRoute({ ...base, runner: throws("limit") })).toMatchObject({ status: "skipped" })
    expect(await selfTestRoute({ ...base, runner: throws("failed") })).toMatchObject({ status: "failed" })
  })

  it("treats the sandbox's own 30-second stop as a timeout", async () => {
    const diagnostic: CallDiagnostic = { ms: 30_000, fetches: [{ host: "api.apify.com", ms: 30_000, error: "timeout" }] }
    const runner = runnerOf(async () => json(504, errorBody("unavailable", "The server function took too long."), diagnostic))
    const result = await selfTestRoute({ ...base, runner })
    expect(summarizeSelfTest(result)).toBe("it took more than 30 seconds; the request to api.apify.com timed out")
  })
})

describe("summarizeSelfTest", () => {
  it("names the host and the timeout", () => {
    const summary = summarizeSelfTest({
      status: "failed",
      reason: "it took more than 30 seconds",
      diagnostic: { ms: 30_000, fetches: [{ host: "api.apify.com", ms: 30_000, error: "timeout" }] },
    })
    expect(summary).toBe("it took more than 30 seconds; the request to api.apify.com timed out")
  })

  it("names an upstream status", () => {
    const summary = summarizeSelfTest({
      status: "failed",
      httpStatus: 500,
      diagnostic: { ms: 90, fetches: [{ host: "api.apify.com", status: 402, ms: 80 }, { host: "api.apify.com", status: 402, ms: 5 }] },
    })
    expect(summary).toBe("api.apify.com answered 402")
  })

  it("says what was thrown", () => {
    expect(summarizeSelfTest({ status: "failed", httpStatus: 500, diagnostic: { ms: 3, fetches: [], thrown: { name: "TypeError", message: "x is not a function" } } })).toBe(
      "it threw TypeError: x is not a function"
    )
  })

  it("falls back to the status, and never adds bodies, headers or paths", () => {
    expect(summarizeSelfTest({ status: "failed", httpStatus: 502 })).toBe("it answered 502")
    const result = {
      status: "failed" as const,
      httpStatus: 500,
      errorCode: "unavailable",
      diagnostic: { ms: 5, fetches: [{ host: "api.apify.com", ms: 5, status: 200 }, { host: "x.test", ms: 1, error: "blocked" as const }] },
    }
    const summary = summarizeSelfTest(result)
    expect(summary).toBe("the request to x.test was blocked")
    expect(summary).not.toMatch(/unavailable|200|\//)
  })
})
