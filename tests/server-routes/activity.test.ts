import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  rows: [] as { id: number; projectId: string; [key: string]: unknown }[],
  nextId: 1,
  fail: false,
  limit: 0,
}))

vi.mock("@/db", () => {
  const serverRouteCalls = { id: "id", projectId: "projectId" }
  return {
    serverRouteCalls,
    db: {
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          if (state.fail) throw new Error("db down")
          state.rows.push({ id: state.nextId++, ...row } as never)
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: (n: number) => {
                state.limit = n
                return { kind: "newest", n }
              },
            }),
          }),
        }),
      }),
      delete: () => ({
        where: async () => {
          const keep = new Set(
            [...state.rows]
              .sort((a, b) => b.id - a.id)
              .slice(0, state.limit)
              .map((row) => row.id),
          )
          state.rows = state.rows.filter((row) => keep.has(row.id))
        },
      }),
    },
  }
})
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: () => ({}),
  and: () => ({}),
  desc: () => ({}),
  notInArray: () => ({}),
}))

import { MAX_STORED_CALLS, recordServerCall, toCallRow, type ServerCallInput } from "@/lib/server-routes/activity"
import { describeFetch, failingFetch, serverCallResult } from "@/lib/server-routes/activity-protocol"
import { readSandboxError } from "@/lib/sandbox/http"

const PROJECT = "11111111-1111-4111-8111-111111111111"

function input(overrides: Partial<ServerCallInput> = {}): ServerCallInput {
  return { projectId: PROJECT, path: "/api/pay", method: "POST", status: 200, errorCode: null, service: null, durationMs: 12, ...overrides }
}

beforeEach(() => {
  state.rows = []
  state.nextId = 1
  state.fail = false
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("toCallRow", () => {
  it("keeps only the allowed fields and never a query string", () => {
    const row = toCallRow({
      ...input({ path: "/api/pay?token=secret&email=a@b.c#frag" }),
      body: "{}",
      headers: { authorization: "x" },
      ip: "1.2.3.4",
    } as ServerCallInput)
    expect(row).toEqual({
      projectId: PROJECT,
      path: "/api/pay",
      method: "POST",
      status: 200,
      errorCode: null,
      service: null,
      durationMs: 12,
      detail: null,
    })
  })

  const diagnostic = { ms: 30, fetches: [{ host: "api.apify.com", status: 401, ms: 20 }], thrown: { name: "Error", message: "Apify answered 401" } }

  it("stores a valid diagnostic as the call's detail", () => {
    expect(toCallRow(input({ diagnostic })).detail).toEqual(diagnostic)
  })

  it("stores nothing when the diagnostic has no outgoing call and no error", () => {
    expect(toCallRow(input({ diagnostic: { ms: 3, fetches: [] } })).detail).toBeNull()
  })

  it("drops a diagnostic of the wrong shape, and any field it doesn't know", () => {
    const bad = [
      { ms: 1, fetches: [{ host: "api.apify.com/v2/runs?token=x", ms: 1 }] },
      { ms: 1, fetches: [{ host: "a.com", status: "401", ms: 1 }] },
      { ms: 1, fetches: [{ host: "a.com", error: "refused", ms: 1 }] },
      { ms: 1, fetches: Array.from({ length: 11 }, () => ({ host: "a.com", ms: 1 })) },
      { ms: 1, fetches: [], thrown: { name: "E", message: "m".repeat(201) } },
      "string",
      null,
    ]
    for (const value of bad) expect(toCallRow(input({ diagnostic: value })).detail).toBeNull()
    const withExtras = { ...diagnostic, body: "{}", fetches: [{ host: "a.com", status: 200, ms: 1, url: "https://a.com/x?t=1", headers: {} }] }
    expect(toCallRow(input({ diagnostic: withExtras })).detail).toEqual({
      ms: 30,
      fetches: [{ host: "a.com", status: 200, ms: 1 }],
      thrown: diagnostic.thrown,
    })
  })

  it("drops an error code or service name it doesn't recognise", () => {
    expect(toCallRow(input({ errorCode: "<script>", service: "not a slug!" }))).toMatchObject({ errorCode: null, service: null })
    expect(toCallRow(input({ errorCode: "not_connected", service: "stripe" }))).toMatchObject({ errorCode: "not_connected", service: "stripe" })
  })

  it("holds a long path and a negative duration to a safe size", () => {
    const row = toCallRow(input({ path: "/" + "a".repeat(1000), durationMs: -5.7 }))
    expect(row.path.length).toBe(300)
    expect(row.durationMs).toBe(0)
  })
})

describe("recordServerCall", () => {
  it("stores the call", async () => {
    await recordServerCall(input({ path: "/api/x?q=1" }))
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]).toMatchObject({ path: "/api/x", method: "POST" })
    expect(Object.keys(state.rows[0]).sort()).toEqual(["detail", "durationMs", "errorCode", "id", "method", "path", "projectId", "service", "status"])
  })

  it("round-trips the detail", async () => {
    const diagnostic = { ms: 9, fetches: [{ host: "api.apify.com", error: "timeout" as const, ms: 9 }] }
    await recordServerCall(input({ status: 500, diagnostic }))
    expect(state.rows[0].detail).toEqual(diagnostic)
  })

  it("keeps only the newest 200 calls", async () => {
    for (let i = 0; i < MAX_STORED_CALLS + 5; i++) await recordServerCall(input({ path: `/api/${i}` }))
    expect(state.rows).toHaveLength(MAX_STORED_CALLS)
    expect(state.rows.some((row) => row.path === "/api/0")).toBe(false)
    expect(state.rows.some((row) => row.path === `/api/${MAX_STORED_CALLS + 4}`)).toBe(true)
  })

  it("never throws when the database fails", async () => {
    state.fail = true
    await expect(recordServerCall(input())).resolves.toBeUndefined()
  })

  it("never throws on input it can't use", async () => {
    await expect(recordServerCall(undefined as never)).resolves.toBeUndefined()
  })
})

describe("the error body", () => {
  const json = { "content-type": "application/json" }

  it("reads the code and service from the standard body", () => {
    const body = JSON.stringify({ error: { code: "not_connected", message: "m", service: "stripe" } })
    expect(readSandboxError(502, json, body)).toEqual({ code: "not_connected", service: "stripe" })
  })

  it("reads nothing from a success, a non-JSON body or garbage", () => {
    expect(readSandboxError(200, json, "{}")).toEqual({ code: null, service: null })
    expect(readSandboxError(500, { "content-type": "text/html" }, "<p>oops</p>")).toEqual({ code: null, service: null })
    expect(readSandboxError(500, json, "not json")).toEqual({ code: null, service: null })
  })
})

describe("describing a failure", () => {
  it("picks the call that explains it: blocked, timed out or unreachable first, then an error status", () => {
    const ok = { host: "ok.example.com", status: 200, ms: 1 }
    const unauthorized = { host: "api.apify.com", status: 401, ms: 1 }
    const blocked = { host: "api.apify-storage.com", error: "blocked" as const, ms: 0 }
    expect(failingFetch(null)).toBeNull()
    expect(failingFetch({ ms: 1, fetches: [ok] })).toBeNull()
    expect(failingFetch({ ms: 1, fetches: [ok, unauthorized] })).toBe(unauthorized)
    expect(failingFetch({ ms: 1, fetches: [unauthorized, blocked] })).toBe(blocked)
  })

  it("names the words to use", () => {
    expect(describeFetch({ host: "api.apify.com", status: 401, ms: 1 })).toEqual({ key: "status", host: "api.apify.com", status: 401 })
    expect(describeFetch({ host: "a.com", error: "timeout", ms: 1 })).toEqual({ key: "timeout", host: "a.com" })
  })
})

describe("serverCallResult", () => {
  it("says ok, the error code, or a bare failure", () => {
    expect(serverCallResult({ status: 200, errorCode: null })).toBe("ok")
    expect(serverCallResult({ status: 302, errorCode: null })).toBe("ok")
    expect(serverCallResult({ status: 502, errorCode: "not_connected" })).toBe("not_connected")
    expect(serverCallResult({ status: 500, errorCode: null })).toBe("failed")
  })
})
