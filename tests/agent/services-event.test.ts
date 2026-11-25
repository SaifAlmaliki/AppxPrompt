import { afterEach, describe, expect, it, vi } from "vitest"

import { emitServices } from "@/lib/agent/services-event"

afterEach(() => vi.restoreAllMocks())

describe("emitServices", () => {
  it("emits the services", async () => {
    const emit = vi.fn()
    await emitServices(emit, async () => [])
    expect(emit).toHaveBeenCalledWith({ type: "services", services: [] })
  })

  it("never throws, and logs only the error name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const emit = vi.fn()
    await expect(
      emitServices(emit, async () => {
        throw new TypeError("secret detail")
      }),
    ).resolves.toBeUndefined()
    expect(emit).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).toContain("TypeError")
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail")
  })
})
