import { describe, expect, it, vi } from "vitest"

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
vi.mock("@/lib/agent/changes", async (importOriginal) => ({ ...(await importOriginal<object>()), mergePlan: vi.fn() }))
vi.mock("@/lib/cloudhike/backend", () => ({ getBackendStatus: vi.fn(), setUpBackend: vi.fn() }))
vi.mock("@/lib/server-routes/store", () => ({ listServerRoutes: vi.fn(), removeServerRoutes: vi.fn() }))
vi.mock("@/lib/services/store", () => ({
  getServiceNotes: vi.fn(),
  listServiceSummaries: vi.fn(),
  registerService: vi.fn(),
  removeService: vi.fn(),
}))

import { plannerInstructions, type PlannerState } from "@/lib/agent/instructions"
import { findLeakedToolCall } from "@/lib/agent/leaked-tool-call"
import { reducer, type AgentState } from "@/hooks/use-project-agent"

type Tool = { name: string; execute: (input: unknown, run: { context: unknown }) => Promise<string> }

async function requestBackend() {
  vi.resetModules()
  const { plannerTools } = await import("@/lib/agent/planner")
  vi.mocked((await import("@/lib/agent/changes")).mergePlan).mockClear()
  return (plannerTools(false) as unknown as Tool[]).find((tool) => tool.name === "request_backend")!
}

const input = { reason: "TrendSwap needs accounts and a database for each person's videos and daily limit." }

describe("request_backend", () => {
  it("does nothing when the backend is already connected", async () => {
    const tool = await requestBackend()
    const emit = vi.fn()
    const context = { projectId: "p1", plan: { appName: "A" }, backend: { accountConnected: true, state: "ready" }, run: { emit } }
    expect(await tool.execute(input, { context })).toBe("The backend is already connected. If the app is built, call setup_backend.")
    expect(emit).not.toHaveBeenCalled()
  })

  it("opens the dialog and remembers the need on the plan", async () => {
    const tool = await requestBackend()
    const { mergePlan: merge } = await import("@/lib/agent/changes")
    const saved = { appName: "A", backendNeeded: true }
    vi.mocked(merge).mockResolvedValue(saved as never)
    const emit = vi.fn()
    const context = { projectId: "p1", plan: { appName: "A" }, backend: { accountConnected: false, state: "disconnected" }, run: { emit } }
    expect(await tool.execute(input, { context })).toContain("The Connect Backend dialog is open.")
    expect(merge).toHaveBeenCalledWith("p1", { backendNeeded: true })
    expect(emit).toHaveBeenCalledWith({ type: "backend-request", reason: input.reason })
    expect(context).toMatchObject({ plan: saved, backendRequested: true })
  })

  it("still opens the dialog before there is a plan", async () => {
    const tool = await requestBackend()
    const emit = vi.fn()
    const context = { projectId: "p1", plan: null, backend: { accountConnected: false, state: "disconnected" }, run: { emit } }
    await tool.execute(input, { context })
    expect(emit).toHaveBeenCalledWith({ type: "backend-request", reason: input.reason })
    expect(context).toMatchObject({ backendRequested: true })
    const { mergePlan } = await import("@/lib/agent/changes")
    expect(mergePlan).not.toHaveBeenCalled()
  })
})

describe("a request_backend call written out as text", () => {
  it("is caught as a leaked tool call", () => {
    expect(findLeakedToolCall("One moment <request_backend><parameter name=\"reason\">x</parameter>")).toEqual({ visible: "One moment", tool: "request_backend" })
  })
})

describe("backend requests in the agent state", () => {
  const start = { backendRequest: null } as unknown as AgentState

  it("keeps the reason until it's handled", () => {
    const asked = reducer(start, { type: "event", event: { type: "backend-request", reason: "It needs accounts." } })
    expect(asked.backendRequest).toBe("It needs accounts.")
    expect(reducer(asked, { type: "backend-request-handled" }).backendRequest).toBeNull()
  })
})

describe("the planner's words about the backend", () => {
  it("tells the agent to call request_backend instead of pointing at a button", () => {
    const text = plannerInstructions({
      status: "ready",
      platform: "ios",
      plan: null,
      builtScreens: 0,
      rows: [],
      assetNames: [],
      backend: { available: true },
      account: { plan: "free", credits: 10 },
      services: [],
      integrations: false,
    } as unknown as PlannerState)
    expect(text).toContain("call `request_backend`")
    expect(text).not.toContain("tell them to click Connect Backend at the top of the workspace")
  })
})
