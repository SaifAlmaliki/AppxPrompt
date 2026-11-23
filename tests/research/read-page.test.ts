import { beforeEach, describe, expect, it, vi } from "vitest"
import { KEY_REMOVED } from "@/lib/services/key-patterns"

vi.mock("@/lib/research/safe-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research/safe-fetch")>()),
  fetchPublic: vi.fn(),
}))
const { fetchPublic } = await import("@/lib/research/safe-fetch")
const { MAX_PAGE_CHARS, htmlToText, pageCacheKey, pageExcerpt, readPage } = await import("@/lib/research/read-page")

const DOC = `<html><head><title>Auth &amp; keys</title><style>x{}</style></head><body><nav>Menu</nav><main>
<h1>Authentication</h1><p>Send <code>Authorization: Bearer KEY</code>.</p><ul><li>One</li><li>Two</li></ul>
<pre>curl https://api.x.com/v1
  -H "a: b"</pre><script>alert(1)</script><a href="/openapi.json">Spec</a><a href="/pricing">Pricing</a></main><footer>©</footer></body></html>`

const page = (body: string, contentType = "text/html", url = "https://x.com/docs", truncated = false) => ({
  url,
  contentType,
  body: Buffer.from(body),
  truncated,
})
const notFound = { error: "Not read: the page answered 404." }

beforeEach(() => {
  vi.mocked(fetchPublic).mockReset()
})

describe("htmlToText", () => {
  it("keeps the structure of a docs page and drops the chrome", () => {
    const { title, text, links } = htmlToText(DOC, "https://x.com/docs")
    expect(title).toBe("Auth & keys")
    expect(text).toContain("# Authentication")
    expect(text).toContain("Send `Authorization: Bearer KEY`.")
    expect(text).toContain("- One\n- Two")
    expect(text).toContain('```\ncurl https://api.x.com/v1\n  -H "a: b"\n```')
    for (const gone of ["Menu", "alert", "x{}", "©"]) expect(text).not.toContain(gone)
    expect(links).toEqual(["https://x.com/openapi.json"])
  })
  it("decodes entities", () =>
    expect(htmlToText("<p>&lt;id&gt; &#39;x&#39; &#x2014;&nbsp;y</p>", "https://x.com").text).toBe("<id> 'x' — y"))
  it("does not decode twice or treat decoded text as tags", () =>
    expect(htmlToText("<p>&lt;script&gt;&amp;lt;</p>", "https://x.com").text).toBe("<script>&lt;"))
  it("reads the body when there's no main or article", () =>
    expect(htmlToText("<html><head><title>T</title></head><body><p>Hi</p></body></html>", "https://x.com").text).toBe("Hi"))
  it("prefers main over article, and article over body", () => {
    expect(htmlToText("<body>Out<article>Art<main>Main</main></article></body>", "https://x.com").text).toBe("Main")
    expect(htmlToText("<body>Out<article>Art</article></body>", "https://x.com").text).toBe("Art")
  })
  it("falls back to the first h1 for the title", () =>
    expect(htmlToText("<body><h1>The <em>Guide</em></h1><p>x</p></body>", "https://x.com").title).toBe("The Guide"))
  it("drops comments, nested chrome and unclosed scripts", () => {
    const html = "<body><!-- <main>no</main> --><nav><nav>a</nav>b</nav><form><input>f</form><aside>s</aside><p>Keep</p><script>if (a<b) {"
    expect(htmlToText(html, "https://x.com").text).toBe("Keep")
  })
  it("keeps main even when a form wraps it", () =>
    expect(htmlToText("<body><form><main><p>Docs</p></main></form></body>", "https://x.com").text).toBe("Docs"))
  it("renders tables and line breaks", () => {
    const { text } = htmlToText("<main><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>x<br>y</main>", "https://x.com")
    expect(text).toBe("| A | B\n| 1 | 2\nx\ny")
  })
  it("joins a key split by tags before anything is redacted downstream", () => {
    expect(htmlToText("<p>sk-<b>proj</b>-abc</p>", "https://x.com").text).toBe("sk-proj-abc")
  })
  it("collects at most 5 https spec links, resolved and deduplicated", () => {
    const anchors = ["/llms.txt", "/llms-full.txt", "/swagger.json", "/api-docs", "/a.yml", "/b.yaml", "/openapi.json"]
    const html = `<main>${[...anchors, "/llms.txt", "http://x.com/openapi.json"].map((href) => `<a href="${href}">l</a>`).join("")}</main>`
    const { links } = htmlToText(html, "https://x.com/docs/")
    expect(links).toEqual(["/llms.txt", "/llms-full.txt", "/swagger.json", "/api-docs", "/a.yml"].map((p) => `https://x.com${p}`))
  })
})

describe("htmlToText on hostile input", () => {
  const hostile: Record<string, string> = {
    "unclosed anchors": "<a ".repeat(100_000),
    "unclosed quotes": '<a "'.repeat(100_000),
    "unclosed main": "<main ".repeat(100_000),
    "unclosed title": "<title>".repeat(100_000),
    "unclosed nav": "<nav>".repeat(100_000),
    "unclosed pre": "<pre>".repeat(100_000),
    "unclosed comments": "<!--".repeat(100_000),
    "declarations": "<!".repeat(40_000),
    "instructions": "<?".repeat(40_000),
    "one long tag name": "<" + "a".repeat(40_000),
    "one long attribute list": "<a " + "x=y ".repeat(40_000),
    "blank space then text in pre": "<pre>" + " ".repeat(100_000) + "x</pre>",
    "blank space then text": " ".repeat(100_000) + "x",
    "unclosed hrefs": "<a href=".repeat(50_000),
    "unclosed entities": "&#".repeat(100_000) + "&#" + "1".repeat(100_000),
    "unclosed br": "<br" + " ".repeat(100_000),
    "unclosed pre end": "</pre ".repeat(50_000),
  }
  for (const [name, html] of Object.entries(hostile)) {
    it(`stays fast on ${name}`, () => {
      const start = performance.now()
      htmlToText(html, "https://x.com")
      expect(performance.now() - start).toBeLessThan(200)
    })
  }
})

describe("pageExcerpt", () => {
  it("returns short text whole", () => expect(pageExcerpt("short", null)).toBe("short"))
  it("cuts long text and says how much is left", () => {
    const out = pageExcerpt("a".repeat(MAX_PAGE_CHARS + 10_000), null)
    expect(out.startsWith("a".repeat(MAX_PAGE_CHARS))).toBe(true)
    expect(out).toContain("[The page goes on for 10000 more characters.")
  })
  it("jumps to a match deep in a long file", () => {
    const text = "x".repeat(80_000) + " refresh_token rotates " + "y".repeat(20_000)
    const out = pageExcerpt(text, "Refresh_Token")
    expect(out.startsWith('[Parts of the page containing "Refresh_Token", 1 matches]')).toBe(true)
    expect(out).toContain("refresh_token rotates")
    expect(out.length).toBeLessThanOrEqual(MAX_PAGE_CHARS + 200)
  })
  it("merges overlapping windows and separates distant ones", () => {
    const near = "a".repeat(500) + "needle" + "b".repeat(500) + "needle" + "c".repeat(500)
    expect(pageExcerpt(near, "needle")).toContain("2 matches]\n\n" + near)
    const far = "needle" + "x".repeat(10_000) + "needle"
    expect(pageExcerpt(far, "needle")).toContain("\n\n…\n\n")
  })
  it("stops at the cap", () => {
    const text = Array.from({ length: 20 }, () => "needle" + "x".repeat(5000)).join("")
    const out = pageExcerpt(text, "needle", 4000)
    expect(out.length).toBeLessThanOrEqual(4000 + 100)
  })
  it("falls back to the start when nothing matches", () =>
    expect(pageExcerpt("abc", "zzz")).toBe('[No match for "zzz". The start of the page follows.]\n\nabc'))
  it("takes a find with regex characters literally", () => expect(pageExcerpt("a (b) c", "(b)")).toContain("a (b) c"))
  it("does not echo a key given as find", () => {
    const key = "sk-proj-" + "b".repeat(40)
    expect(pageExcerpt("abc", key)).not.toContain(key)
  })
})

describe("pageCacheKey", () => {
  it("drops the hash, and keeps what doesn't parse", () => {
    expect(pageCacheKey("https://x.com/a?b=1#c")).toBe("https://x.com/a?b=1")
    expect(pageCacheKey("not a url#x")).toBe("not a url#x")
  })
})

describe("readPage", () => {
  it("returns redacted text and title, with spec links", async () => {
    const key = "sk-proj-" + "b".repeat(40)
    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt")
        ? notFound
        : page(`<title>Keys ${key}</title><main><p>Example: ${key}</p><a href="/openapi.yaml">x</a><a href="/openapi.json?k=${key}">y</a></main>`),
    )
    const result = await readPage("https://x.com/docs")
    expect(result).toMatchObject({ url: "https://x.com/docs", title: `Keys ${KEY_REMOVED}`, docLinks: ["https://x.com/openapi.yaml"] })
    expect("text" in result && result.text).toContain(`Example: ${KEY_REMOVED}`)
    expect(JSON.stringify(result)).not.toContain(key)
  })
  it("adds a real llms.txt, ignores an HTML soft-404, and probes each origin once per cache", async () => {
    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt") ? page("# X\n> docs", "text/plain; charset=utf-8", url) : page("<main>Hi</main>", "text/html", url),
    )
    const cache = new Map()
    const a = await readPage("https://x.com/a", { cache })
    const b = await readPage("https://x.com/b", { cache })
    expect(a).toMatchObject({ docLinks: ["https://x.com/llms.txt"] })
    expect(b).toMatchObject({ docLinks: ["https://x.com/llms.txt"] })
    expect(vi.mocked(fetchPublic).mock.calls.filter(([url]) => url === "https://x.com/llms.txt")).toHaveLength(1)

    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt") ? page("<html># not docs</html>", "text/html", url) : page("<main>Hi</main>", "text/html", url),
    )
    expect(await readPage("https://y.com/a")).toMatchObject({ docLinks: [] })
  })
  it("fetches a page once per cache, whatever find is", async () => {
    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt") ? notFound : page("<main>token here</main>", "text/html", url),
    )
    const cache = new Map()
    const u = "https://x.com/docs"
    const [first, second] = await Promise.all([readPage(u, { cache }), readPage(u + "#auth", { cache, find: "token" })])
    expect(vi.mocked(fetchPublic).mock.calls.filter(([url]) => url === u)).toHaveLength(1)
    expect(first).toMatchObject({ text: "token here" })
    expect(second).toMatchObject({ text: expect.stringContaining('[Parts of the page containing "token", 1 matches]') })
  })
  it("does not probe llms.txt when reading llms.txt itself", async () => {
    vi.mocked(fetchPublic).mockResolvedValue(page("# X\n> docs", "text/markdown", "https://x.com/llms.txt"))
    expect(await readPage("https://x.com/llms.txt")).toMatchObject({ title: "llms.txt", text: "# X\n> docs", docLinks: [] })
    expect(fetchPublic).toHaveBeenCalledTimes(1)
  })
  it("pretty-prints JSON specs", async () => {
    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt") ? notFound : page('{"openapi":"3.1.0","paths":{}}', "application/json", url),
    )
    const result = await readPage("https://x.com/openapi.json")
    expect("text" in result && result.text).toContain('"openapi": "3.1.0"')
    expect(result).toMatchObject({ title: "openapi.json" })
  })
  it("keeps YAML as it is and redacts keys in it", async () => {
    const key = "sk-proj-" + "b".repeat(40)
    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt") ? notFound : page(`key: ${key}\nopenapi: 3.1.0`, "application/x-yaml", url),
    )
    const result = await readPage("https://x.com/spec.yaml")
    expect("text" in result && result.text).toBe(`key: ${KEY_REMOVED}\nopenapi: 3.1.0`)
  })
  it("treats a body without a content type by its first character", async () => {
    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt") ? notFound : url.endsWith("/h") ? page("<main>html</main>", "", url) : page("plain", "", url),
    )
    expect(await readPage("https://x.com/h")).toMatchObject({ text: "html" })
    expect(await readPage("https://x.com/p")).toMatchObject({ text: "plain" })
  })
  it("says when a file was cut", async () => {
    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt") ? notFound : page("abc", "text/plain", url, true),
    )
    const result = await readPage("https://x.com/big.txt")
    expect("text" in result && result.text).toBe("abc\n\n[The file was cut at 4 MB.]")
  })
  it("passes fetch errors through", async () => {
    vi.mocked(fetchPublic).mockResolvedValue(notFound)
    expect(await readPage("https://x.com/gone")).toEqual(notFound)
  })
  it("never throws", async () => {
    vi.mocked(fetchPublic).mockRejectedValue(new Error("boom"))
    expect(await readPage("https://x.com/a")).toEqual({ error: "Not read: the page couldn't be read." })
  })
  it("refuses non-text pages and empty pages", async () => {
    vi.mocked(fetchPublic).mockImplementation(async (url) =>
      url.endsWith("/llms.txt") ? notFound : url.endsWith("/pdf") ? page("%PDF", "application/pdf", url) : page("<html><body><script>app()</script></body></html>", "text/html", url),
    )
    expect(await readPage("https://x.com/pdf")).toEqual({ error: "Not read: this isn't a text page (application/pdf)." })
    expect(await readPage("https://x.com/spa")).toEqual({
      error: "The page had no readable text. It may need JavaScript, so try the site's llms.txt, its API reference, or another page.",
    })
  })
  it("refuses a non-public url without fetching", async () => {
    expect(await readPage("http://x.com/")).toEqual({ error: "Not read: only public https pages can be read." })
    expect(fetchPublic).not.toHaveBeenCalled()
  })
})
