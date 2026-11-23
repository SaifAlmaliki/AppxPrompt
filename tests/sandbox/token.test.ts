import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSandboxToken, sandboxInternalSecret, sandboxTokenExpiry, verifySandboxToken } from "@/lib/sandbox/token"

beforeEach(() => {
  vi.stubEnv("CLOUDHIKE_ENCRYPTION_KEY", "test-key")
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("sandbox token", () => {
  it("verifies for its own project only", () => {
    const token = createSandboxToken("p1", 7)
    expect(verifySandboxToken(token, "p1")).toBe(true)
    expect(verifySandboxToken(token, "p2")).toBe(false)
  })

  it("expires after its lifetime", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const token = createSandboxToken("p1", 7)
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + 3599_000)
    expect(verifySandboxToken(token, "p1")).toBe(true)
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + 3601_000)
    expect(verifySandboxToken(token, "p1")).toBe(false)
  })

  it("rejects a tampered signature or user", () => {
    const token = createSandboxToken("p1", 7)
    const last = token.slice(-1)
    expect(verifySandboxToken(token.slice(0, -1) + (last === "A" ? "B" : "A"), "p1")).toBe(false)
    const parts = token.split(".")
    parts[1] = "8"
    expect(verifySandboxToken(parts.join("."), "p1")).toBe(false)
  })

  it("never throws on malformed tokens", () => {
    for (const bad of ["", "a.b", "a.b.c.d.e", "p1.7.notanumber.x", "p1.7.99999999999.x"]) {
      expect(verifySandboxToken(bad, "p1")).toBe(false)
    }
  })

  it("does not verify under another key", () => {
    const token = createSandboxToken("p1", 7)
    vi.stubEnv("CLOUDHIKE_ENCRYPTION_KEY", "other-key")
    expect(verifySandboxToken(token, "p1")).toBe(false)
  })

  it("needs the key to create, and fails verification without it", () => {
    const token = createSandboxToken("p1", 7)
    vi.stubEnv("CLOUDHIKE_ENCRYPTION_KEY", "")
    expect(() => createSandboxToken("p1", 7)).toThrow()
    expect(verifySandboxToken(token, "p1")).toBe(false)
  })

  it("reports the expiry in epoch seconds", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const token = createSandboxToken("p1", 7)
    expect(sandboxTokenExpiry(token)).toBe(Date.parse("2026-01-01T00:00:00Z") / 1000 + 3600)
    expect(sandboxTokenExpiry("x")).toBeNull()
  })
})

describe("sandboxInternalSecret", () => {
  it("is stable, per project and long enough", () => {
    expect(sandboxInternalSecret("p1")).toBe(sandboxInternalSecret("p1"))
    expect(sandboxInternalSecret("p1")).not.toBe(sandboxInternalSecret("p2"))
    expect(sandboxInternalSecret("p1").length).toBeGreaterThanOrEqual(40)
  })
})
