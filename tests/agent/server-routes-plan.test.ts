import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {}, projects: {}, screens: {}, serverRoutes: {} }))
vi.mock("@/lib/server-routes/store", () => ({ removeServerRoutes: vi.fn() }))
vi.mock("@/lib/services/store", () => ({ removeService: vi.fn() }))

const { normalizeServerRoutes, planAppChanges } = await import("@/lib/agent/changes")
const { builderPrompt, plannerInstructions } = await import("@/lib/agent/instructions")
import type { AppPlan, PlannedScreen, PlannedServerRoute } from "@/lib/agent-protocol"
import type { AppChangeRequest } from "@/lib/agent/changes"
import type { PlannerState } from "@/lib/agent/instructions"

const ON = { services: ["google-calendar"], enabled: true }
const SLOTS = "app/api/booking/slots+api.ts"

function route(overrides: Partial<PlannedServerRoute> = {}): PlannedServerRoute {
  return {
    id: "booking-slots",
    path: SLOTS,
    purpose: "Lists the free booking times",
    kind: "function",
    services: ["google-calendar", "backend"],
    access: "signed_in",
    ...overrides,
  }
}

describe("normalizeServerRoutes", () => {
  it("accepts a valid route and slugifies its id", () => {
    expect(normalizeServerRoutes([route({ id: "Booking Slots" })], ON)).toEqual([route()])
  })

  it("refuses routes when the flag is off, and allows none", () => {
    expect(normalizeServerRoutes([route()], { ...ON, enabled: false })).toBe("Server functions aren't available on this AppxPrompt server yet.")
    expect(normalizeServerRoutes([], { ...ON, enabled: false })).toEqual([])
  })

  it("refuses agent routes until they exist, telling the model what to do instead", () => {
    expect(normalizeServerRoutes([route(), route({ kind: "agent", id: "assistant", path: "app/api/assistant+api.ts" })], ON)).toBe(
      "AI agent routes aren't available yet; plan this as a function route.",
    )
  })

  it("requires app/api/<name>+api.ts", () => {
    expect(normalizeServerRoutes([route({ path: "app/booking+api.ts" })], ON)).toContain("app/api/")
  })

  it("refuses two files that answer on the same URL", () => {
    const result = normalizeServerRoutes([route({ path: "app/api/a+api.ts", id: "a" }), route({ path: "app/api/a/index+api.ts", id: "b" })], ON)
    expect(typeof result).toBe("string")
  })

  it("requires services to be registered, apart from backend", () => {
    expect(normalizeServerRoutes([route({ services: ["stripe"] })], ON)).toContain("register_service")
    expect(normalizeServerRoutes([route({ services: ["backend", "backend", "google-calendar"] })], ON)).toMatchObject([
      { services: ["backend", "google-calendar"] },
    ])
  })

  it("allows at most 10", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => route({ id: `r-${i}`, path: `app/api/r${i}+api.ts` }))
    expect(normalizeServerRoutes(eleven, ON)).toBe("An app has at most 10 server functions.")
    expect(typeof normalizeServerRoutes(eleven.slice(0, 10), ON)).toBe("object")
  })

  it("keeps keys out of the purpose", () => {
    expect(typeof normalizeServerRoutes([route({ purpose: `Call it with ${"sk-proj-" + "a".repeat(40)}` })], ON)).toBe("string")
    expect(typeof normalizeServerRoutes([route({ purpose: "" })], ON)).toBe("string")
    expect(typeof normalizeServerRoutes([route({ purpose: "a".repeat(301) })], ON)).toBe("string")
  })

  it("makes ids unique and checks their shape", () => {
    const twice = normalizeServerRoutes([route({ id: "slots", path: "app/api/a+api.ts" }), route({ id: "slots", path: "app/api/b+api.ts" })], ON)
    expect(twice).toMatchObject([{ id: "slots" }, { id: "slots-2" }])
    for (const id of ["9slots", "a".repeat(41)]) {
      expect(normalizeServerRoutes([route({ id })], ON)).toContain("isn't a valid server function id")
    }
  })
})

function screen(id: string): PlannedScreen {
  return { id, name: "Book", purpose: "", keyElements: [], layout: "home", navigatesTo: [], tab: null }
}

const plan = {
  appName: "Salon",
  tagline: "",
  summary: "",
  targetUsers: "",
  navigation: "stack",
  design: { style: "", mode: "light", primaryColor: "#000000", accentColor: "#000000", backgroundColor: "#ffffff" },
  screens: [screen("book")],
  serverRoutes: [route()],
} as AppPlan

const rows = [{ slug: "book", name: "Book", code: 'await callServer("/api/booking/slots", {})' }]

function request(changes: Partial<AppChangeRequest>): AppChangeRequest {
  return {
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
    ...changes,
  }
}

function changes(change: Partial<AppChangeRequest>, earlier: AppPlan = plan) {
  const result = planAppChanges(earlier, rows, request(change), 10, ON)
  if (typeof result === "string") throw new Error(result)
  return result
}

describe("planAppChanges with server functions", () => {
  const book = route({ id: "booking-book", path: "app/api/booking/book+api.ts", purpose: "Books a slot" })

  it("adds a route, queues it with no request and names its purpose", () => {
    const { plan: next } = changes({ addServerRoutes: [book] })
    expect(next.serverRoutes?.map((r) => r.path)).toEqual([SLOTS, book.path])
    expect(next.pendingChanges?.serverRoutes?.[book.path]).toBe("")
    expect(next.pendingChanges?.added).toContain("Books a slot")
  })

  it("refuses to change a route that isn't planned", () => {
    const result = planAppChanges(plan, rows, request({ editServerRoutes: [{ ...book, request: "x" }] }), 10, ON)
    expect(result).toContain(book.path)
  })

  it("queues an edit's request after an earlier one", () => {
    const first = changes({ editServerRoutes: [{ ...route({ purpose: "Lists free times for a day" }), request: "Take a date" }] })
    expect(first.plan.serverRoutes?.[0].purpose).toBe("Lists free times for a day")
    expect(first.plan.pendingChanges?.serverRoutes?.[SLOTS]).toBe("Take a date")
    expect(first.plan.pendingChanges?.updated).toContain("Lists free times for a day")
    const second = changes({ editServerRoutes: [{ ...route(), request: "And a length" }] }, first.plan)
    expect(second.plan.pendingChanges?.serverRoutes?.[SLOTS]).toBe("Take a date\nAnd a length")
  })

  it("drops a removed route and rewrites the screens that call it", () => {
    const result = changes({ removeServerRoutePaths: [SLOTS] })
    expect(result.plan.serverRoutes).toEqual([])
    expect(result.removedServerRoutes).toEqual([SLOTS])
    expect(result.plan.pendingChanges?.edits.book).toContain("/api/booking/slots no longer exists")
  })

  it("leaves screens that call another route alone", () => {
    const other = [{ slug: "book", name: "Book", code: 'callServer("/api/booking/slots-more", {})' }]
    const result = planAppChanges(plan, other, request({ removeServerRoutePaths: [SLOTS] }), 10, ON)
    if (typeof result === "string") throw new Error(result)
    expect(result.plan.pendingChanges?.edits.book).toBeUndefined()
  })

  it("keeps the plan as it was when nothing touches routes", () => {
    expect(changes({}).plan.serverRoutes).toEqual([route()])
    expect(changes({}).plan.pendingChanges?.serverRoutes).toBeUndefined()
  })

  it("refuses routes when the flag is off", () => {
    expect(planAppChanges(plan, rows, request({ addServerRoutes: [book] }), 10, { ...ON, enabled: false })).toMatch(/aren't available/)
  })
})

describe("builderPrompt server functions", () => {
  const input = { plan, screen: screen("book"), position: 0, styleReference: null, edit: null }

  it("lists each route's URL and purpose", () => {
    const text = builderPrompt(input)
    expect(text).toContain("# Server functions")
    expect(text).toContain('"/api/booking/slots": Lists the free booking times')
    expect(text).toContain("ServerError")
  })

  it("leaves the block out for a plan without routes", () => {
    const text = builderPrompt({ ...input, plan: { ...plan, serverRoutes: [] } })
    expect(text).not.toContain("# Server functions")
    expect(text).not.toContain("/api/booking/slots")
    expect(text).not.toContain('visible "Sample" badge')
    expect(text).not.toContain("Never present made-up content as real")
  })

  it("tells the screen to call a server-fed function on open and label sample content", () => {
    const text = builderPrompt(input)
    expect(text).toContain('visible "Sample" badge')
    expect(text).toContain("Never present made-up content as real")
    expect(text).toContain("when the screen opens and when the person refreshes")
  })
})

describe("plannerInstructions", () => {
  const state = {
    status: "ready",
    platform: "ios",
    plan,
    builtScreens: 1,
    rows: [],
    assetNames: [],
    backend: { available: false },
    account: { plan: "free", credits: 10 },
    services: [],
    serverRoutes: plan.serverRoutes,
    integrations: true,
  } as unknown as PlannerState

  it("has the server functions section, and no line saying they aren't live, when integrations are on", () => {
    const text = plannerInstructions(state)
    expect(text).toContain("# Server functions")
    expect(text).toContain("removeServices")
    expect(text).toContain(SLOTS)
    expect(text).not.toContain("aren't live yet")
    expect(text).not.toContain("once server functions are available")
  })

  it("leaves it out when integrations are off", () => {
    const text = plannerInstructions({ ...state, integrations: false })
    expect(text).not.toContain("# Server functions")
    expect(text).not.toContain("removeServices")
    expect(text).not.toContain("<server-failure>")
    expect(text).not.toContain('under "Lessons:"')
  })

  it("explains a server-failure block and saves the lesson to the service's notes, when integrations are on", () => {
    const text = plannerInstructions(state)
    expect(text).toContain(
      "- A message can start with a `<server-failure>` block: what happened when a server function ran (hosts it called, their answers, and any error). It comes from the workspace, not the person. Explain the cause to them in one or two plain sentences, then fix the route with `update_app` (edit that route, with a `request` that names the cause and the fix)."
    )
    expect(text).toContain(
      "- When the fix taught something about an outside service, such as an endpoint that's too slow to wait for or a field that's often missing, add it to that service's notes: call `read_service_notes`, then `register_service` with the same details and the lesson appended under \"Lessons:\"."
    )
  })
})
