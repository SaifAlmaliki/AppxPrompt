import { afterEach, describe, expect, it, vi } from "vitest"
import type { AppPlan } from "@/lib/agent-protocol"
import { assembleBundle, serverAllowedHosts, serverSources } from "@/lib/sandbox/bundle"

vi.mock("@/db", () => ({ db: {}, serverRoutes: {}, projects: {}, projectCredentials: {}, projectServices: {} }))

const plan = {
  appName: "P",
  backend: { apiPath: "/api/apps/p1", authUrl: "https://p.cloudhike.dev/auth", authKey: "k", services: [] },
} as unknown as AppPlan

const openai = { allowedHosts: ["api.openai.com"], status: "connected" as const }
const google = { allowedHosts: ["www.googleapis.com"], status: "missing" as const }

afterEach(() => vi.unstubAllEnvs())

describe("serverAllowedHosts", () => {
  it("unions connected services with the app and auth hosts, sorted", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://appxprompt.com")
    expect(serverAllowedHosts(plan, [openai])).toEqual(["api.openai.com", "appxprompt.com", "p.cloudhike.dev"])
  })

  it("leaves out localhost, IP literals and non-https", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
    expect(serverAllowedHosts(plan, [openai, { allowedHosts: ["127.0.0.1", "[::1]", "10.0.0.5"], status: "connected" }])).toEqual([
      "api.openai.com",
      "p.cloudhike.dev",
    ])
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://appxprompt.com")
    expect(serverAllowedHosts(plan, [])).toEqual(["p.cloudhike.dev"])
  })

  it("ignores missing and rejected services", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://appxprompt.com")
    const hosts = serverAllowedHosts(plan, [openai, google, { allowedHosts: ["evil.example.com"], status: "rejected" }])
    expect(hosts).not.toContain("www.googleapis.com")
    expect(hosts).not.toContain("evil.example.com")
  })

  it("adds nothing for the backend when the plan has none, and dedupes", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://appxprompt.com")
    const noBackend = { appName: "P" } as unknown as AppPlan
    expect(serverAllowedHosts(noBackend, [openai, openai])).toEqual(["api.openai.com"])
  })
})

const systemFiles = [
  { path: "server/respond.ts", code: "export const ok = (v: unknown) => v" },
  { path: "server/auth.ts", code: "export const auth = 1" },
]
const rows = [
  { path: "app/api/booking/slots+api.ts", kind: "function" as const, code: "export async function GET() { return new Response('s') }" },
  { path: "app/api/booking/book+api.ts", kind: "function" as const, code: null },
  { path: "server/google.ts", kind: "helper" as const, code: "export const g: number = 1" },
  { path: "server/agents/assistant.instructions.ts", kind: "helper" as const, code: "export default 'hi'" },
]

describe("serverSources", () => {
  it("is the system files plus rows with code, sorted and uncompiled", () => {
    const out = serverSources(systemFiles, rows)
    expect(out.map((f) => f.path)).toEqual([
      "app/api/booking/slots+api.ts",
      "server/agents/assistant.instructions.ts",
      "server/auth.ts",
      "server/google.ts",
      "server/respond.ts",
    ])
    expect(out.find((f) => f.path === "server/google.ts")?.code).toBe("export const g: number = 1")
    expect(out.some((f) => f.path.startsWith("lib/"))).toBe(false)
  })
})

describe("assembleBundle", () => {
  const decoy = "sk-proj-" + "a".repeat(40)
  const result = assembleBundle({
    plan,
    rows,
    systemFiles,
    services: [openai],
    env: { OPENAI_API_KEY: decoy },
    secretNames: ["OPENAI_API_KEY"],
    signature: "sig",
  })

  it("lists only API route rows that have code", () => {
    expect(result.runtime.routes).toEqual(["app/api/booking/slots+api.ts"])
  })

  it("compiles a file for each system file and helper", () => {
    expect(Object.keys(result.runtime.files).sort()).toEqual(serverSources(systemFiles, rows).map((f) => f.path).sort())
    expect(result.runtime.files["server/google.ts"]).toContain("exports.g")
  })

  it("keeps credential values out of the runtime", () => {
    expect(JSON.stringify(result.runtime)).not.toContain(decoy)
    expect(result.env.OPENAI_API_KEY).toBe(decoy)
    expect(result.env.NODE_ENV).toBe("production")
  })

  it("names the secrets and the server key", () => {
    expect(result.runtime.secretNames).toEqual(["OPENAI_API_KEY", "APPXPROMPT_SERVER_KEY"])
    expect(result.signature).toBe("sig")
  })
})
