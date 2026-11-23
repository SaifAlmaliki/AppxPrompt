import { describe, expect, it } from "vitest"
import { compileServerFile, matchApiRoute } from "@/lib/sandbox/routes"

const slots = "app/api/booking/slots+api.ts"
const byId = "app/api/booking/[id]+api.ts"
const today = "app/api/booking/today+api.ts"

describe("matchApiRoute", () => {
  it("matches a static route", () => {
    expect(matchApiRoute([slots], "/api/booking/slots")).toEqual({ route: slots, params: {} })
  })

  it("ignores a trailing slash, query and hash", () => {
    expect(matchApiRoute([slots], "/api/booking/slots/?x=1#a")).toEqual({ route: slots, params: {} })
    expect(matchApiRoute([slots], "/api/booking/slots?x=1/y")).toEqual({ route: slots, params: {} })
  })

  it("decodes dynamic segments", () => {
    expect(matchApiRoute([byId], "/api/booking/abc%20d")).toEqual({ route: byId, params: { id: "abc d" } })
  })

  it("prefers static over dynamic", () => {
    expect(matchApiRoute([byId, today], "/api/booking/today")?.route).toBe(today)
    expect(matchApiRoute([today, byId], "/api/booking/today")?.route).toBe(today)
    expect(matchApiRoute([today, byId], "/api/booking/other")?.route).toBe(byId)
  })

  it("breaks ties by the first static segment from the left", () => {
    const a = "app/api/[a]/fixed+api.ts"
    const b = "app/api/fixed/[b]+api.ts"
    expect(matchApiRoute([a, b], "/api/fixed/fixed")?.route).toBe(b)
    expect(matchApiRoute([b, a], "/api/fixed/fixed")?.route).toBe(b)
  })

  it("matches an index route on its folder", () => {
    expect(matchApiRoute(["app/api/booking/index+api.ts"], "/api/booking")?.route).toBe("app/api/booking/index+api.ts")
  })

  it("returns null for anything else", () => {
    expect(matchApiRoute([slots], "/api/booking")).toBeNull()
    expect(matchApiRoute([slots], "/api/booking/slots/extra")).toBeNull()
    expect(matchApiRoute([slots], "/api/booking/../slots")).toBeNull()
    expect(matchApiRoute([slots], "/api/booking/./slots")).toBeNull()
    expect(matchApiRoute([slots], "/api//booking/slots")).toBeNull()
    expect(matchApiRoute([slots], "/api/booking/%E0%A4%A")).toBeNull()
    expect(matchApiRoute([byId], "/api/booking/%2e%2e")).toBeNull()
    expect(matchApiRoute([byId], "/api/booking/a%2Fb")).toBeNull()
    expect(matchApiRoute([byId], "/api/booking/a%5Cb")).toBeNull()
    expect(matchApiRoute([slots], "api/booking/slots")).toBeNull()
    expect(matchApiRoute([slots], "/")).toBeNull()
    expect(matchApiRoute([], "/api/booking/slots")).toBeNull()
  })
})

describe("compileServerFile", () => {
  it("compiles TypeScript modules to CommonJS", () => {
    const out = compileServerFile("app/api/x+api.ts", "export async function POST(r: Request) { return new Response('ok') }")
    expect(out).toContain("exports.POST")
    expect(out).not.toContain(": Request")
  })

  it("throws on a syntax error", () => {
    expect(() => compileServerFile("app/api/x+api.ts", "export async function (")).toThrow()
  })
})
