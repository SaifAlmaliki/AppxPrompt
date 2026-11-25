import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const rows = vi.hoisted(() => ({ current: [] as { hint: string }[], reads: 0 }))

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          rows.reads++
          return rows.current
        },
      }),
    }),
  },
  projectCredentials: {},
  projectServices: {},
}))

import { hashServerKey, newServerKey, verifyServerKey } from "@/lib/services/server-key"

beforeEach(() => {
  vi.useFakeTimers()
  rows.current = []
  rows.reads = 0
})

afterEach(() => vi.useRealTimers())

describe("verifyServerKey misses", () => {
  it("reads the database once for repeated bad keys on a project with no key", async () => {
    const project = "p-no-key"
    for (let i = 0; i < 5; i++) expect(await verifyServerKey(project, `bad-${i}`)).toBe(false)
    expect(rows.reads).toBe(1)
  })

  it("looks again after 30 seconds", async () => {
    const project = "p-later"
    await verifyServerKey(project, "a")
    vi.advanceTimersByTime(29_000)
    await verifyServerKey(project, "a")
    expect(rows.reads).toBe(1)

    const key = newServerKey()
    rows.current = [{ hint: hashServerKey(key) }]
    vi.advanceTimersByTime(2_000)
    expect(await verifyServerKey(project, key)).toBe(true)
    expect(rows.reads).toBe(2)
  })

  it("does not read again for a key that doesn't match a known hash", async () => {
    const project = "p-wrong-key"
    rows.current = [{ hint: hashServerKey(newServerKey()) }]
    expect(await verifyServerKey(project, "wrong-1")).toBe(false)
    expect(await verifyServerKey(project, "wrong-2")).toBe(false)
    expect(rows.reads).toBe(1)
  })
})
