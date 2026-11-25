import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@openai/agents", () => ({
  Agent: class {
    constructor(public config: unknown) {}
  },
  assistant: vi.fn(),
  run: vi.fn(),
  user: vi.fn(),
  tool: (config: { name: string }) => ({ type: "function", ...config }),
}))
vi.mock("@/db", () => ({ db: {}, messages: {}, projects: {}, screens: {}, serverRoutes: {} }))
vi.mock("@/lib/agent/config", () => ({ configureAgents: vi.fn(), DEFAULT_SCREEN_COUNT: 4, PLANNER_MODEL: "test" }))
vi.mock("@/lib/cloudhike/backend", () => ({ getBackendStatus: vi.fn(), setUpBackend: vi.fn() }))
vi.mock("@/lib/server-routes/store", () => ({ listServerRoutes: vi.fn(), removeServerRoutes: vi.fn() }))
vi.mock("@/lib/services/store", () => ({ getServiceNotes: vi.fn(), listServiceSummaries: vi.fn(), registerService: vi.fn(), removeService: vi.fn() }))

import type { AppPlan, PlannedServerRoute } from "@/lib/agent-protocol"
import { SCREEN_CREDITS } from "@/lib/plans"

afterEach(() => vi.unstubAllEnvs())

type Tool = { name: string; execute: (input: unknown, run: { context: unknown }) => Promise<string> }

async function tools() {
  vi.resetModules()
  const { plannerTools } = await import("@/lib/agent/planner")
  return Object.fromEntries((plannerTools(true) as unknown as Tool[]).map((tool) => [tool.name, tool]))
}

const route = (path: string): PlannedServerRoute => ({
  id: path.replace(/\W+/g, "-"),
  path,
  purpose: "Does a thing",
  kind: "function",
  services: ["backend"],
  access: "signed_in",
})

const screen = { id: "home", name: "Home", purpose: "", keyElements: [], layout: "home", navigatesTo: [], tab: null }
const design = { style: "", mode: "light", primaryColor: "#000000", accentColor: "#000000", backgroundColor: "#ffffff" }

function context(overrides: Record<string, unknown> = {}) {
  const emit = vi.fn()
  return {
    run: { emit },
    status: "planning",
    plan: null,
    builtScreens: 0,
    rows: [],
    serverRows: [],
    services: [],
    account: { plan: "free", credits: 100 },
    latestUserMessage: "just build it",
    priorAssistantReplies: 0,
    interviewBlocked: false,
    proposedPlan: null,
    confirmed: false,
    changes: null,
    projectId: "p1",
    ...overrides,
  }
}

const planInput = (serverRoutes: PlannedServerRoute[]) => ({
  appName: "A",
  tagline: "",
  summary: "",
  targetUsers: "",
  navigation: "stack",
  design,
  screens: [{ ...screen, tab: null }],
  serverRoutes,
})

describe("propose_plan with server functions", () => {
  it("refuses a plan with routes while integrations are off", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "")
    const { propose_plan } = await tools()
    const result = await propose_plan.execute(planInput([route("app/api/a+api.ts")]), { context: context() })
    expect(result).toContain("Plan not saved: Server functions aren't available on this AppxPrompt server yet.")
  })

  it("refuses a route using a service that isn't registered", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "1")
    const { propose_plan } = await tools()
    const result = await propose_plan.execute(planInput([{ ...route("app/api/a+api.ts"), services: ["stripe"] }]), { context: context() })
    expect(result).toContain("register_service")
  })
})

describe("the credit check", () => {
  const plan = { appName: "A", tagline: "", summary: "", targetUsers: "", navigation: "stack", design, screens: [screen], serverRoutes: [route("app/api/a+api.ts"), route("app/api/b+api.ts")] } as unknown as AppPlan
  const rows = [{ slug: "home", name: "Home", code: "x" }]

  it("counts only the routes that aren't built", async () => {
    const { confirm_plan } = await tools()
    const built = [{ path: "app/api/a+api.ts", code: "export {}" }]
    const enough = context({ plan, rows, serverRows: built, account: { plan: "free", credits: SCREEN_CREDITS } })
    expect(await confirm_plan.execute({}, { context: enough })).toContain("Confirmed")

    const short = context({ plan, rows, serverRows: [], account: { plan: "free", credits: SCREEN_CREDITS } })
    expect(await confirm_plan.execute({}, { context: short })).toContain(`This costs ${SCREEN_CREDITS * 2} credits`)
  })
})

describe("update_app with server functions", () => {
  const plan = { appName: "A", tagline: "", summary: "", targetUsers: "", navigation: "stack", design, screens: [screen], serverRoutes: [{ ...route("app/api/a+api.ts"), services: ["google-calendar"] }] } as unknown as AppPlan
  const nothing = {
    appName: null,
    navigation: null,
    addScreens: [],
    editScreens: [],
    removeScreenIds: [],
    addComponents: [],
    editComponents: [],
    firstScreenId: null,
    dataChange: null,
    addServerRoutes: [],
    editServerRoutes: [],
    removeServerRoutePaths: [],
    removeServices: [],
  }

  it("queues a service removal and stops offering the service this turn", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "1")
    const { update_app } = await tools()
    const ctx = context({
      status: "ready",
      plan,
      builtScreens: 1,
      rows: [{ slug: "home", name: "Home", code: "x" }],
      services: [{ slug: "google-calendar", name: "Google Calendar", status: "connected", fields: [] }],
    })
    const result = await update_app.execute({ ...nothing, removeServices: ["google-calendar"] }, { context: ctx })
    expect(result).toContain("Queued")
    expect(ctx.changes).toMatchObject({ removedServices: ["google-calendar"] })
    expect(ctx.services).toEqual([])
  })

  it("refuses new routes while integrations are off", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "")
    const { update_app } = await tools()
    const ctx = context({ status: "ready", plan, builtScreens: 1, rows: [{ slug: "home", name: "Home", code: "x" }] })
    const result = await update_app.execute({ ...nothing, addServerRoutes: [route("app/api/b+api.ts")] }, { context: ctx })
    expect(result).toContain("Nothing changed: Server functions aren't available")
    expect(ctx.changes).toBeNull()
  })
})
