import { describe, expect, it } from "vitest"

import type { AppPlan, PlannedServerRoute } from "@/lib/agent-protocol"
import { CREDIT_REASONS, buildCost, buildCostParts } from "@/lib/plans"

const screen = (id: string) => ({ id, name: id, purpose: "", navigatesTo: [], tab: null })
const route = (path: string): PlannedServerRoute => ({ id: path, path, purpose: "", kind: "function", services: [], access: "public" })

function planOf(parts: { screens: string[]; routes?: string[]; pendingChanges?: boolean }) {
  return {
    screens: parts.screens.map(screen),
    serverRoutes: parts.routes?.map(route),
    pendingChanges: parts.pendingChanges ? { summary: "tweak" } : undefined,
  } as unknown as Pick<AppPlan, "screens" | "pendingChanges" | "serverRoutes">
}

describe("build cost with server routes", () => {
  const plan = planOf({ screens: ["home", "cart"], routes: ["app/api/a+api.ts", "app/api/b+api.ts"] })
  const rows = [{ slug: "home", code: "x" }]

  it("charges screens and unbuilt routes", () => {
    expect(buildCostParts(plan, rows)).toEqual({ screens: 10, serverRoutes: 20, edit: 0 })
    expect(buildCost(plan, rows)).toBe(30)
  })

  it("doesn't charge a route that has code", () => {
    const parts = buildCostParts(plan, rows, [{ path: "app/api/a+api.ts", code: "export {}" }])
    expect(parts).toEqual({ screens: 10, serverRoutes: 10, edit: 0 })
  })

  it("charges a route whose row has no code", () => {
    expect(buildCostParts(plan, rows, [{ path: "app/api/a+api.ts", code: null }]).serverRoutes).toBe(20)
  })

  it("charges route edits as one round of changes", () => {
    const edits = planOf({ screens: ["home"], routes: ["app/api/a+api.ts"], pendingChanges: true })
    const parts = buildCostParts(edits, [{ slug: "home", code: "x" }], [{ path: "app/api/a+api.ts", code: "export {}" }])
    expect(parts).toEqual({ screens: 0, serverRoutes: 0, edit: 5 })
  })

  it("is unchanged for a plan without routes", () => {
    expect(buildCost(planOf({ screens: ["a", "b", "c"] }), [])).toBe(30)
  })

  it("has its own credit reason", () => {
    expect(CREDIT_REASONS).toContain("server-route")
  })
})
