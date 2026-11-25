import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AppPlan } from "@/lib/agent-protocol"
import { assembleBundle, buildSandboxBundle, sandboxSignature, serverSourceFiles } from "@/lib/sandbox/bundle"
import { runSelfCheck } from "@/sandbox-runtime/selfcheck"

const decoy = "sk-proj-" + "a".repeat(40)
const serverKey = "server-key-" + "b".repeat(30)

const plan = {
  appName: "P",
  backend: { apiPath: "/api/apps/p1", authUrl: "https://p.cloudhike.dev/auth", authKey: "k", services: [] },
  serverRoutes: [{ path: "app/api/booking/slots+api.ts", kind: "function", purpose: "Slots" }],
} as unknown as AppPlan

const calls = vi.hoisted(() => ({ order: [] as string[], execute: vi.fn() }))
const mocks = vi.hoisted(() => ({
  plan: null as unknown,
  rows: [] as unknown[],
  services: [] as unknown[],
  environment: { env: {}, secretNames: [] } as { env: Record<string, string>; secretNames: string[] },
}))

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ plan: mocks.plan }] }) }),
    execute: calls.execute,
  },
  serverRoutes: {},
  projects: {},
  projectCredentials: {},
  projectServices: {},
}))
vi.mock("@/lib/server-routes/store", () => ({ listServerRoutes: async () => mocks.rows }))
vi.mock("@/lib/services/store", () => ({
  listServiceSummaries: async () => mocks.services,
  loadProjectEnvironment: async () => {
    calls.order.push("environment")
    return mocks.environment
  },
}))
vi.mock("@/lib/services/server-key", () => ({
  ensureServerKey: async () => {
    calls.order.push("key")
  },
}))

beforeEach(() => {
  calls.order.length = 0
  calls.execute.mockReset()
  calls.execute.mockResolvedValue([{ routes: "t:1", credentials: "t:2", services: "t:1", backend: "{}", planned: "[]" }])
  mocks.plan = plan
  mocks.rows = [
    { path: "app/api/booking/slots+api.ts", kind: "function", code: "export async function GET() { return new Response('s') }" },
    { path: "server/google.ts", kind: "helper", code: "export const g: number = 1" },
  ]
  mocks.services = [{ allowedHosts: ["api.openai.com"], status: "connected" }]
  mocks.environment = {
    env: { OPENAI_API_KEY: decoy, APPXPROMPT_SERVER_KEY: serverKey, NEXT_PUBLIC_SHOP: "open" },
    secretNames: ["OPENAI_API_KEY", "APPXPROMPT_SERVER_KEY"],
  }
})

async function vmReports(bundle: Awaited<ReturnType<typeof buildSandboxBundle>>) {
  // The VM's env is the stdin line: the bundle's env plus the runner's own entries.
  const env = { ...bundle.env, APPXPROMPT_SANDBOX_SECRET: "s", PORT: "3000" }
  const hostFetch = (async () => {
    throw new TypeError("fetch failed")
  }) as typeof fetch
  return (await runSelfCheck({ hostFetch, env, secretNames: bundle.runtime.secretNames })).envKeys
}

describe("buildSandboxBundle", () => {
  it("keeps credential values out of the runtime", async () => {
    const bundle = await buildSandboxBundle("p1")
    const runtime = JSON.stringify(bundle.runtime)
    expect(runtime).not.toContain(decoy)
    expect(runtime).not.toContain(serverKey)
    expect(bundle.env.OPENAI_API_KEY).toBe(decoy)
  })

  it("makes the server key before it loads the environment", async () => {
    await buildSandboxBundle("p1")
    expect(calls.order).toEqual(["key", "environment"])
  })

  it("assembles routes, the generated system files and the signature", async () => {
    const bundle = await buildSandboxBundle("p1")
    expect(bundle.runtime.routes).toEqual(["app/api/booking/slots+api.ts"])
    expect(Object.keys(bundle.runtime.files)).toEqual(
      expect.arrayContaining(["server/auth.ts", "server/data.ts", "server/respond.ts", "server/google.ts"]),
    )
    expect(bundle.runtime.allowedHosts).toContain("api.openai.com")
    expect(bundle.signature).toBe(await sandboxSignature("p1"))
  })

  it("fails for a project with no plan", async () => {
    mocks.plan = null
    await expect(buildSandboxBundle("p1")).rejects.toThrow()
  })
})

describe("the credential count", () => {
  it("counts every named secret once: the server key, no public value, no runtime entry", async () => {
    const bundle = await buildSandboxBundle("p1")
    expect(bundle.runtime.secretNames.sort()).toEqual(["APPXPROMPT_SERVER_KEY", "OPENAI_API_KEY"])
    expect(await vmReports(bundle)).toBe(new Set(bundle.runtime.secretNames).size)
  })

  it("counts the server key once when the environment already names it", () => {
    const bundle = assembleBundle({
      plan,
      rows: [],
      systemFiles: [],
      services: [],
      env: { APPXPROMPT_SERVER_KEY: serverKey },
      secretNames: ["APPXPROMPT_SERVER_KEY"],
      signature: "s",
    })
    expect(bundle.runtime.secretNames).toEqual(["APPXPROMPT_SERVER_KEY"])
  })

  it("leaves out a secret whose value was lost, so a healthy VM still passes", async () => {
    mocks.environment = {
      env: { APPXPROMPT_SERVER_KEY: serverKey },
      secretNames: ["OPENAI_API_KEY", "APPXPROMPT_SERVER_KEY"],
    }
    const bundle = await buildSandboxBundle("p1")
    expect(bundle.runtime.secretNames).toEqual(["APPXPROMPT_SERVER_KEY"])
    expect(await vmReports(bundle)).toBe(new Set(bundle.runtime.secretNames).size)
  })

  it("is detected when the server key is missing from the environment", async () => {
    mocks.environment = { env: { OPENAI_API_KEY: decoy }, secretNames: ["OPENAI_API_KEY"] }
    const bundle = await buildSandboxBundle("p1")
    expect(await vmReports(bundle)).toBeLessThan(new Set(bundle.runtime.secretNames).size)
  })
})

describe("sandboxSignature", () => {
  it("is a stable hex digest of one query", async () => {
    const first = await sandboxSignature("p1")
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(await sandboxSignature("p1")).toBe(first)
    expect(calls.execute).toHaveBeenCalledTimes(2)
  })

  it("changes when anything counted changes", async () => {
    const first = await sandboxSignature("p1")
    calls.execute.mockResolvedValue([{ routes: "t:1", credentials: "t:3", services: "t:1", backend: "{}", planned: "[]" }])
    expect(await sandboxSignature("p1")).not.toBe(first)
  })
})

describe("serverSourceFiles", () => {
  it("is the generated system files plus the rows with code, sorted", async () => {
    const files = await serverSourceFiles("p1")
    expect(files.map((file) => file.path)).toEqual([...files.map((file) => file.path)].sort())
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["app/api/booking/slots+api.ts", "server/auth.ts", "server/google.ts"]),
    )
  })
})
