import { describe, expect, it, vi } from "vitest"

import { hashServerKey, newServerKey, serverKeyMatches } from "@/lib/services/server-key"

vi.mock("@/db", () => ({ db: {}, projectCredentials: {}, projectServices: {} }))

describe("server key", () => {
  it("makes 32 random bytes as base64url", () => {
    const a = newServerKey()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newServerKey()).not.toBe(a)
  })

  it("hashes to sha256:<hex>", () => {
    expect(hashServerKey("k")).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it("matches only the key it was hashed from", () => {
    const key = newServerKey()
    expect(serverKeyMatches(key, hashServerKey(key))).toBe(true)
    expect(serverKeyMatches(key + "x", hashServerKey(key))).toBe(false)
    expect(serverKeyMatches(key, "nonsense")).toBe(false)
    expect(serverKeyMatches(key, "sha256:abcd")).toBe(false)
  })
})

