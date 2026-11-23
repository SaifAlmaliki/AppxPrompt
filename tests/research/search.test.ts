import { afterEach, describe, expect, it, vi } from "vitest"
import { KEY_REMOVED } from "@/lib/services/key-patterns"
import { ResearchUnavailableError, webSearch } from "@/lib/research/search"

const key = "sk-proj-" + "a".repeat(40)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => vi.unstubAllEnvs())

describe("webSearch", () => {
  it("throws ResearchUnavailableError without a key, and makes no request", async () => {
    vi.stubEnv("TAVILY_API_KEY", "")
    const fetchImpl = vi.fn()
    await expect(webSearch("openai api", fetchImpl)).rejects.toBeInstanceOf(ResearchUnavailableError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts a basic search to Tavily with the bearer key", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test")
    const fetchImpl = vi.fn(async () => json({ results: [] }))
    await webSearch("  google calendar api freebusy  ", fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.tavily.com/search")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-test")
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "google calendar api freebusy", search_depth: "basic", max_results: 5, include_answer: false })
    expect(init.signal).toBeDefined()
  })

  it("cuts long queries to 400 characters", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test")
    const fetchImpl = vi.fn(async () => json({ results: [] }))
    await webSearch("q".repeat(1000), fetchImpl)
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).query.length).toBe(400)
  })

  it("maps, cleans, caps and redacts results, keeping only https", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test")
    const fetchImpl = vi.fn(async () => json({ results: [
      { title: "Auth\n  guide", url: "https://platform.openai.com/docs/auth", content: `Use ${key} as\n\nBearer. ` + "x".repeat(900) },
      { title: "Old", url: "http://example.com", content: "insecure" },
    ] }))
    const [first, ...rest] = await webSearch("openai auth", fetchImpl)
    expect(rest).toEqual([])
    expect(first.title).toBe("Auth guide")
    expect(first.snippet.startsWith(`Use ${KEY_REMOVED} as Bearer.`)).toBe(true)
    expect(first.snippet.length).toBeLessThanOrEqual(500)
  })

  it("gives an empty list when results is missing or not an array", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test")
    expect(await webSearch("x", vi.fn(async () => json({})))).toEqual([])
    expect(await webSearch("x", vi.fn(async () => json({ results: "nope" })))).toEqual([])
  })

  it("throws a plain error on a rejected key, without the key in it", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-secret")
    const error = await webSearch("x", vi.fn(async () => json({ detail: { error: "Unauthorized" } }, 401))).catch((e) => e)
    expect(error.message).toBe("Search failed with 401.")
    expect(error.message).not.toContain("tvly-secret")
  })
})
