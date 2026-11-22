import { describe, expect, it } from "vitest"

import { planAppChanges, type AppChangeRequest } from "@/lib/agent/changes"
import type { AppPlan, PlannedScreen } from "@/lib/agent-protocol"
import { PLANS } from "@/lib/plans"

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
