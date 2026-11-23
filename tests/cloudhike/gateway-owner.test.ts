import { describe, expect, it, vi } from "vitest"

import { APP_SERVER_OWNER, SERVER_KEY_HEADER, SERVER_MODE_HEADER, resolveRequestOwner } from "@/lib/cloudhike/gateway-owner"
import { deviceOwner, userOwner } from "@/lib/cloudhike/gateway"

vi.mock("@/db", () => ({ db: {}, projectBackends: {}, projects: {} }))

const DEVICE = "a".repeat(64)
const tokenOwner = userOwner({ id: "u1", email: "a@b.c" })

function deps(valid = true) {
  return {
    verifyServerKey: vi.fn(async () => valid),
    fromToken: vi.fn(async () => tokenOwner),
  }
}

describe("resolveRequestOwner", () => {
  it("sends a bearer token without a key to fromToken", async () => {
    const d = deps()
    const result = await resolveRequestOwner(new Headers({ authorization: "Bearer t" }), d)
    expect(d.fromToken).toHaveBeenCalledWith("t")
    expect(d.verifyServerKey).not.toHaveBeenCalled()
    expect(result).toEqual({ owner: tokenOwner, server: false })
  })

  it("uses a valid device id without a key", async () => {
    const result = await resolveRequestOwner(new Headers({ "x-device-id": DEVICE }), deps())
    expect(result).toEqual({ owner: deviceOwner(DEVICE), server: false })
  })

  it("finds nobody without a key or caller headers", async () => {
    expect(await resolveRequestOwner(new Headers({ "x-device-id": "short" }), deps())).toEqual({ owner: null, server: false })
  })

  it("rejects a key that doesn't verify, without looking at the token", async () => {
    const d = deps(false)
    const result = await resolveRequestOwner(new Headers({ [SERVER_KEY_HEADER]: "nope", authorization: "Bearer t" }), d)
    expect(result).toBe("bad-key")
    expect(d.verifyServerKey).toHaveBeenCalledWith("nope")
    expect(d.fromToken).not.toHaveBeenCalled()
  })

  it("acts as the app with a valid key, whatever else is sent", async () => {
    const d = deps()
    const result = await resolveRequestOwner(
      new Headers({ [SERVER_KEY_HEADER]: "k", [SERVER_MODE_HEADER]: "app", authorization: "Bearer t" }),
      d,
    )
    expect(result).toEqual({ owner: APP_SERVER_OWNER, server: true })
    expect(APP_SERVER_OWNER).toEqual({ id: "app:server", email: null, signedIn: false, all: true })
    expect(d.fromToken).not.toHaveBeenCalled()
  })

  it("acts as the caller with a valid key", async () => {
    const result = await resolveRequestOwner(
      new Headers({ [SERVER_KEY_HEADER]: "k", [SERVER_MODE_HEADER]: "caller", authorization: "Bearer t" }),
      deps(),
    )
    expect(result).toEqual({ owner: tokenOwner, server: true })
  })

  it("gives no owner for a valid key with no caller headers", async () => {
    expect(await resolveRequestOwner(new Headers({ [SERVER_KEY_HEADER]: "k" }), deps())).toEqual({ owner: null, server: true })
  })

  it("treats an unknown mode as the caller", async () => {
    const result = await resolveRequestOwner(
      new Headers({ [SERVER_KEY_HEADER]: "k", [SERVER_MODE_HEADER]: "admin", "x-device-id": DEVICE }),
      deps(),
    )
    expect(result).toEqual({ owner: deviceOwner(DEVICE), server: true })
  })
})
