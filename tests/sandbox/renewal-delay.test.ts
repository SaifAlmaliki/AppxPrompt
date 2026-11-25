import { describe, expect, it } from "vitest"

import { renewalDelay } from "@/hooks/use-sandbox-token"

describe("renewalDelay", () => {
  it("renews 5 minutes before the token expires", () => {
    expect(renewalDelay(1_000_000, 1_000_000_000 - 3_600_000)).toBe(3_600_000 - 300_000)
  })

  it("renews right away when less than 5 minutes are left, or it has expired", () => {
    expect(renewalDelay(1_000_000, 1_000_000_000 - 60_000)).toBe(0)
    expect(renewalDelay(1_000_000, 2_000_000_000)).toBe(0)
  })
})
