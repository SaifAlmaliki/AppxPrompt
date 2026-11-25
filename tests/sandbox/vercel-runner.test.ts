import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SandboxBundle } from "@/lib/sandbox/bundle"
import { SANDBOX_LIMITS, SandboxUnavailableError } from "@/lib/sandbox/runner"
import type { SandboxState, SandboxStateStore } from "@/lib/sandbox/state"
import { createVercelRunner, type SandboxHandle } from "@/lib/sandbox/vercel-runner"

const KEY = "sk-proj-" + "a".repeat(40)
const T0 = Date.UTC(2026, 0, 1, 12)
const DAY = "2026-01-01"

function memoryState() {
  const rows = new Map<string, SandboxState>()
  const blank = (): SandboxState => ({
    sandboxId: null, domain: null, signature: null, startingUntil: null, sessionStartedAt: null, deadlineAt: null, usageDay: null, usageMs: 0,
  })
  let clock = () => T0
  const row = (id: string) => rows.get(id) ?? blank()
  const store: SandboxStateStore & { rows: Map<string, SandboxState>; useClock(now: () => number): void } = {
    rows,
    useClock(now) {
      clock = now
    },
    async get(id) {
      const found = rows.get(id)
      return found ? { ...found } : null
    },
    async claimStart(id, until) {
      const current = rows.get(id)
      if (current?.startingUntil && current.startingUntil.getTime() > clock()) return false
      rows.set(id, { ...row(id), startingUntil: until })
      return true
    },
    async saveStarted(id, s) {
      rows.set(id, { ...row(id), ...s, startingUntil: null })
    },
    async saveDeadline(id, deadlineAt) {
      rows.set(id, { ...row(id), deadlineAt })
    },
    async addUsage(id, ms, day) {
      const current = row(id)
      const usageMs = Math.max(0, (current.usageDay === day ? current.usageMs : 0) + ms)
      rows.set(id, { ...current, usageDay: day, usageMs })
      return usageMs
    },
    async clear(id) {
      rows.set(id, { ...row(id), sandboxId: null, domain: null, signature: null, startingUntil: null, sessionStartedAt: null, deadlineAt: null })
    },
    async clearSignature(id) {
      rows.set(id, { ...row(id), signature: null })
    },
  }
  return store
}

type Fake = SandboxHandle & { stdin: string; stops: number; deletes: number; extended: number[]; files: Record<string, string>; runArgs: unknown }

function setup(
  options: { bundle?: Partial<SandboxBundle["runtime"]>; selfcheck?: { egressBlocked: boolean; envKeys: number }; budget?: number; holdCreate?: boolean } = {},
) {
  let now = T0
  const state = memoryState()
  state.useClock(() => now)
  const handles = new Map<string, Fake>()
  const createCalls: Record<string, unknown>[] = []
  let signature = "sig-1"
  const bundle = (): SandboxBundle => ({
    runtime: { files: { "app/api/x+api.ts": "x" }, routes: ["app/api/x+api.ts"], allowedHosts: ["api.openai.com"], secretNames: ["OPENAI_API_KEY"], ...options.bundle },
    env: { OPENAI_API_KEY: KEY, NODE_ENV: "production" },
    signature,
  })
  const selfcheck = { value: options.selfcheck ?? { egressBlocked: true, envKeys: 1 } }
  const forwardFailures = { count: 0, afterMs: 0 }
  const forwardAnswers: Response[] = []
  const kept: Promise<unknown>[] = []
  const timers: { ms: number; fire: () => void; cancelled: boolean }[] = []
  let releaseCreate: () => void = () => {}
  const createGate = options.holdCreate ? new Promise<void>((resolve) => (releaseCreate = resolve)) : null
  const fetchCalls: { url: string; init: RequestInit }[] = []

  const sdk = {
    async create(opts: object) {
      createCalls.push(opts as Record<string, unknown>)
      const name = (opts as { name: string }).name
      if (createGate) await createGate
      const fake: Fake = {
        name,
        stdin: "",
        stops: 0,
        deletes: 0,
        extended: [],
        files: {},
        runArgs: null,
        domain: () => `https://${name}.vercel.run`,
        async writeFiles(files) {
          for (const file of files) fake.files[file.path] = file.content.toString("utf8")
        },
        async runCommand(params) {
          fake.runArgs = params
          for await (const chunk of params.stdin) fake.stdin += String(chunk)
          return {}
        },
        async update() {},
        async extendTimeout(ms) {
          fake.extended.push(ms)
        },
        async stop() {
          fake.stops++
        },
        async delete() {
          fake.deletes++
        },
      }
      handles.set(name, fake)
      return fake
    },
    async get(name: string) {
      const found = handles.get(name)
      if (!found) throw new Error("not found")
      return found
    },
  }

  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, init: init ?? {} })
    if (url.endsWith("/__health")) return Response.json({ ok: true })
    if (url.endsWith("/__selfcheck")) return Response.json(selfcheck.value)
    if (forwardFailures.count > 0) {
      forwardFailures.count--
      now += forwardFailures.afterMs
      throw new TypeError("fetch failed")
    }
    const queued = forwardAnswers.shift()
    if (queued) return queued
    return new Response(JSON.stringify({ hello: "world" }), { status: 201, headers: { "content-type": "application/json", "x-custom": "1" } })
  }) as typeof fetch

  const runner = createVercelRunner({
    sdk,
    state,
    bundles: { signature: async () => signature, build: async () => bundle() },
    fetch: fetchFake,
    now: () => now,
    runtimeSource: async () => "// runtime",
    secret: (id) => `secret-${id}`,
    invokeBudgetMs: options.budget,
    keepAlive: (work) => kept.push(work),
    startTimer: (ms, fire) => {
      const timer = { ms, fire, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    sleep: async (ms) => {
      await new Promise((resolve) => setImmediate(resolve))
      now += ms
    },
  })

  return {
    runner, state, handles, createCalls, fetchCalls, forwardFailures, forwardAnswers, selfcheck, timers, kept, releaseCreate: () => releaseCreate(),
    setSignature: (value: string) => { signature = value },
    advance: (ms: number) => { now += ms },
    now: () => now,
  }
}

const request = { method: "POST", path: "/api/x", headers: { "content-type": "application/json" }, body: '{"a":1}' }

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("the first invoke", () => {
  it("creates one sandbox with the safe options and no env", async () => {
    const t = setup()
    await t.runner.invoke("proj-1234-abcd", request)
    expect(t.createCalls).toHaveLength(1)
    const options = t.createCalls[0]
    expect(options).toMatchObject({
      ports: [3000],
      persistent: false,
      resources: { vcpus: 1 },
      image: "vercel/sandbox/node:24",
      timeout: SANDBOX_LIMITS.sessionMs,
      networkPolicy: { allow: ["api.openai.com"] },
    })
    expect(options).not.toHaveProperty("env")
    expect(JSON.stringify(options)).not.toContain(KEY)
  })

  it("writes the runtime and the bundle without any credential value", async () => {
    const t = setup()
    await t.runner.invoke("proj-1234-abcd", request)
    const handle = [...t.handles.values()][0]
    expect(handle.files["server.mjs"]).toBe("// runtime")
    expect(JSON.parse(handle.files["bundle.json"]).routes).toEqual(["app/api/x+api.ts"])
    expect(handle.files["bundle.json"]).not.toContain(KEY)
  })

  it("sends credentials on stdin only", async () => {
    const t = setup()
    await t.runner.invoke("proj-1234-abcd", request)
    const handle = [...t.handles.values()][0]
    const params = handle.runArgs as { cmd: string; args: string[]; detached: boolean; stdin: unknown }
    expect(params).not.toHaveProperty("env")
    expect(params.args).toEqual(["server.mjs"])
    expect(JSON.stringify(params.args)).not.toContain(KEY)
    expect(params.stdin).toBeInstanceOf(Readable)
    const line = JSON.parse(handle.stdin.trim())
    expect(line).toMatchObject({ OPENAI_API_KEY: KEY, APPXPROMPT_SANDBOX_SECRET: "secret-proj-1234-abcd", PORT: "3000" })
  })

  it("uses deny-all when no host is allowed", async () => {
    const t = setup({ bundle: { allowedHosts: [] } })
    await t.runner.invoke("proj-1234-abcd", request)
    expect(t.createCalls[0].networkPolicy).toBe("deny-all")
  })

  it("forwards with the internal header and returns status, headers and body", async () => {
    const t = setup()
    const response = await t.runner.invoke("proj-1234-abcd", { ...request, headers: { ...request.headers, "X-AppxPrompt-Internal": "forged" } })
    const call = t.fetchCalls.find((c) => c.url.endsWith("/api/x"))!
    expect(call.url).toMatch(/^https:\/\/appx-proj-123.*\.vercel\.run\/api\/x$/)
    expect(call.init.method).toBe("POST")
    expect(call.init.body).toBe('{"a":1}')
    expect(call.init.redirect).toBe("manual")
    expect(call.init.headers).toEqual({ "content-type": "application/json", "x-appxprompt-internal": "secret-proj-1234-abcd" })
    expect(response.status).toBe(201)
    expect(response.headers["x-custom"]).toBe("1")
    expect(JSON.parse(response.body)).toEqual({ hello: "world" })
  })

  it("answers 404 bad_request and creates nothing when the app has no routes", async () => {
    const t = setup({ bundle: { routes: [] } })
    const response = await t.runner.invoke("proj-1234-abcd", request)
    expect(response.status).toBe(404)
    expect(JSON.parse(response.body).error.code).toBe("bad_request")
    expect(t.createCalls).toHaveLength(0)
  })
})

describe("the request path", () => {
  it.each(["@evil.com/x", ".evil.com", "//evil.com/x", "\\\\evil.com", "/\t/evil.com", "api/x", ""])(
    "rejects %j without any fetch or VM",
    async (path) => {
      const t = setup()
      const error = await t.runner.invoke("p1", { ...request, path }).catch((e) => e)
      expect(error).toBeInstanceOf(SandboxUnavailableError)
      expect(error.reason).toBe("failed")
      expect(t.fetchCalls).toHaveLength(0)
      expect(t.createCalls).toHaveLength(0)
    },
  )

  it("forwards a path with a query to the VM origin", async () => {
    const t = setup()
    await t.runner.invoke("p1", { ...request, path: "/api/x?y=1" })
    const call = t.fetchCalls.find((c) => c.url.includes("/api/x"))!
    const origin = new URL(call.url).origin
    expect(origin).toMatch(/^https:\/\/appx-p1-.*\.vercel\.run$/)
    expect(call.url).toBe(`${origin}/api/x?y=1`)
    expect((call.init.headers as Record<string, string>)["x-appxprompt-internal"]).toBe("secret-p1")
  })
})

describe("reuse and restarts", () => {
  it("does not create again with the same signature", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    await t.runner.invoke("p1", request)
    expect(t.createCalls).toHaveLength(1)
  })

  it("stops the old sandbox and starts a new one when the signature changes", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    const first = [...t.handles.values()][0]
    t.setSignature("sig-2")
    await t.runner.invoke("p1", request)
    expect(first.stops).toBe(1)
    expect(first.deletes).toBe(1)
    expect(t.createCalls).toHaveLength(2)
  })

  it("makes exactly one create for two invokes started together", async () => {
    const t = setup()
    const [a, b] = await Promise.all([t.runner.invoke("p1", request), t.runner.invoke("p1", request)])
    expect(t.createCalls).toHaveLength(1)
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
  })

  it("restarts once after a failed forward, then succeeds", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    const first = [...t.handles.values()][0]
    t.forwardFailures.count = 1
    const response = await t.runner.invoke("p1", request)
    expect(response.status).toBe(201)
    expect(first.stops).toBe(1)
    expect(t.createCalls).toHaveLength(2)
  })

  it("answers failed when the restarted sandbox also fails", async () => {
    const t = setup()
    t.forwardFailures.count = 2
    const error = await t.runner.invoke("p1", request).catch((e) => e)
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error.reason).toBe("failed")
    expect(t.createCalls).toHaveLength(2)
    for (const handle of t.handles.values()) expect(handle.stops).toBe(1)
  })

  it("restarts when the session is about to end", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    t.advance(SANDBOX_LIMITS.sessionMs - 1_000)
    await t.runner.invoke("p1", request)
    expect(t.createCalls).toHaveLength(2)
  })

  it("keeps the old state and a null signature after reload, then stops the old sandbox on the next invoke", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    const first = [...t.handles.values()][0]
    await t.runner.reload("p1")
    const stored = await t.state.get("p1")
    expect(stored?.sandboxId).toBe(first.name)
    expect(stored?.signature).toBeNull()
    expect(first.stops).toBe(0)
    await t.runner.invoke("p1", request)
    expect(first.stops).toBe(1)
    expect(t.createCalls).toHaveLength(2)
  })

  it("stop stops, deletes and clears", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    const first = [...t.handles.values()][0]
    await t.runner.stop("p1")
    expect(first.stops).toBe(1)
    expect(first.deletes).toBe(1)
    expect((await t.state.get("p1"))?.sandboxId).toBeNull()
  })
})

describe("limits", () => {
  it("answers limit without creating when today's usage is used up", async () => {
    const t = setup()
    await t.state.addUsage("p1", SANDBOX_LIMITS.dailyMs, DAY)
    const error = await t.runner.invoke("p1", request).catch((e) => e)
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error.reason).toBe("limit")
    expect(t.createCalls).toHaveLength(0)
  })

  it("extends the session when under 5 minutes are left", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    t.advance(SANDBOX_LIMITS.sessionMs - 4 * 60_000)
    await t.runner.invoke("p1", request)
    const handle = [...t.handles.values()][0]
    expect(handle.extended).toEqual([15 * 60_000])
    const stored = await t.state.get("p1")
    expect(stored!.deadlineAt!.getTime()).toBe(T0 + SANDBOX_LIMITS.sessionMs + 15 * 60_000)
  })

  it("does not extend while there is plenty of time", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    await t.runner.invoke("p1", request)
    expect([...t.handles.values()][0].extended).toEqual([])
  })

  it("treats a rejected extension as the end of the session and gives the usage back", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    const handle = [...t.handles.values()][0]
    handle.extendTimeout = async () => {
      throw new Error("over the plan's limit")
    }
    const before = (await t.state.get("p1"))!
    t.advance(SANDBOX_LIMITS.sessionMs - 4 * 60_000)
    const response = await t.runner.invoke("p1", request)
    expect(response.status).toBe(201)
    const after = (await t.state.get("p1"))!
    expect(after.deadlineAt).toEqual(before.deadlineAt)
    expect(after.usageMs).toBe(SANDBOX_LIMITS.sessionMs)
  })

  it("does not extend past the maximum session", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    const stored = (await t.state.get("p1"))!
    await t.state.saveStarted("p1", {
      sandboxId: stored.sandboxId!,
      domain: stored.domain!,
      signature: stored.signature!,
      sessionStartedAt: new Date(t.now() - SANDBOX_LIMITS.maxSessionMs + 60_000),
      deadlineAt: new Date(t.now() + 60_000),
    })
    await t.runner.invoke("p1", request)
    expect([...t.handles.values()][0].extended).toEqual([])
  })
})

describe("self-checks", () => {
  it("refuses a VM whose egress is not blocked", async () => {
    const t = setup({ selfcheck: { egressBlocked: false, envKeys: 1 } })
    const error = await t.runner.invoke("p1", request).catch((e) => e)
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error.reason).toBe("failed")
    const handle = [...t.handles.values()][0]
    expect(handle.stops).toBe(1)
    expect(handle.deletes).toBe(1)
    expect(t.fetchCalls.some((c) => c.url.endsWith("/api/x"))).toBe(false)
    expect((await t.state.get("p1"))?.sandboxId).toBeNull()
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/p1|sandbox-|secret|sk-proj/)
  })

  it("refuses a VM that got the wrong number of credentials", async () => {
    const t = setup({ selfcheck: { egressBlocked: true, envKeys: 0 } })
    const error = await t.runner.invoke("p1", request).catch((e) => e)
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect([...t.handles.values()][0].stops).toBe(1)
    expect(t.fetchCalls.some((c) => c.url.endsWith("/api/x"))).toBe(false)
  })

  it("does not create another VM for the same bundle right after a refusal", async () => {
    const t = setup({ selfcheck: { egressBlocked: false, envKeys: 1 } })
    await t.runner.invoke("p1", request).catch(() => {})
    await t.runner.invoke("p1", request).catch(() => {})
    expect(t.createCalls).toHaveLength(1)
    await t.runner.reload("p1")
    await t.runner.invoke("p1", request).catch(() => {})
    expect(t.createCalls).toHaveLength(2)
  })

  it("serves when both checks pass", async () => {
    const t = setup()
    const response = await t.runner.invoke("p1", request)
    expect(response.status).toBe(201)
    expect(t.fetchCalls.some((c) => c.url.endsWith("/__selfcheck"))).toBe(true)
  })
})

const MIN = 60_000
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}

describe("usage refunds", () => {
  it("gives back the unused time when a signature change replaces the VM two minutes in", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    t.advance(2 * MIN)
    t.setSignature("sig-2")
    await t.runner.invoke("p1", request)
    expect((await t.state.get("p1"))!.usageMs).toBe(2 * MIN + SANDBOX_LIMITS.sessionMs)
  })

  it("gives back the unused time of a VM that stopped answering", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    t.advance(2 * MIN)
    t.forwardFailures.count = 1
    await t.runner.invoke("p1", request)
    expect((await t.state.get("p1"))!.usageMs).toBe(2 * MIN + SANDBOX_LIMITS.sessionMs)
  })

  it("gives back a whole session when the self-check refuses the VM", async () => {
    const t = setup({ selfcheck: { egressBlocked: false, envKeys: 1 } })
    await t.runner.invoke("p1", request).catch(() => {})
    expect((await t.state.get("p1"))!.usageMs).toBe(0)
  })

  it("gives back the rest of the session on stop", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    t.advance(5 * MIN)
    await t.runner.stop("p1")
    expect((await t.state.get("p1"))!.usageMs).toBe(5 * MIN)
  })

  it("gives nothing back once the session has run out, and never goes below zero", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    t.advance(SANDBOX_LIMITS.sessionMs + MIN)
    await t.runner.stop("p1")
    expect((await t.state.get("p1"))!.usageMs).toBe(SANDBOX_LIMITS.sessionMs)
    await t.state.addUsage("p1", -10 * SANDBOX_LIMITS.sessionMs, DAY)
    expect((await t.state.get("p1"))!.usageMs).toBe(0)
  })
})

describe("a VM that answers with a platform error", () => {
  const html = (status: number) => new Response("<html>bad gateway</html>", { status, headers: { "content-type": "text/html" } })

  it.each([502, 503, 504])("treats a non-JSON %i as a dead VM: drops it, restarts once and serves", async (status) => {
    const t = setup()
    await t.runner.invoke("p1", request)
    const first = [...t.handles.values()][0]
    t.forwardAnswers.push(html(status))
    const response = await t.runner.invoke("p1", request)
    expect(response.status).toBe(201)
    expect(first.stops).toBe(1)
    expect(t.createCalls).toHaveLength(2)
  })

  it("answers failed when the restarted VM answers the same way", async () => {
    const t = setup()
    t.forwardAnswers.push(html(502), html(502))
    const error = await t.runner.invoke("p1", request).catch((e) => e)
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error.reason).toBe("failed")
    expect(t.createCalls).toHaveLength(2)
    for (const handle of t.handles.values()) expect(handle.stops).toBe(1)
  })

  it("passes the runtime's own JSON 5xx through without a restart", async () => {
    const t = setup()
    t.forwardAnswers.push(new Response('{"error":{"code":"unavailable","message":"m"}}', { status: 502, headers: { "content-type": "application/json" } }))
    const response = await t.runner.invoke("p1", request)
    expect(response.status).toBe(502)
    expect(t.createCalls).toHaveLength(1)
  })
})

describe("the time budget of one invoke", () => {
  it("is 270 s by default, and a fresh start is timed against it", async () => {
    const t = setup({ holdCreate: true })
    const pending = t.runner.invoke("p1", request).catch((e) => e)
    await settle()
    expect(t.timers).toHaveLength(1)
    expect(t.timers[0].ms).toBe(270_000)
    t.releaseCreate()
    await pending
    expect(t.timers[0].cancelled).toBe(true)
  })

  it("skips the restart of a dead VM when less than 80 s are left, and still cleans up", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    const first = [...t.handles.values()][0]
    t.forwardFailures.count = 1
    t.forwardFailures.afterMs = 200_000
    const error = await t.runner.invoke("p1", request).catch((e) => e)
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error.reason).toBe("starting")
    expect(t.createCalls).toHaveLength(1)
    expect(first.stops).toBe(1)
    expect((await t.state.get("p1"))?.sandboxId).toBeNull()
  })

  it("restarts a dead VM while 80 s or more are left", async () => {
    const t = setup()
    await t.runner.invoke("p1", request)
    t.forwardFailures.count = 1
    t.forwardFailures.afterMs = 180_000
    expect((await t.runner.invoke("p1", request)).status).toBe(201)
    expect(t.createCalls).toHaveLength(2)
  })

  it("answers starting when the deadline passes during a start, then the next call reuses the VM", async () => {
    const t = setup({ holdCreate: true, budget: 100_000 })
    const pending = t.runner.invoke("p1", request).catch((e) => e)
    await settle()
    t.timers[0].fire()
    const error = await pending
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error.reason).toBe("starting")

    t.releaseCreate()
    await settle()
    const stored = (await t.state.get("p1"))!
    expect(stored.sandboxId).toBe([...t.handles.keys()][0])
    expect(stored.startingUntil).toBeNull()
    expect([...t.handles.values()][0].stops).toBe(0)

    const response = await t.runner.invoke("p1", request)
    expect(response.status).toBe(201)
    expect(t.createCalls).toHaveLength(1)
  })

  it("still stops and deletes a VM whose start fails after the deadline", async () => {
    const t = setup({ holdCreate: true, budget: 100_000, selfcheck: { egressBlocked: false, envKeys: 1 } })
    const pending = t.runner.invoke("p1", request).catch((e) => e)
    await settle()
    t.timers[0].fire()
    expect((await pending).reason).toBe("starting")

    t.releaseCreate()
    await settle()
    const handle = [...t.handles.values()][0]
    expect(handle.stops).toBe(1)
    expect(handle.deletes).toBe(1)
    expect((await t.state.get("p1"))?.sandboxId).toBeNull()
    expect((await t.state.get("p1"))!.usageMs).toBe(0)
  })

  it("does not start a VM when the budget is already spent", async () => {
    const t = setup({ budget: 0 })
    const error = await t.runner.invoke("p1", request).catch((e) => e)
    expect(error.reason).toBe("starting")
    expect(t.createCalls).toHaveLength(0)
  })

  it("hands every start to keepAlive, so the platform keeps the function running while it finishes", async () => {
    const t = setup({ holdCreate: true, budget: 100_000 })
    const pending = t.runner.invoke("p1", request).catch((e) => e)
    await settle()
    expect(t.kept).toHaveLength(1)
    t.timers[0].fire()
    await pending
    let done = false
    void t.kept[0].then(() => (done = true))
    await settle()
    expect(done).toBe(false)
    t.releaseCreate()
    await settle()
    expect(done).toBe(true)
  })
})
