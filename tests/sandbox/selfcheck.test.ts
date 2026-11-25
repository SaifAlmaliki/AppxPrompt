import { describe, expect, it } from "vitest"
import { runSelfCheck } from "@/sandbox-runtime/selfcheck"

const env = { OPENAI_API_KEY: "sk-proj-secret", APPXPROMPT_SERVER_KEY: "k", NODE_ENV: "production", PORT: "3000" }
const names = ["OPENAI_API_KEY", "APPXPROMPT_SERVER_KEY"]

describe("runSelfCheck", () => {
  it("reports egress blocked when the real fetch fails", async () => {
    const hostFetch = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch
    expect(await runSelfCheck({ hostFetch, env, secretNames: names })).toEqual({ egressBlocked: true, envKeys: 2 })
  })

  it("reports egress open when any answer comes back", async () => {
    const hostFetch = (async () => new Response("x", { status: 403 })) as typeof fetch
    expect((await runSelfCheck({ hostFetch, env, secretNames: names })).egressBlocked).toBe(false)
  })

  it("treats a hang as blocked", async () => {
    const hostFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch
    expect((await runSelfCheck({ hostFetch, env, secretNames: names, timeoutMs: 20 })).egressBlocked).toBe(true)
  })

  it("counts only the bundle's credentials that arrived, never their values", async () => {
    const hostFetch = (async () => {
      throw new Error("blocked")
    }) as typeof fetch
    const result = await runSelfCheck({ hostFetch, env: { NODE_ENV: "production", PORT: "3000" }, secretNames: names })
    expect(result).toEqual({ egressBlocked: true, envKeys: 0 })
    expect(JSON.stringify(await runSelfCheck({ hostFetch, env, secretNames: names }))).not.toContain("sk-proj")
  })
})
