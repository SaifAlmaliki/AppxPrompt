import { redactKeys } from "@/lib/services/key-patterns"

export type SearchResult = { title: string; url: string; snippet: string }

export class ResearchUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResearchUnavailableError"
  }
}

export const SEARCH_RESULTS = 5

const SEARCH_URL = "https://api.tavily.com/search"
const QUERY_LIMIT = 400
const SNIPPET_LIMIT = 500
const TIMEOUT_MS = 10_000

function clean(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
  return redactKeys(text).text
}

function isHttps(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

export async function webSearch(query: string, fetchImpl: typeof fetch = fetch): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new ResearchUnavailableError("Web search isn't configured.")

  const response = await fetchImpl(SEARCH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: query.trim().slice(0, QUERY_LIMIT),
      search_depth: "basic",
      max_results: SEARCH_RESULTS,
      chunks_per_source: 2,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Search failed with ${response.status}.`)

  const data = (await response.json()) as { results?: unknown }
  if (!Array.isArray(data?.results)) return []

  const results: SearchResult[] = []
  for (const item of data.results as Array<Record<string, unknown> | null>) {
    if (!item || !isHttps(item.url)) continue
    results.push({
      title: clean(item.title),
      url: item.url,
      snippet: clean(item.content).slice(0, SNIPPET_LIMIT),
    })
  }
  return results
}
