import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ order: [] as string[], limited: new Set<string>(), keyValid: false }))

vi.mock("@/lib/cloudhike/gateway", () => ({
  isRateLimited: (_project: string, address: string) => {
    state.order.push(`limit:${address}`)
    return state.limited.has(address)
  },
  getGatewayApp: async () => {
    state.order.push("app")
    return null
  },
}))
vi.mock("@/lib/services/server-key", () => ({
  verifyServerKey: async () => {
    state.order.push("verify")
    return state.keyValid
  },
}))
vi.mock("@/lib/cloudhike/app-schema", () => ({ RecordInputError: class extends Error {} }))
vi.mock("@/lib/storage", () => ({ safeFileName: (name: string) => name }))

import { GET } from "@/app/api/apps/[projectId]/[...path]/route"

const PROJECT = "11111111-1111-4111-8111-111111111111"

function get(headers: Record<string, string>) {
  const request = new Request(`http://x/api/apps/${PROJECT}/collections/a`, { headers })
  return GET(request as never, { params: Promise.resolve({ projectId: PROJECT, path: ["collections", "a"] }) })
}

beforeEach(() => {
  state.order = []
  state.limited = new Set()
  state.keyValid = false
})

describe("the gateway's rate limit", () => {
  it("counts the sender before looking up a server key", async () => {
    await get({ "x-forwarded-for": "9.9.9.9", "x-appxprompt-server-key": "made-up" })
    expect(state.order.slice(0, 2)).toEqual(["limit:9.9.9.9", "verify"])
  })

  it("never looks up the key of a sender that is over its limit", async () => {
    state.limited.add("9.9.9.9")
    const response = await get({ "x-forwarded-for": "9.9.9.9", "x-appxprompt-server-key": "made-up" })
    expect(response.status).toBe(429)
    expect(state.order).toEqual(["limit:9.9.9.9"])
  })

  it("gives a verified key its own bucket as well", async () => {
    state.keyValid = true
    state.limited.add("server")
    const response = await get({ "x-forwarded-for": "9.9.9.9", "x-appxprompt-server-key": "good" })
    expect(response.status).toBe(429)
    expect(state.order).toEqual(["limit:9.9.9.9", "verify", "limit:server"])
  })

  it("doesn't use the server bucket for a bad key", async () => {
    await get({ "x-forwarded-for": "9.9.9.9", "x-appxprompt-server-key": "bad" })
    expect(state.order).not.toContain("limit:server")
  })

  it("skips the lookup when there is no key", async () => {
    await get({})
    expect(state.order).toEqual(["limit:unknown", "app"])
  })
})
