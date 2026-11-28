import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
vi.mock("@/lib/services/store", () => ({
  getServiceNotes: vi.fn(),
  listServiceSummaries: vi.fn(),
  registerService: vi.fn(),
  removeService: vi.fn(),
}))

import enMessages from "@/messages/en.json"
import {
  canRetry,
  OUT_OF_TIME,
  outOfTime,
  PLANNER_HARD_STOP_MS,
  PLANNER_TURN_BUDGET_MS,
  stoppedReply,
  turnTimeLeft,
} from "@/lib/agent/turn-budget"
import { RESEARCH_TIME_MS } from "@/lib/research/limits"

const START = 1_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("turnTimeLeft", () => {
  it("counts down from the budget", () => {
    const ctx = { turnStartedAt: START }
    expect(turnTimeLeft(ctx)).toBe(PLANNER_TURN_BUDGET_MS)
    vi.setSystemTime(START + 100_000)
    expect(turnTimeLeft(ctx)).toBe(PLANNER_TURN_BUDGET_MS - 100_000)
    vi.setSystemTime(START + PLANNER_TURN_BUDGET_MS + 5_000)
    expect(turnTimeLeft(ctx)).toBe(-5_000)
  })

  it("has no limit for a context without a start time", () => {
    expect(turnTimeLeft({})).toBe(Number.POSITIVE_INFINITY)
    expect(outOfTime({})).toBe(false)
  })

  it("is out of time below 45 seconds left, and only retries with 90 or more", () => {
    const ctx = { turnStartedAt: START }
    vi.setSystemTime(START + PLANNER_TURN_BUDGET_MS - 45_000)
    expect(outOfTime(ctx)).toBe(false)
    vi.setSystemTime(START + PLANNER_TURN_BUDGET_MS - 44_999)
    expect(outOfTime(ctx)).toBe(true)

    vi.setSystemTime(START + PLANNER_TURN_BUDGET_MS - 90_000)
    expect(canRetry(ctx)).toBe(true)
    vi.setSystemTime(START + PLANNER_TURN_BUDGET_MS - 89_999)
    expect(canRetry(ctx)).toBe(false)
  })

  it("stops hard 30 seconds after the budget, before the 300 second limit", () => {
    expect(PLANNER_TURN_BUDGET_MS).toBe(240_000)
    expect(PLANNER_HARD_STOP_MS).toBe(270_000)
    expect(RESEARCH_TIME_MS).toBe(90_000)
  })
})

describe("the saved reply when a run is stopped", () => {
  it("is the fallback when nothing was streamed", () => {
    const fallback = enMessages.agentMessages.turnStopped
    expect(fallback).toBe('This step took longer than I can spend in one go. Reply "continue" and I\'ll pick up where I left off.')
    expect(stoppedReply("", fallback)).toBe(fallback)
    expect(stoppedReply("  \n", fallback)).toBe(fallback)
  })

  it("keeps what was streamed", () => {
    expect(stoppedReply("I registered Stripe.", "fallback")).toBe("I registered Stripe.")
  })
})

type Tool = { name: string; execute: (input: unknown, run: { context: unknown }) => Promise<string> }

async function tools() {
  vi.resetModules()
  const { plannerTools } = await import("@/lib/agent/planner")
  return Object.fromEntries((plannerTools(true) as unknown as Tool[]).map((tool) => [tool.name, tool]))
}

describe("planner tools when the turn is out of time", () => {
  const service = {
    slug: "stripe",
    name: "Stripe",
    purpose: "Payments",
    docsUrl: null,
    baseUrl: null,
    auth: { type: "bearer" },
    fields: [],
    notes: "",
  }

  it("register_service returns the out-of-time text and saves nothing", async () => {
    const { register_service } = await tools()
    const store = await import("@/lib/services/store")
    const emit = vi.fn()
    vi.setSystemTime(START + PLANNER_TURN_BUDGET_MS - 30_000)
    const result = await register_service.execute(service, { context: { turnStartedAt: START, projectId: "p1", run: { emit } } })
    expect(result).toBe(OUT_OF_TIME)
    expect(store.registerService).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it("the other tools stop too", async () => {
    const all = await tools()
    vi.setSystemTime(START + PLANNER_TURN_BUDGET_MS - 30_000)
    for (const name of ["propose_plan", "confirm_plan", "update_app", "set_theme", "setup_backend", "read_service_notes", "web_search", "read_page"]) {
      const emit = vi.fn()
      const context = { turnStartedAt: START, projectId: "p1", run: { emit }, research: { searches: 6, pages: 10 } }
      expect(await all[name].execute({ query: "x", url: "https://example.com", find: null, slug: "a" }, { context }), name).toBe(OUT_OF_TIME)
      expect(emit).not.toHaveBeenCalled()
    }
  })

  it("still works with time left", async () => {
    const { read_service_notes } = await tools()
    const store = await import("@/lib/services/store")
    vi.mocked(store.getServiceNotes).mockResolvedValue(null)
    vi.setSystemTime(START + 10_000)
    expect(await read_service_notes.execute({ slug: "a" }, { context: { turnStartedAt: START, projectId: "p1" } })).toContain("No service")
  })
})
