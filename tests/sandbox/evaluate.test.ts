import { describe, expect, it, vi } from "vitest"
import { compileServerFile } from "@/lib/sandbox/routes"
import type { RuntimeBundle } from "@/lib/sandbox/bundle"
import { createDispatcher } from "@/sandbox-runtime/dispatch"
import { createVmEvaluator, hardenHost } from "@/sandbox-runtime/evaluate"

const KEY = "sk-proj-" + "a".repeat(40)
const env = { OPENAI_API_KEY: KEY, DECLARED: "hello", NODE_ENV: "production" }

function route(code: string, upstream: typeof fetch = vi.fn() as unknown as typeof fetch) {
  const path = "app/api/probe+api.ts"
  const bundle: RuntimeBundle = { files: { [path]: compileServerFile(path, code) }, routes: [path], allowedHosts: ["api.openai.com"], secretNames: ["OPENAI_API_KEY"] }
  const run = createDispatcher(bundle, { env, fetch: upstream, evaluate: createVmEvaluator() })
  return async () => {
    const response = await run(new Request("http://localhost/api/probe", { method: "POST" }))
    return { status: response.status, text: await response.text() }
  }
}

describe("createVmEvaluator", () => {
  it("still reads declared env vars", async () => {
    const answer = await route("export function POST() { return Response.json({ v: process.env.DECLARED, n: process.env.NODE_ENV }) }")()
    expect(JSON.parse(answer.text)).toEqual({ v: "hello", n: "production" })
  })

  it("has no way to print through globalThis.console", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const answer = await route("export function POST() { globalThis.console.log('X'); console.log('Y'); return Response.json({ ok: true }) }")()
    const wrote = stdout.mock.calls.length
    spy.mockRestore()
    stdout.mockRestore()
    expect(answer.status).toBe(200)
    expect(spy).not.toHaveBeenCalled()
    expect(wrote).toBe(0)
  })

  it("exposes only the allow-listed globals", async () => {
    const answer = await route(
      `export function POST() {
        return Response.json({
          ws: typeof WebSocket, es: typeof EventSource, req: typeof globalThis.require, buf: typeof Buffer,
          gmod: typeof globalThis.process?.getBuiltinModule, procKeys: Object.keys(process),
          fetch: typeof fetch, crypto: typeof crypto.subtle, btoa: btoa("a"), timer: typeof setTimeout,
        })
      }`
    )()
    expect(JSON.parse(answer.text)).toEqual({
      ws: "undefined",
      es: "undefined",
      req: "undefined",
      buf: "undefined",
      gmod: "undefined",
      procKeys: ["env"],
      fetch: "function",
      crypto: "object",
      btoa: "YQ==",
      timer: "function",
    })
  })

  it("gives Function('return this') nothing beyond the credentials", async () => {
    const answer = await route(
      `export function POST() {
        const g = Function("return this")()
        return Response.json({ keys: Object.keys(g.process.env), procKeys: Object.keys(g.process), require: typeof g.require, hasModule: typeof g.module, gmod: typeof g.process.getBuiltinModule })
      }`
    )()
    expect(answer.status).toBe(200)
    expect(JSON.parse(answer.text)).toEqual({ keys: Object.keys(env), procKeys: ["env"], require: "undefined", hasModule: "undefined", gmod: "undefined" })
  })

  it("rejects dynamic import with the generic error", async () => {
    const answer = await route("export async function POST() { const fs = await import('node:fs'); return Response.json({ ok: Boolean(fs) }) }")()
    expect(answer.status).toBe(500)
    expect(JSON.parse(answer.text)).toEqual({ error: { code: "unavailable", message: "The server function failed." } })
  })

  it("keeps the process object frozen", async () => {
    const answer = await route("export function POST() { process.env.DECLARED = 'x'; return Response.json({}) }")()
    expect(answer.status).toBe(500)
  })

  it("gives the route the guarded fetch, also as globalThis.fetch", async () => {
    const upstream = vi.fn(async () => Response.json({ ok: true }))
    const answer = await route(
      `export async function POST() {
        let blocked = false
        try { await globalThis.fetch("https://evil.example.com/x") } catch { blocked = true }
        const ok = await (await fetch("https://api.openai.com/v1/models")).json()
        return Response.json({ blocked, ok })
      }`,
      upstream as unknown as typeof fetch
    )()
    expect(JSON.parse(answer.text)).toEqual({ blocked: true, ok: { ok: true } })
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it("loads helpers across modules in the same context", async () => {
    const files: Record<string, string> = {
      "server/util.ts": compileServerFile("server/util.ts", "export const twice = (n: number) => n * 2"),
      "app/api/probe+api.ts": compileServerFile("app/api/probe+api.ts", 'import { twice } from "@/server/util"\nexport function POST() { return Response.json({ n: twice(4) }) }'),
    }
    const run = createDispatcher(
      { files, routes: ["app/api/probe+api.ts"], allowedHosts: [], secretNames: [] },
      { env, fetch: vi.fn() as unknown as typeof fetch, evaluate: createVmEvaluator() }
    )
    const response = await run(new Request("http://localhost/api/probe", { method: "POST" }))
    expect(await response.json()).toEqual({ n: 8 })
  })
})

describe("hardenHost", () => {
  it("removes the side doors and silences the console", () => {
    const log = vi.fn()
    const host = {
      process: { getBuiltinModule: () => 1, binding: () => 1, dlopen: () => 1, env: {} },
      global: { WebSocket: class {}, EventSource: class {}, fetch: () => 1 },
      console: { log, error: log, level: "x" },
    }
    hardenHost(host)
    expect(Object.keys(host.process)).toEqual(["env"])
    expect(Object.keys(host.global)).toEqual(["fetch"])
    ;(host.console.log as () => void)()
    ;(host.console.error as () => void)()
    expect(log).not.toHaveBeenCalled()
    expect(host.console.level).toBe("x")
  })
})
