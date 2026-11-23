import { describe, expect, it } from "vitest"
import {
  API_ROUTE_FILE,
  BACKEND_SERVICE,
  RESERVED_HELPER_FILE,
  SERVER_HELPER_FILE,
  SERVER_ROUTE_ID,
  SERVER_ROUTE_KINDS,
  SYSTEM_SERVER_FILES,
  apiRouteUrl,
  isServerFile,
  toProjectServerRoute,
} from "@/lib/agent-protocol"

describe("apiRouteUrl", () => {
  it("turns a route file into its URL", () => {
    expect(apiRouteUrl("app/api/booking/slots+api.ts")).toBe("/api/booking/slots")
    expect(apiRouteUrl("app/api/booking/index+api.ts")).toBe("/api/booking")
    expect(apiRouteUrl("app/api/booking/[id]+api.ts")).toBe("/api/booking/[id]")
  })
})

describe("API_ROUTE_FILE", () => {
  it("accepts route files", () => {
    expect(API_ROUTE_FILE.test("app/api/booking/slots+api.ts")).toBe(true)
    expect(API_ROUTE_FILE.test("app/api/booking/[id]+api.ts")).toBe(true)
  })

  it("rejects everything else", () => {
    for (const path of [
      "app/api/../x+api.ts",
      "app/booking+api.ts",
      "app/api/Booking+api.ts",
      "app/api/x.ts",
      "app/api/[...rest]+api.ts",
      "app/api/(group)/x+api.ts",
    ]) {
      expect(API_ROUTE_FILE.test(path), path).toBe(false)
    }
  })
})

describe("SERVER_HELPER_FILE", () => {
  it("accepts helpers", () => {
    for (const path of ["server/google.ts", "server/agents/booking.ts", "server/agents/assistant.instructions.ts"]) {
      expect(SERVER_HELPER_FILE.test(path), path).toBe(true)
    }
  })

  it("rejects everything else", () => {
    for (const path of ["server/../x.ts", "server/Google.ts", "server/a.b.ts", "lib/server/index.ts"]) {
      expect(SERVER_HELPER_FILE.test(path), path).toBe(false)
    }
  })
})

describe("RESERVED_HELPER_FILE", () => {
  it("matches the files phase 4 writes", () => {
    expect(RESERVED_HELPER_FILE.test("server/agent-loop.ts")).toBe(true)
    expect(RESERVED_HELPER_FILE.test("server/agents/assistant.instructions.ts")).toBe(true)
    expect(RESERVED_HELPER_FILE.test("server/google.ts")).toBe(false)
  })
})

describe("isServerFile", () => {
  it("tells server files from the rest", () => {
    expect(isServerFile("app/api/x+api.ts")).toBe(true)
    expect(isServerFile("server/google.ts")).toBe(true)
    expect(isServerFile("lib/server/index.ts")).toBe(false)
    expect(isServerFile("lib/server/config.ts")).toBe(false)
    expect(isServerFile("app/index.tsx")).toBe(false)
  })
})

describe("server route constants", () => {
  it("has the ids, kinds and system files", () => {
    expect(SERVER_ROUTE_ID.test("booking-slots")).toBe(true)
    expect(SERVER_ROUTE_ID.test("Booking")).toBe(false)
    expect(SERVER_ROUTE_ID.test("a".repeat(41))).toBe(false)
    expect(SERVER_ROUTE_KINDS).toEqual(["function", "agent", "helper"])
    expect(SYSTEM_SERVER_FILES).toContain("server/auth.ts")
    expect(BACKEND_SERVICE).toBe("backend")
  })

  it("copies a route row", () => {
    const route = { path: "app/api/x+api.ts", kind: "function" as const, purpose: "p", status: "done" as const, code: null }
    const row = { ...route, projectId: "p1", createdAt: new Date(), updatedAt: new Date() }
    expect(toProjectServerRoute(row)).toEqual(route)
  })
})
