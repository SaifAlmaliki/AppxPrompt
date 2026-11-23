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

  it("ignores hosts and imports mentioned in comments", () => {
    const code = route('// see https://evil.example.com/x and process.env.OTHER\n/* import x from "openai" */')
    expect(validateServerRoute(code, ctx)).toEqual([])
  })

  it("rejects a credential literal", () => {
    const key = "sk-proj-" + "a".repeat(40)
    expect(validateServerRoute(route(`const k = "${key}"`), ctx)).toContain(
      "It contains what looks like a credential. Read it from process.env instead."
    )
  })

  it("rejects dynamic code", () => {
    expect(validateServerRoute(route('eval("1")'), ctx).join()).toContain("eval(")
    expect(validateServerRoute(route('new Function("x")'), ctx).join()).toContain("new Function")
    expect(validateServerRoute(route('Function("x")()'), ctx).join()).toContain("Function(")
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
