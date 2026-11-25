import { describe, expect, it, vi } from "vitest"

import { applyAppChanges, planAppChanges, type AppChangeRequest } from "@/lib/agent/changes"
import type { AppPlan, PlannedScreen } from "@/lib/agent-protocol"
import { PLANS } from "@/lib/plans"
import { removeServerRoutes } from "@/lib/server-routes/store"
import { removeService } from "@/lib/services/store"

const events = vi.hoisted(() => [] as string[])
const updates = vi.hoisted(() => [] as unknown[])

vi.mock("@/db", () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }),
    insert: () => ({ values: async () => [] }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          updates.push(values)
          const done = Promise.resolve([{ plan: { screens: [] } }]) as Promise<unknown[]> & { returning: () => Promise<unknown[]> }
          done.returning = async () => [{ plan: { screens: [] } }]
          return done
        },
      }),
    }),
  }
  return {
    db: {
      transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        const result = await run(tx)
        events.push("committed")
        return result
      },
    },
    projects: {},
    screens: {},
    serverRoutes: {},
  }
})
vi.mock("@/lib/server-routes/store", () => ({ removeServerRoutes: vi.fn() }))
vi.mock("@/lib/services/store", () => ({ removeService: vi.fn(async () => void events.push("removed")) }))

function screen(id: string, name: string, tab: string | null = null): PlannedScreen {
  return {
    id,
    name,
    purpose: "",
    keyElements: [],
    layout: "home",
    navigatesTo: [],
    tab: tab ? { label: tab, icon: "home-outline" } : null,
  }
}

// What normalizePlan makes of a plan written in Arabic: the ids lose every letter.
const arabicPlan = {
  appName: "وصفات",
  tagline: "",
  summary: "",
  targetUsers: "",
  navigation: "tabs",
  design: { style: "", mode: "dark", primaryColor: "#000", accentColor: "#000", backgroundColor: "#000" },
  screens: [
    screen("screen", "تسجيل الدخول"),
    screen("screen-2", "استكشاف", "استكشاف"),
    screen("screen-3", "الوصفة"),
    screen("screen-4", "خطة الوجبات", "الخطة"),
    screen("screen-5", "قائمة التسوّق", "التسوق"),
  ],
} as AppPlan

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

describe("planAppChanges", () => {
  it("adds a new Arabic screen to an app whose screens have Arabic names", () => {
    const result = planAppChanges(arabicPlan, [], request({ addScreens: [screen("account", "حسابي", "حسابي")] }), 10)
    expect(typeof result).not.toBe("string")
    if (typeof result === "string") return
    expect(result.plan.screens.map((s) => s.name)).toContain("حسابي")
  })

  it("gives a new Arabic screen without a Latin id its own id", () => {
    const result = planAppChanges(arabicPlan, [], request({ addScreens: [screen("", "الإعدادات", "الإعدادات")] }), 10)
    if (typeof result === "string") throw new Error(result)
    const ids = result.plan.screens.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("adds a 6th and 7th screen on Pro, but not on Free", () => {
    const twoMore = request({
      addScreens: [screen("account", "حسابي", "حسابي"), screen("favorites", "المفضلة", "المفضلة")],
    })
    const pro = planAppChanges(arabicPlan, [], twoMore, PLANS.pro.maxScreens)
    if (typeof pro === "string") throw new Error(pro)
    expect(pro.plan.screens).toHaveLength(7)
    expect(planAppChanges(arabicPlan, [], twoMore, PLANS.free.maxScreens)).toMatch(/between 1 and 5/)
  })

  it("still refuses a screen the app already has", () => {
    expect(planAppChanges(arabicPlan, [], request({ addScreens: [screen("explore", "استكشاف", "استكشاف")] }), 10)).toMatch(
      /already has/
    )
    const english = { ...arabicPlan, screens: [screen("home", "Home", "Home"), screen("settings", "Settings", "Settings")] }
    expect(planAppChanges(english, [], request({ addScreens: [screen("settings-screen", "Settings Screen")] }), 10)).toMatch(
      /already has/
    )
  })
})

describe("removing a service", () => {
  const slots = {
    id: "booking-slots",
    path: "app/api/booking/slots+api.ts",
    purpose: "Lists the free booking times",
    kind: "function" as const,
    services: ["google-calendar", "backend"],
    access: "signed_in" as const,
  }
  const built = {
    ...arabicPlan,
    navigation: "stack",
    screens: [screen("book", "Book")],
    serverRoutes: [slots],
  } as AppPlan
  const rows = [{ slug: "book", name: "Book", code: 'await callServer("/api/booking/slots", {})' }]
  const options = { services: ["google-calendar"], enabled: true }

  it("strips the service from its routes, queues their rewrite and edits the screens that call them", () => {
    const result = planAppChanges(built, rows, request({ removeServices: ["google-calendar"] }), 10, options)
    if (typeof result === "string") throw new Error(result)
    expect(result.plan.serverRoutes).toMatchObject([{ path: slots.path, services: ["backend"] }])
    expect(result.plan.pendingChanges?.serverRoutes?.[slots.path]).toContain("google-calendar service was removed")
    expect(result.plan.pendingChanges?.edits.book).toContain("/api/booking/slots no longer uses it")
    expect(result.plan.pendingChanges?.updated).toEqual(expect.arrayContaining(["google-calendar", slots.purpose]))
    expect(result.removedServices).toEqual(["google-calendar"])
  })

  it("refuses a service that isn't registered", () => {
    expect(planAppChanges(built, rows, request({ removeServices: ["stripe"] }), 10, options)).toContain("stripe")
  })

  it("deletes the service after the transaction commits", async () => {
    events.length = 0
    updates.length = 0
    const result = planAppChanges(built, rows, request({ removeServices: ["google-calendar"] }), 10, options)
    if (typeof result === "string") throw new Error(result)
    await applyAppChanges("p1", result)
    expect(removeService).toHaveBeenCalledTimes(1)
    expect(removeService).toHaveBeenCalledWith("p1", "google-calendar")
    expect(events).toEqual(["committed", "removed"])
    expect(updates).toContainEqual({ status: "pending" })
    expect(removeServerRoutes).toHaveBeenCalledWith(expect.anything(), "p1", [])
  })
})
