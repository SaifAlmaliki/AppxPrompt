import { afterEach, describe, expect, it, vi } from "vitest"
import { SandboxUnavailableError, getSandboxRunner, lazyRunner, takeSandboxRequest, type SandboxRunner } from "@/lib/sandbox/runner"

afterEach(() => vi.unstubAllEnvs())

describe("getSandboxRunner", () => {
  it("answers unavailable (disabled) when SANDBOX_PROVIDER is unset", async () => {
    vi.stubEnv("SANDBOX_PROVIDER", "")
    const error = await getSandboxRunner()
      .invoke("p", { method: "GET", path: "/api/x", headers: {}, body: null })
      .catch((e) => e)
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error.reason).toBe("disabled")
  })

  it("reload and stop do nothing when disabled", async () => {
    vi.stubEnv("SANDBOX_PROVIDER", "")
    await expect(getSandboxRunner().reload("p")).resolves.toBeUndefined()
    await expect(getSandboxRunner().stop("p")).resolves.toBeUndefined()
  })
})

describe("lazyRunner", () => {
  const call = (runner: SandboxRunner) => runner.invoke("p", { method: "GET", path: "/api/x", headers: {}, body: null })
  const ok: SandboxRunner = {
    invoke: async () => ({ status: 200, headers: {}, body: "ok" }),
    reload: async () => {},
    stop: async () => {},
  }

  it("answers unavailable when the factory fails, and tries the factory again on the next call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const factory = vi
      .fn<() => Promise<SandboxRunner>>()
      .mockRejectedValueOnce(new Error("The sandbox bundle builder is not available."))
      .mockResolvedValue(ok)
    const runner = lazyRunner(factory)

    const error = await call(runner).catch((e) => e)
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error.reason).toBe("failed")
    expect(console.warn).toHaveBeenCalledTimes(1)

    expect((await call(runner)).body).toBe("ok")
    expect(factory).toHaveBeenCalledTimes(2)
    await call(runner)
    expect(factory).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })
})

describe("takeSandboxRequest", () => {
  it("allows 60 a minute per project, then refuses, then allows again", () => {
    const t = 1_000_000
    for (let i = 0; i < 60; i++) expect(takeSandboxRequest("p", t)).toBe(true)
    expect(takeSandboxRequest("p", t)).toBe(false)
    expect(takeSandboxRequest("other", t)).toBe(true)
    expect(takeSandboxRequest("p", t + 60_001)).toBe(true)
  })
})
