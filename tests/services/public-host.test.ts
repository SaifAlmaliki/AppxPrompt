import { describe, expect, it } from "vitest"
import { isPublicIp, resolvesToPublicAddress } from "@/lib/services/public-host"

describe("isPublicIp", () => {
  it.each(["8.8.8.8", "1.1.1.1", "142.250.80.46", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450:4001:81b::200e"])(
    "accepts %s",
    (ip) => expect(isPublicIp(ip)).toBe(true),
  )

  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "127.0.0.1",
    "127.1.2.3",
    "169.254.169.254",
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "100.127.255.255",
    "192.0.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ])("refuses the IPv4 address %s", (ip) => expect(isPublicIp(ip)).toBe(false))

  it.each([
    "::",
    "::1",
    "fe80::1",
    "febf::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a00:1",
    "fd00:ec2::254",
  ])("refuses the IPv6 address %s", (ip) => expect(isPublicIp(ip)).toBe(false))

  it("accepts an IPv4-mapped public address", () => {
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true)
  })

  it("refuses text that isn't an address", () => {
    expect(isPublicIp("example.com")).toBe(false)
    expect(isPublicIp("")).toBe(false)
    expect(isPublicIp("999.1.1.1")).toBe(false)
    expect(isPublicIp("1.2.3")).toBe(false)
  })
})

describe("resolvesToPublicAddress", () => {
  const answer = (...addresses: string[]) => async () => addresses.map((address) => ({ address }))

  it("accepts a name whose addresses are all public", async () => {
    expect(await resolvesToPublicAddress("api.example.com", answer("8.8.8.8", "2606:4700:4700::1111"))).toBe(true)
  })
  it("refuses a name when any address is internal", async () => {
    expect(await resolvesToPublicAddress("api.example.com", answer("8.8.8.8", "10.0.0.5"))).toBe(false)
    expect(await resolvesToPublicAddress("api.example.com", answer("169.254.169.254"))).toBe(false)
  })
  it("refuses a name with no addresses or a failed lookup", async () => {
    expect(await resolvesToPublicAddress("api.example.com", answer())).toBe(false)
    expect(
      await resolvesToPublicAddress("api.example.com", async () => {
        throw new Error("ENOTFOUND")
      }),
    ).toBe(false)
  })
  it("checks a literal address without a lookup", async () => {
    const lookup = async () => {
      throw new Error("should not be called")
    }
    expect(await resolvesToPublicAddress("8.8.8.8", lookup)).toBe(true)
    expect(await resolvesToPublicAddress("127.0.0.1", lookup)).toBe(false)
    expect(await resolvesToPublicAddress("[::1]", lookup)).toBe(false)
  })
})
