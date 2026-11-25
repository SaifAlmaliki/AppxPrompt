import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {}, builds: {}, creditTransactions: {}, projects: {}, screens: {}, users: {} }))

const listServerRoutes = vi.fn(async () => [{ path: "app/api/a+api.ts", code: null }])
vi.mock("@/lib/server-routes/store", () => ({ listServerRoutes }))

import { ifIntegrations } from "@/lib/server-routes/gate"

afterEach(() => {
  vi.unstubAllEnvs()
  listServerRoutes.mockClear()
})

describe("ifIntegrations", () => {
  it("skips the read and answers an empty list while the flag is off", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "")
    const read = vi.fn(async () => [1])
    expect(await ifIntegrations(read)).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it("reads while the flag is on", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "1")
    expect(await ifIntegrations(async () => [1])).toEqual([1])
  })
})

function thenable(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const name of ["from", "where", "innerJoin"]) chain[name] = () => chain
  chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows)
  return chain
}

describe("the credit paths with the flag off", () => {
  it("chargeForBuild and refundUnfinishedBuild never read server_routes", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "")
    vi.resetModules()
    const rows: unknown[][] = [[], [{ charged: 0, project: { plan: null } }]]
    vi.doMock("@/db", () => ({
      db: { select: () => thenable(rows.shift() ?? []), transaction: vi.fn(async () => true) },
      builds: {}, creditTransactions: {}, projects: {}, screens: {}, users: {},
    }))
    const credits = await import("@/lib/billing/credits")
    const plan = { screens: [], serverRoutes: [{ path: "app/api/a+api.ts" }] } as never
    await credits.chargeForBuild({ id: "p1", userId: 1 }, plan, "free", ((key: string) => key) as never)
    expect(await credits.refundUnfinishedBuild("b1")).toBe(0)
    expect(listServerRoutes).not.toHaveBeenCalled()
  })
})
