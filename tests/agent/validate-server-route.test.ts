import { describe, expect, it } from "vitest"

import { serverImportTarget, validateServerRoute } from "@/lib/agent/validate-server-route"

const ctx = {
  path: "app/api/booking/slots+api.ts",
  credentialNames: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_REFRESH_TOKEN"],
  allowedHosts: ["oauth2.googleapis.com", "www.googleapis.com"],
  helperPaths: ["server/google.ts"],
}

const route = (body: string, imports = "") => `${imports}\nexport async function POST(request: Request): Promise<Response> {\n${body}\n  return new Response("ok")\n}\n`

const validRoute = `
import { accessToken } from "@/server/google"
import { withErrors, ok } from "../../../server/respond"

export async function POST(request: Request): Promise<Response> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const id = "primary"
  const res = await fetch(\`https://www.googleapis.com/calendar/v3/\${id}\`, { headers: { Authorization: await accessToken(clientId) } })
  return ok(await res.json())
}
`

describe("validateServerRoute", () => {
  it("accepts a valid route", () => {
    expect(validateServerRoute(validRoute, ctx)).toEqual([])
  })

  it("rejects an npm package", () => {
    const problems = validateServerRoute(route("", 'import OpenAI from "openai"'), ctx)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("openai")
    expect(problems[0]).toContain("server/google.ts")
  })

  it("rejects a node built-in", () => {
    expect(validateServerRoute(route("", 'import fs from "node:fs"'), ctx).length).toBeGreaterThan(0)
  })

  it("checks process.env names", () => {
    expect(validateServerRoute(route("const k = process.env.OPENAI_API_KEY"), ctx).join()).toContain("process.env.OPENAI_API_KEY")
    expect(validateServerRoute(route('const k = process.env["OPENAI_API_KEY"]'), ctx).join()).toContain("OPENAI_API_KEY")
    expect(validateServerRoute(route("const k = process.env.APPXPROMPT_SERVER_KEY"), ctx)).toEqual([
      `Don't read APPXPROMPT_ values. Use data from "@/server/data" instead.`,
    ])
    expect(validateServerRoute(route("const k = process.env.NODE_ENV"), ctx)).toEqual([])
    expect(validateServerRoute(route('const k = process.env["GOOGLE_CALENDAR_CLIENT_ID"]'), ctx)).toEqual([])
  })

  it("requires literal credential names", () => {
    const message = "Read each credential as process.env.NAME."
    expect(validateServerRoute(route("const k = process.env[`X`]"), ctx)).toContain(message)
    expect(validateServerRoute(route("const name = 'X'\nconst k = process.env[name]"), ctx)).toContain(message)
    expect(validateServerRoute(route("const { A } = process.env"), ctx)).toContain(message)
  })

  it("only allows https to the service's hosts", () => {
    expect(validateServerRoute(route('await fetch("https://evil.example.com/x")'), ctx).join()).toContain("evil.example.com")
    expect(validateServerRoute(route('await fetch("http://www.googleapis.com")'), ctx)).toContain("It uses http://. Use https:// only.")
    expect(validateServerRoute(route('await fetch("https://oauth2.googleapis.com/token")'), ctx)).toEqual([])
  })

  it("ignores hosts mentioned in comments", () => {
    const code = route("// see https://evil.example.com/x\n/* and https://other.example.com */")
    expect(validateServerRoute(code, ctx)).toEqual([])
  })

  it("still sees a host after a regular expression containing //", () => {
    const code = route('const r = /\\//\nawait fetch("https://evil.example.com/x")')
    expect(validateServerRoute(code, ctx).join()).toContain("evil.example.com")
  })

  it("rejects imports written without spaces", () => {
    for (const imports of ['import x from"openai"', 'import{x}from"openai"', 'import"x"']) {
      expect(validateServerRoute(route("", imports), ctx).join(), imports).toContain("which isn't available")
    }
  })

  it("rejects other ways of reaching process.env", () => {
    const shapes = [
      'const k = process["env"].SECRET',
      "const k = process?.env.SECRET",
      "const p = process\nconst k = p.env.SECRET",
      "const k = process\n.env.SECRET",
      "const k = globalThis.process.env.SECRET",
      "const p = { process }\nconst k = p.process.env.SECRET",
      'const k = globalThis["process"].env.SECRET',
    ]
    for (const shape of shapes) {
      expect(validateServerRoute(route(shape), ctx).length, shape).toBeGreaterThan(0)
    }
    expect(validateServerRoute(route("const k = process?.env.GOOGLE_CALENDAR_CLIENT_ID\nconst n = process\n.env.NODE_ENV"), ctx)).toEqual([])
  })

  it("is not fooled by a regular expression before dynamic code", () => {
    expect(validateServerRoute(route('const r = /\\//; eval("1")'), ctx).join()).toContain("eval")
    expect(validateServerRoute(route('const r = /\\//; const p = process; p.env.X'), ctx).length).toBeGreaterThan(0)
    expect(validateServerRoute(route('const r = /\\//; const m = require("fs")'), ctx).length).toBeGreaterThan(0)
  })

  it("rejects indirect ways of running code", () => {
    const shapes = [
      '(0, eval)("1")',
      'globalThis["eval"]("1")',
      "const e = globalThis.eval",
      'const F = globalThis["Function"]',
      "const F = Function",
      '(async () => {}).constructor("return process")()',
    ]
    for (const shape of shapes) {
      expect(validateServerRoute(route(shape), ctx).length, shape).toBeGreaterThan(0)
    }
  })

  it("rejects ways of reaching code through bracket keys, Reflect and the global object", () => {
    const shapes = [
      '({})["constructor"]["constructor"]("return process")()',
      '[].filter["constructor"]("return process")()',
      "[].filter['constructor']('return process')()",
      "[].filter[`constructor`]('return process')()",
      'Reflect.get(globalThis, "eval")',
      'const r = Reflect',
      'const p = globalThis["pro" + "cess"]',
      'const e = globalThis["\\u0065val"]',
      'globalThis["fetch"] = async () => new Response()',
      'const e = this["eval"]',
      'const e = self["eval"]',
      'const e = globalThis?.["eval"]',
    ]
    for (const shape of shapes) {
      expect(validateServerRoute(route(shape), ctx).length, shape).toBeGreaterThan(0)
    }
    expect(validateServerRoute(route('const r = Reflect.get(globalThis, "eval")'), ctx).join()).toContain("Reflect")
    expect(validateServerRoute(route('const e = this["eval"]'), ctx).join()).toContain("globalThis, self or this")
  })

  it("still accepts ordinary bracket access and words", () => {
    const code = `
import { ok } from "../../../server/respond"

export async function POST(request: Request): Promise<Response> {
  const obj: Record<string, string> = { key: "v" }
  const headers: Record<string, string> = { "content-type": "application/json" }
  const items = [1, 2, 3]
  const first = items[0]
  const type = headers["content-type"]
  const text = "A Reflection on this[0] and globalThis[x] and a constructor"
  // Reflect on globalThis["x"]
  return ok({ value: obj["key"], first, type, text })
}
`
    expect(validateServerRoute(code, ctx)).toEqual([])
  })

  it("accepts ordinary server code", () => {
    const code = `
import { accessToken } from "@/server/google"
import { ok } from "../../../server/respond"
import { rows } from "@/server/data"

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { day: string }
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const mode = process.env.NODE_ENV
  const clean = body.day.replace(/[^0-9-]/g, "").split("/")
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: id + mode + clean })
  if (!res.ok) return new Response("Could not process the request", { status: 502 })
  return ok(await res.json())
}
`
    expect(validateServerRoute(code, ctx)).toEqual([])
  })

  it("ignores process, eval, Function and imports written in prose", () => {
    const shapes = [
      'return new Response("Could not process. Try again", { status: 502 })',
      'const message = "Function not found"',
      "// never eval user input\nconst n = 1",
      "/* new Function and require(x) are not allowed,\n process.env.OTHER too */\nconst n = 1",
      "const message = `Could not process ${request.url}. Function not found`",
      "const note = 'import x from \"openai\"'",
      '// import x from "openai"\nconst n = 1',
      'const text = "call eval(x) or import(y) or process.binding or [\\"eval\\"]"',
      "const text = '[\"Function\"] and [\"process\"]'",
    ]
    for (const shape of shapes) {
      expect(validateServerRoute(route(shape), ctx), shape).toEqual([])
    }
  })

  it("still checks template expressions and code next to prose", () => {
    const shapes = [
      "const p = process",
      'const v = "" + process.env.X',
      "const v = `key ${process.env.X}`",
      'const v = `a ${eval("1")} b`',
      'const v = "a" + eval("1")',
      'const v = "Function not found"\nconst F = Function',
      '// eval\nconst e = globalThis["eval"]',
      "const v = globalThis[`Function`]",
    ]
    for (const shape of shapes) {
      expect(validateServerRoute(route(shape), ctx).length, shape).toBeGreaterThan(0)
    }
  })

  it("rejects a credential literal", () => {
    const key = "sk-proj-" + "a".repeat(40)
    expect(validateServerRoute(route(`const k = "${key}"`), ctx)).toContain(
      "It contains what looks like a credential. Read it from process.env instead."
    )
  })

  it("rejects dynamic code", () => {
    expect(validateServerRoute(route('eval("1")'), ctx).join()).toContain("eval")
    expect(validateServerRoute(route('new Function("x")'), ctx).join()).toContain("new Function")
    expect(validateServerRoute(route('Function("x")()'), ctx).join()).toContain("Function")
    expect(validateServerRoute(route('({}).constructor.constructor("return process")()'), ctx).join()).toContain(".constructor.constructor")
    expect(validateServerRoute(route('const m = require("fs")'), ctx).join()).toContain("require(")
    expect(validateServerRoute(route('const m = await import("x")'), ctx).join()).toContain("import(")
    expect(validateServerRoute(route("globalThis.fetch = async () => new Response()"), ctx).join()).toContain("globalThis.fetch =")
  })

  it("reports code that doesn't compile", () => {
    expect(validateServerRoute("export async function POST( {", ctx)[0]).toMatch(/^It doesn't compile: .+\.$/)
  })

  it("requires a handler in a route", () => {
    expect(validateServerRoute("export const x = 1", ctx)).toContain(
      "It has no request handler. Export async function POST(request: Request): Promise<Response>."
    )
    expect(validateServerRoute("export const GET = async () => new Response()", ctx)).toEqual([])
  })

  it("keeps handlers out of helpers", () => {
    const problems = validateServerRoute("export async function POST() { return new Response() }", { ...ctx, path: "server/google.ts" })
    expect(problems).toEqual(["Helpers can't handle requests. Move the handler into an app/api route."])
  })

  it("refuses system files and other paths", () => {
    expect(validateServerRoute("export const x = 1", { ...ctx, path: "server/data.ts" })).toEqual(["server/data.ts isn't a file you can write."])
    expect(validateServerRoute("export const x = 1", { ...ctx, path: "app/index.tsx" })).toEqual(["app/index.tsx isn't a file you can write."])
  })

  it("lets a route import other API routes and helpers it was given", () => {
    const agent = {
      ...ctx,
      path: "app/api/assistant+api.ts",
      helperPaths: ["app/api/booking/slots+api.ts", "server/agent-loop.ts"],
    }
    const code = route("", 'import { POST as findSlots } from "@/app/api/booking/slots+api"\nimport { runAgentLoop } from "@/server/agent-loop"')
    expect(validateServerRoute(code, agent)).toEqual([])
    expect(validateServerRoute(code, { ...agent, helperPaths: [] })[0]).toContain("which isn't available")
  })

  it("accepts an instructions file", () => {
    const problems = validateServerRoute('export const instructions = "Be helpful."', { ...ctx, path: "server/agents/assistant.instructions.ts" })
    expect(problems).toEqual([])
  })
})

describe("serverImportTarget", () => {
  it("resolves project and relative imports", () => {
    expect(serverImportTarget("app/api/booking/slots+api.ts", "../../../server/google")).toBe("server/google.ts")
    expect(serverImportTarget("server/a.ts", "./b")).toBe("server/b.ts")
    expect(serverImportTarget("app/api/assistant+api.ts", "@/app/api/booking/slots+api")).toBe("app/api/booking/slots+api.ts")
    expect(serverImportTarget("app/api/x+api.ts", "@/server/google")).toBe("server/google.ts")
  })

  it("gives null for packages and built-ins", () => {
    expect(serverImportTarget("x", "openai")).toBeNull()
    expect(serverImportTarget("x", "node:fs")).toBeNull()
  })
})
