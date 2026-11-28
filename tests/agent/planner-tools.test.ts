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
vi.mock("@/db", () => ({ db: {}, messages: {}, projects: {}, screens: {} }))
vi.mock("@/lib/agent/config", () => ({ configureAgents: vi.fn(), DEFAULT_SCREEN_COUNT: 4, PLANNER_MODEL: "test" }))
vi.mock("@/lib/cloudhike/backend", () => ({ getBackendStatus: vi.fn(), setUpBackend: vi.fn() }))
vi.mock("@/lib/services/store", () => ({ addServiceLesson: vi.fn(), getServiceNotes: vi.fn(), listServiceSummaries: vi.fn(), registerService: vi.fn() }))

async function load() {
  vi.resetModules()
  return import("@/lib/agent/planner")
}

const names = (tools: { name: string }[]) => tools.map((t) => t.name)

describe("plannerTools", () => {
  it("has only the app tools when integrations are off", async () => {
    const { plannerTools } = await load()
    expect(names(plannerTools(false) as never)).toEqual(["propose_plan", "confirm_plan", "update_app", "set_theme", "setup_backend", "request_backend"])
  })

  it("adds the outside-service and research tools when integrations are on", async () => {
    const { plannerTools } = await load()
    expect(names(plannerTools(true) as never)).toEqual([
      "propose_plan",
      "confirm_plan",
      "update_app",
      "set_theme",
      "setup_backend",
      "request_backend",
      "register_service",
      "read_service_notes",
      "add_service_lesson",
      "web_search",
      "read_page",
    ])
  })
})

describe("add_service_lesson", () => {
  const run = (context: object = {}) => ({ context: { turnStartedAt: Date.now(), projectId: "p1", ...context } })

  it("only saves the lesson through the store, and says what happened", async () => {
    const { plannerTools } = await load()
    const store = await import("@/lib/services/store")
    const lesson = (plannerTools(true) as unknown as { name: string; execute: (input: unknown, run: unknown) => Promise<string> }[]).find((t) => t.name === "add_service_lesson")!
    vi.mocked(store.addServiceLesson).mockResolvedValueOnce({ ok: true, added: true })
    expect(await lesson.execute({ service: " apify ", lesson: "Runs are slow" }, run())).toContain("Saved")
    expect(store.addServiceLesson).toHaveBeenCalledWith("p1", "apify", "Runs are slow")
    expect(store.registerService).not.toHaveBeenCalled()
    vi.mocked(store.addServiceLesson).mockResolvedValueOnce({ ok: false, reason: 'No service "x" is registered.' })
    expect(await lesson.execute({ service: "x", lesson: "y" }, run())).toBe('Lesson not saved: No service "x" is registered.')
  })

  it("is left out when integrations are off", async () => {
    const { plannerTools } = await load()
    expect(names(plannerTools(false) as never)).not.toContain("add_service_lesson")
  })
})

describe("warnIfSearchUnavailable", () => {
  it("warns once when the flag is on and there is no key", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "1")
    vi.stubEnv("TAVILY_API_KEY", "")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { warnIfSearchUnavailable } = await load()
    warnIfSearchUnavailable()
    warnIfSearchUnavailable()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith("APP_INTEGRATIONS is on but TAVILY_API_KEY isn't set, so the agent can't search the web.")
    warn.mockRestore()
    vi.unstubAllEnvs()
  })

  it("stays quiet when there is a key", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "1")
    vi.stubEnv("TAVILY_API_KEY", "tvly-secret")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { warnIfSearchUnavailable } = await load()
    warnIfSearchUnavailable()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    vi.unstubAllEnvs()
  })

  it("stays quiet when the flag is off", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "")
    vi.stubEnv("TAVILY_API_KEY", "")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { warnIfSearchUnavailable } = await load()
    warnIfSearchUnavailable()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    vi.unstubAllEnvs()
  })
})

