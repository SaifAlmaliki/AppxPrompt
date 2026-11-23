import { afterAll, describe, expect, it, vi } from "vitest"
import { compileServerFile } from "@/lib/sandbox/routes"
import type { RuntimeBundle } from "@/lib/sandbox/bundle"
import { createDispatcher, guardedFetch } from "@/sandbox-runtime/dispatch"

const KEY = "sk-proj-" + "a".repeat(40)
const env = { OPENAI_API_KEY: KEY, NODE_ENV: "production" }
const realFetch = globalThis.fetch

afterAll(() => {
  globalThis.fetch = realFetch
})

function bundleOf(sources: Record<string, string>): RuntimeBundle {
  const files: Record<string, string> = {}
  for (const [path, code] of Object.entries(sources)) files[path] = compileServerFile(path, code)
  return {
    files,
    routes: Object.keys(sources).filter((path) => path.endsWith("+api.ts")),
    allowedHosts: ["api.openai.com"],
    secretNames: ["OPENAI_API_KEY"],
  }
}

function dispatcher(sources: Record<string, string>, extra: { timeoutMs?: number; maxBodyBytes?: number } = {}) {
  return createDispatcher(bundleOf(sources), { env, fetch: vi.fn() as unknown as typeof fetch, ...extra })
}

const post = (path: string, body?: BodyInit) => new Request(`http://localhost${path}`, { method: "POST", body })
const get = (path: string) => new Request(`http://localhost${path}`)

describe("createDispatcher", () => {
  it("gives routes the env through process.env", async () => {
    const run = dispatcher({ "app/api/ping+api.ts": "export function POST() { return Response.json({ set: Boolean(process.env.OPENAI_API_KEY) }) }" })
    const response = await run(post("/api/ping"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ set: true })
  })

  it("passes dynamic params", async () => {
    const run = dispatcher({ "app/api/booking/[id]+api.ts": "export function POST(request, params) { return Response.json(params) }" })
    const response = await run(post("/api/booking/b1"))
    expect(await response.json()).toEqual({ id: "b1" })
  })

  it("loads helpers and other routes by alias and relative path", async () => {
    const run = dispatcher({
      "server/util.ts": "export const double = (n: number) => n * 2",
      "app/api/booking/slots+api.ts": 'import { double } from "../../../server/util"\nexport function POST() { return Response.json({ slots: double(2) }) }',
      "app/api/assistant+api.ts":
        'import { POST as slots } from "@/app/api/booking/slots+api"\nimport { double } from "@/server/util"\nexport function POST(request) { return slots(request, {}) }\nexport const unused = double',
    })
    const response = await run(post("/api/assistant"))
    expect(await response.json()).toEqual({ slots: 4 })
  })

  it("refuses node built-ins and packages", async () => {
    const run = dispatcher({ "app/api/fs+api.ts": 'import fs from "node:fs"\nexport function POST() { return Response.json(Boolean(fs)) }' })
    const response = await run(post("/api/fs"))
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe("unavailable")
  })

  it("answers 504 when the handler hangs", async () => {
    const run = dispatcher({ "app/api/hang+api.ts": "export async function POST() { await new Promise(() => {}) }" }, { timeoutMs: 50 })
    const response = await run(post("/api/hang"))
    expect(response.status).toBe(504)
    expect((await response.json()).error.code).toBe("unavailable")
  })

  it("answers 500 when the handler doesn't return a Response", async () => {
    const run = dispatcher({ "app/api/odd+api.ts": "export function POST() { return {} }" })
    const response = await run(post("/api/odd"))
    expect(response.status).toBe(500)
    expect((await response.json()).error.message).toContain("didn't answer")
  })

  it("answers 413 for a request body over the limit", async () => {
    const run = dispatcher({ "app/api/big+api.ts": "export function POST() { return Response.json({}) }" })
    const response = await run(post("/api/big", "a".repeat(2 * 1024 * 1024)))
    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe("bad_request")
  })

  it("answers 500 for a response body over the limit", async () => {
    const run = dispatcher({ "app/api/huge+api.ts": 'export function POST() { return new Response("a".repeat(100)) }' }, { maxBodyBytes: 50 })
    const response = await run(post("/api/huge"))
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe("unavailable")
  })

  it("answers 405 when the method isn't exported", async () => {
    const run = dispatcher({ "app/api/only+api.ts": "export function POST() { return Response.json({}) }" })
    const response = await run(get("/api/only"))
    expect(response.status).toBe(405)
    expect((await response.json()).error.code).toBe("bad_request")
  })

  it("answers 404 for an unknown path", async () => {
    const run = dispatcher({ "app/api/only+api.ts": "export function POST() { return Response.json({}) }" })
    const response = await run(get("/api/missing"))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: "bad_request", message: "There's no server function at /api/missing." } })
  })

  it("doesn't leak a secret through a thrown error", async () => {
    const run = dispatcher({ "app/api/boom+api.ts": "export function POST() { throw new Error(process.env.OPENAI_API_KEY) }" })
    const response = await run(post("/api/boom"))
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(text).not.toContain("sk-proj-")
    expect(JSON.parse(text).error).toEqual({ code: "unavailable", message: "The server function failed." })
  })

  it("blocks a response that contains a secret", async () => {
    const run = dispatcher({ "app/api/leak+api.ts": "export function POST() { return new Response(process.env.OPENAI_API_KEY) }" })
    const response = await run(post("/api/leak"))
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(text).toContain("blocked")
    expect(text).not.toContain("sk-proj-")
  })

  it("silences console output", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const run = dispatcher({ "app/api/log+api.ts": "export function POST() { console.log(process.env); return Response.json({ ok: true }) }" })
    const response = await run(post("/api/log"))
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain("sk-proj-")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("won't let a route change process.env", async () => {
    const run = dispatcher({ "app/api/mut+api.ts": "export function POST() { process.env.OPENAI_API_KEY = 'x'; return Response.json({ k: process.env.OPENAI_API_KEY }) }" })
    const response = await run(post("/api/mut"))
    expect((await response.text()).includes(KEY)).toBe(false)
  })

  it("guards the fetch that routes use", async () => {
    const upstream = vi.fn(async () => Response.json({ ok: true }))
    const run = createDispatcher(
      bundleOf({
        "app/api/out+api.ts":
          "export async function POST() { try { await fetch('https://evil.example.com/x'); return Response.json({ blocked: false }) } catch (e) { return Response.json({ blocked: true }) } }",
      }),
      { env, fetch: upstream as unknown as typeof fetch }
    )
    const response = await run(post("/api/out"))
    expect(await response.json()).toEqual({ blocked: true })
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe("guardedFetch", () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

  it("lets an allowed https host through", async () => {
    const fake = vi.fn(async () => Response.json({ ok: true }))
    const guarded = guardedFetch(fake as unknown as typeof fetch, ["api.openai.com"])
    const response = await guarded("https://api.openai.com/v1/models")
    expect(response.status).toBe(200)
    expect(fake).toHaveBeenCalledTimes(1)
    expect(fake.mock.calls[0]).toEqual(["https://api.openai.com/v1/models", expect.objectContaining({ redirect: "manual" })])
  })

  it("rejects other hosts and plain http without calling fetch", async () => {
    const fake = vi.fn(async () => Response.json({}))
    const guarded = guardedFetch(fake as unknown as typeof fetch, ["api.openai.com"])
    await expect(guarded("https://evil.example.com")).rejects.toThrow(/evil\.example\.com isn't one of this app's allowed hosts/)
    await expect(guarded("http://api.openai.com")).rejects.toThrow(TypeError)
    expect(fake).not.toHaveBeenCalled()
  })

  it("rejects a redirect to another host", async () => {
    const fake = vi.fn(async () => redirect("https://evil.example.com/x"))
    const guarded = guardedFetch(fake as unknown as typeof fetch, ["api.openai.com"])
    await expect(guarded("https://api.openai.com/v1")).rejects.toThrow(/evil\.example\.com/)
    expect(fake).toHaveBeenCalledTimes(1)
  })

  it("follows a redirect to an allowed host", async () => {
    const fake = vi.fn(async (url: string) => (url.endsWith("/v1") ? redirect("https://api.openai.com/v2") : Response.json({ at: url })))
    const guarded = guardedFetch(fake as unknown as typeof fetch, ["api.openai.com"])
    const response = await guarded("https://api.openai.com/v1")
    expect(await response.json()).toEqual({ at: "https://api.openai.com/v2" })
    expect(fake).toHaveBeenCalledTimes(2)
  })

  it("stops after too many redirects", async () => {
    const fake = vi.fn(async () => redirect("https://api.openai.com/loop"))
    const guarded = guardedFetch(fake as unknown as typeof fetch, ["api.openai.com"])
    await expect(guarded("https://api.openai.com/loop")).rejects.toThrow(/redirects/)
    expect(fake).toHaveBeenCalledTimes(6)
  })
})
