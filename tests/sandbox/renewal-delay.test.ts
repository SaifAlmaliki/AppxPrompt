import { describe, expect, it } from "vitest"

import { heldToken, renewalDelay, renewalIn } from "@/hooks/use-sandbox-token"

const NOW = 1_000_000_000
const tokenExpiringIn = (ms: number, id = "x") => `p.${id}.${Math.floor((NOW + ms) / 1000)}.sig`

describe("renewalDelay", () => {
  it("renews 5 minutes before the token expires", () => {
    expect(renewalDelay(1_000_000, 1_000_000_000 - 3_600_000)).toBe(3_600_000 - 300_000)
  })

  it("renews right away when less than 5 minutes are left, or it has expired", () => {
    expect(renewalDelay(1_000_000, 1_000_000_000 - 60_000)).toBe(0)
    expect(renewalDelay(1_000_000, 2_000_000_000)).toBe(0)
  })
})

describe("heldToken", () => {
  it("adopts a newer token from the page over an older held one", () => {
    const older = tokenExpiringIn(10 * 60_000, "old")
    const newer = tokenExpiringIn(60 * 60_000, "new")
    expect(heldToken(older, newer)).toBe(newer)
  })

  it("renews from the new token's expiry, not the old one's", () => {
    const older = tokenExpiringIn(10 * 60_000, "old")
    const newer = tokenExpiringIn(60 * 60_000, "new")
    expect(renewalIn(heldToken(older, newer), NOW)).toBe(55 * 60_000)
  })

  it("keeps a renewed token that outlasts the one the page handed over", () => {
    const renewed = tokenExpiringIn(60 * 60_000, "renewed")
    const fromPage = tokenExpiringIn(20 * 60_000, "page")
    expect(heldToken(renewed, fromPage)).toBe(renewed)
  })

  it("takes the page's token when nothing is held, and replaces one that can't be read", () => {
    const fromPage = tokenExpiringIn(60 * 60_000)
    expect(heldToken(null, fromPage)).toBe(fromPage)
    expect(heldToken("garbage", fromPage)).toBe(fromPage)
  })

  it("holds nothing without a token from the page, so nothing is ever fetched", () => {
    expect(heldToken(tokenExpiringIn(60 * 60_000), null)).toBeNull()
    expect(renewalIn(heldToken(null, null), NOW)).toBeNull()
  })
})
