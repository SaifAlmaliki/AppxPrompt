import { beforeEach, describe, expect, it, vi } from "vitest"

import type { FrameMessage } from "@/lib/preview-protocol"
import { previewServerConfig, setSandboxToken, setServerInteractive, watchServerResponses } from "@/preview-runtime/server"

const file = { SERVER_BASE_URL: "https://x", SERVER_TOKEN: "" }

describe("previewServerConfig", () => {
  beforeEach(() => {
    setServerInteractive(false)
    setSandboxToken("")
  })

  it("gives a non-interactive frame an empty token, so callServer never sends a request", () => {
    setSandboxToken("t1")
    expect(previewServerConfig(file).SERVER_TOKEN).toBe("")
    expect(previewServerConfig({ ...file, SERVER_TOKEN: "baked" }).SERVER_TOKEN).toBe("")
  })

  it("follows the current token on the same object, so renewing it rebuilds nothing", () => {
    const config = previewServerConfig(file)
    setServerInteractive(true)
    setSandboxToken("t1")
    expect(config.SERVER_TOKEN).toBe("t1")
    setSandboxToken("t2")
    expect(config.SERVER_TOKEN).toBe("t2")
    setSandboxToken("")
    expect(config.SERVER_TOKEN).toBe("")
    expect(previewServerConfig({ ...file, SERVER_TOKEN: "baked" }).SERVER_TOKEN).toBe("baked")
  })

  it("exposes exactly the two exports, with the file's base URL", () => {
    const config = previewServerConfig(file)
    expect(Object.keys(config)).toEqual(["SERVER_BASE_URL", "SERVER_TOKEN"])
    expect(config.SERVER_BASE_URL).toBe("https://x")
  })

  it("is not writable", () => {
    const config = previewServerConfig(file) as { SERVER_TOKEN: string | null }
    expect(() => {
      config.SERVER_TOKEN = "x"
    }).toThrow()
  })
})

describe("watchServerResponses", () => {
  const notConnected = () =>
    new Response(JSON.stringify({ error: { code: "not_connected", message: "m", service: "google-calendar" } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })

  function setup(response: () => Response = notConnected) {
    const post = vi.fn<(message: FrameMessage) => void>()
    const inner = vi.fn(async () => response()) as unknown as typeof fetch
    return { post, fetch: watchServerResponses(inner, () => "https://x", post) }
  }

  beforeEach(() => setServerInteractive(true))

  it("tells the workspace which service is needed, and leaves the body readable", async () => {
    const { post, fetch } = setup()
    const response = await fetch("https://x/api/b", { method: "POST" })
    expect(response.status).toBe(503)
    expect((await response.json()).error.service).toBe("google-calendar")
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ type: "service-needed", slug: "google-calendar" }))
    expect(post).toHaveBeenCalledTimes(1)
  })

  it("stays quiet in a frame that isn't interactive", async () => {
    setServerInteractive(false)
    const { post, fetch } = setup()
    await (await fetch("https://x/api/b")).text()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(post).not.toHaveBeenCalled()
  })

  it("ignores answers from other URLs", async () => {
    const { post, fetch } = setup()
    await (await fetch("https://other.example/api/b")).text()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(post).not.toHaveBeenCalled()
  })

  it("ignores other errors and malformed bodies", async () => {
    for (const make of [
      () => new Response(JSON.stringify({ error: { code: "bad_request", service: "x" } }), { status: 503 }),
      () => new Response(JSON.stringify({ error: { code: "not_connected", service: "x" } }), { status: 400 }),
      () => new Response(JSON.stringify({ error: { code: "not_connected" } }), { status: 503 }),
      () => new Response("not json", { status: 503 }),
    ]) {
      const { post, fetch } = setup(make)
      await (await fetch("https://x/api/b")).text()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(post).not.toHaveBeenCalled()
    }
  })

  it("accepts a URL object and a Request as input", async () => {
    const { post, fetch } = setup()
    await fetch(new URL("https://x/api/b"))
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  })

  it("does nothing when there's no server base URL", async () => {
    const post = vi.fn()
    const wrapped = watchServerResponses((async () => notConnected()) as unknown as typeof fetch, () => null, post)
    await (await wrapped("https://x/api/b")).text()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(post).not.toHaveBeenCalled()
  })

  it("passes through a failing fetch", async () => {
    const wrapped = watchServerResponses((async () => {
      throw new TypeError("down")
    }) as unknown as typeof fetch, () => "https://x", vi.fn())
    await expect(wrapped("https://x/api/b")).rejects.toThrow("down")
  })
})
