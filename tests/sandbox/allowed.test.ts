import { describe, expect, it } from "vitest"
import { sandboxAllowedFor } from "@/lib/sandbox/allowed"
import { createSandboxToken, sandboxTokenUserId } from "@/lib/sandbox/token"

describe("sandboxAllowedFor", () => {
  it.each([undefined, "", "   "])("allows everyone when the list is %j", (value) => {
    expect(sandboxAllowedFor(7, { SANDBOX_ALLOWED_USERS: value })).toBe(true)
  })

  it("allows only listed ids, whitespace tolerated", () => {
    const env = { SANDBOX_ALLOWED_USERS: " 3 ,7,  12 " }
    expect(sandboxAllowedFor(7, env)).toBe(true)
    expect(sandboxAllowedFor(12, env)).toBe(true)
    expect(sandboxAllowedFor(1, env)).toBe(false)
    expect(sandboxAllowedFor(70, env)).toBe(false)
  })

  it("allows nobody when the list holds no valid id", () => {
    expect(sandboxAllowedFor(7, { SANDBOX_ALLOWED_USERS: "seven,," })).toBe(false)
  })
})

describe("sandboxTokenUserId", () => {
  it("reads the user a token was issued to", () => {
    process.env.CLOUDHIKE_ENCRYPTION_KEY ||= "test-key"
    expect(sandboxTokenUserId(createSandboxToken("p1", 42))).toBe(42)
    expect(sandboxTokenUserId("garbage")).toBeNull()
  })
})
