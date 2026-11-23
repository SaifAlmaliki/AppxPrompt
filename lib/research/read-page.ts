import { fetchPublic, isPublicHttpsUrl } from "@/lib/research/safe-fetch"
import { findKeys, redactKeys } from "@/lib/services/key-patterns"

export { isPublicHttpsUrl } from "@/lib/research/safe-fetch"

export const MAX_PAGE_CHARS = 12_000

const MAX_DOC_LINKS = 5
const BEFORE_MATCH = 1000
const AFTER_MATCH = 2000
const MAX_FIND_ECHO = 200
const WINDOW_GAP = "\n\n…\n\n"

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)(?![a-zA-Z0-9:-])(?:"[^"<]*"|'[^'<]*'|[^'"<>])*>/g
const DOC_LINK = /(llms(-full)?\.txt|openapi|swagger|api-docs|\.ya?ml)(?:$|[?#/.])/i
const RAW_TEXT = new Set(["script", "style"])
const HARD_REMOVED = new Set(["head", "script", "style", "noscript", "template", "svg", "iframe", "canvas"])
const CHROME_REMOVED = new Set(["nav", "footer", "aside", "form"])
const BLOCK_TAGS = new Set(["p", "div", "section", "table", "ul", "ol", "dl", "dt", "dd", "blockquote", "hr"])
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g, (_match, dec?: string, hex?: string, named?: string) => {
    if (named) return ENTITIES[named]
    const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? "", 16)
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ""
    return String.fromCodePoint(code)
  })
}

function stripTags(html: string): string {
  return html.replace(new RegExp(TAG.source, "g"), "")
}

function plainLine(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

function dropElements(html: string, names: Set<string>): string {
  const re = new RegExp(TAG.source, "g")
  let out = ""
  let last = 0
  let skip: string | null = null
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const closing = match[1] === "/"
    const name = match[2].toLowerCase()
    const selfClosing = match[0].endsWith("/>")
    if (skip === null) {
      if (closing || !names.has(name)) continue
      out += html.slice(last, match.index)
      last = re.lastIndex
      if (!selfClosing) {
        skip = name
        depth = 1
      }
      continue
    }
    if (skip === "head" && name === "body" && !closing) {
      skip = null
      last = match.index
      continue
    }
    if (name !== skip) continue
    if (closing) depth--
    else if (!selfClosing && !RAW_TEXT.has(name)) depth++
    if (depth <= 0) {
      skip = null
      last = re.lastIndex
    }
  }
  return skip === null ? out + html.slice(last) : out
}

function pickRegion(html: string): string {
  for (const tag of ["main", "article", "body"]) {
    const open = new RegExp(`<${tag}(?=[\\s>/])[^<>]*>`, "i").exec(html)
    if (!open) continue
    const start = open.index + open[0].length
    const close = new RegExp(`</${tag}\\s*>`, "gi")
    close.lastIndex = start
    const end = close.exec(html)
    return html.slice(start, end ? end.index : undefined)
  }
  return html
}

function preText(inner: string): string {
  const text = decodeEntities(stripTags(inner.replace(/<br\s*\/?>/gi, "\n")))
  return text.replace(/^\r?\n/, "").trimEnd()
}

function tagText(name: string, closing: boolean): string {
  const heading = /^h([1-6])$/.exec(name)
  if (heading) return closing ? "\n" : `\n${"#".repeat(Number(heading[1]))} `
  if (name === "li") return closing ? "" : "\n- "
  if (name === "br") return "\n"
  if (name === "code") return "`"
  if (name === "tr") return closing ? "" : "\n"
  if (name === "td" || name === "th") return closing ? "" : " | "
  if (BLOCK_TAGS.has(name)) return "\n"
  return ""
}

function convert(html: string): string {
  const pres: string[] = []
  const re = new RegExp(TAG.source, "g")
  let out = ""
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    out += html.slice(last, match.index)
    last = re.lastIndex
    const closing = match[1] === "/"
    const name = match[2].toLowerCase()
    if (name === "pre" && !closing) {
      const close = /<\/pre\s*>/gi
      close.lastIndex = last
      const end = close.exec(html)
      const text = preText(html.slice(last, end ? end.index : undefined))
      last = end ? end.index + end[0].length : html.length
      re.lastIndex = last
      if (text) out += `\n\u0000${pres.push(text) - 1}\u0000\n`
      continue
    }
    out += tagText(name, closing)
  }
  out += html.slice(last)

  const lines = decodeEntities(out)
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/^- \n+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return lines.replace(/^\u0000(\d+)\u0000$/gm, (_match, index: string) => "```\n" + pres[Number(index)] + "\n```")
}

function collectLinks(html: string, baseUrl: string): string[] {
  const found: string[] = []
  const anchor = /<a\b[^<>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let base: string
  try {
    const parsed = new URL(baseUrl)
    parsed.hash = ""
    base = parsed.href
  } catch {
    return found
  }
  for (const match of html.matchAll(anchor)) {
    const raw = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim()
    if (!raw) continue
    let resolved: URL
    try {
      resolved = new URL(raw, base)
    } catch {
      continue
    }
    if (resolved.protocol !== "https:") continue
    resolved.hash = ""
    const href = resolved.href
    if (href === base || !DOC_LINK.test(href) || found.includes(href)) continue
    found.push(href)
    if (found.length >= MAX_DOC_LINKS) break
  }
  return found
}

function tagContent(html: string, tag: string): string | null {
  const open = new RegExp(`<${tag}(?=[\\s>])[^<>]*>`, "i").exec(html)
  if (!open) return null
  const close = new RegExp(`</${tag}\\s*>`, "gi")
  close.lastIndex = open.index + open[0].length
  const end = close.exec(html)
  return end ? html.slice(open.index + open[0].length, end.index) : null
}

export function htmlToText(html: string, baseUrl: string): { title: string; text: string; links: string[] } {
  const source = html.replace(/\u0000/g, "").replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<[!?][^<>]*>/g, "")
  const titleText = tagContent(source, "title")
  const cleaned = dropElements(source, HARD_REMOVED)
  const region = pickRegion(cleaned)
  const text = convert(dropElements(region, CHROME_REMOVED))
  let title = titleText ? plainLine(titleText) : ""
  if (!title) {
    const heading = tagContent(cleaned, "h1")
    title = heading ? plainLine(heading) : ""
  }
  return { title, text, links: collectLinks(cleaned, baseUrl) }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function startOfPage(text: string, max: number): string {
  if (text.length <= max) return text
  const rest = text.length - max
  return `${text.slice(0, max)}\n\n[The page goes on for ${rest} more characters. Call read_page again with find set to a word from the part you need.]`
}

export function pageExcerpt(text: string, find: string | null, max = MAX_PAGE_CHARS): string {
  const term = find?.trim() ?? ""
  if (!term) return startOfPage(text, max)
  const shown = redactKeys(term.slice(0, MAX_FIND_ECHO)).text
  const matches = [...text.matchAll(new RegExp(escapeRegExp(term), "gi"))]
  if (matches.length === 0) return `[No match for "${shown}". The start of the page follows.]\n\n${startOfPage(text, max)}`

  const windows: Array<[number, number]> = []
  for (const match of matches) {
    const start = Math.max(0, match.index - BEFORE_MATCH)
    const end = Math.min(text.length, match.index + match[0].length + AFTER_MATCH)
    const previous = windows[windows.length - 1]
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else windows.push([start, end])
  }

  const parts: string[] = []
  let total = 0
  for (const [start, end] of windows) {
    const room = max - total - (parts.length > 0 ? WINDOW_GAP.length : 0)
    if (room <= 0) break
    const piece = text.slice(start, end).slice(0, room)
    total += piece.length + (parts.length > 0 ? WINDOW_GAP.length : 0)
    parts.push(piece)
    if (total >= max) break
  }
  return `[Parts of the page containing "${shown}", ${matches.length} matches]\n\n${parts.join(WINDOW_GAP)}`
}

export type LoadedPage = { url: string; title: string; text: string; docLinks: string[] }
export type PageCache = Map<string, Promise<LoadedPage | { error: string }>>

export function pageCacheKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    return parsed.href
  } catch {
    return url
  }
}

function decodeBody(body: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]
  if (charset) {
    try {
      return new TextDecoder(charset).decode(body)
    } catch {
      // Unknown charset: fall back to UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(body)
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split("/").filter(Boolean).pop()
    if (!segment) return parsed.host
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  } catch {
    return url
  }
}

const NO_TEXT_ERROR = "The page had no readable text. It may need JavaScript, so try the site's llms.txt, its API reference, or another page."
const READ_FAILED_ERROR = "Not read: the page couldn't be read."

type Kind = "html" | "text" | "json" | "yaml" | null

function kindOf(type: string, body: string): Kind {
  if (!type) return body.trimStart().startsWith("<") ? "html" : "text"
  if (type === "text/html" || type === "application/xhtml+xml") return "html"
  if (type === "text/plain" || type === "text/markdown" || type === "text/x-markdown") return "text"
  if (type === "application/json" || type.endsWith("+json")) return "json"
  if (["application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml"].includes(type) || type.endsWith("+yaml")) return "yaml"
  return null
}

function probeLlmsTxt(origin: string, cache: PageCache): Promise<LoadedPage | { error: string }> {
  const key = `llms:${origin}`
  const cached = cache.get(key)
  if (cached) return cached
  const url = `${origin}/llms.txt`
  const probe = (async (): Promise<LoadedPage | { error: string }> => {
    try {
      const fetched = await fetchPublic(url)
      if ("error" in fetched) return fetched
      const type = fetched.contentType.split(";")[0].trim().toLowerCase()
      if (type !== "text/plain" && type !== "text/markdown") return { error: "Not an llms.txt." }
      if (!decodeBody(fetched.body.subarray(0, 512), fetched.contentType).trim().startsWith("#")) return { error: "Not an llms.txt." }
      return { url, title: "llms.txt", text: "", docLinks: [] }
    } catch {
      return { error: "Not an llms.txt." }
    }
  })()
  cache.set(key, probe)
  return probe
}

async function loadPage(url: string, cache: PageCache): Promise<LoadedPage | { error: string }> {
  let origin = ""
  let isLlmsTxt = false
  try {
    const parsed = new URL(url)
    origin = parsed.origin
    isLlmsTxt = parsed.pathname === "/llms.txt"
  } catch {
    return { error: READ_FAILED_ERROR }
  }

  const [fetched, llms] = await Promise.all([fetchPublic(url), isLlmsTxt ? Promise.resolve(null) : probeLlmsTxt(origin, cache)])
  if ("error" in fetched) return fetched

  const type = fetched.contentType.split(";")[0].trim().toLowerCase()
  const body = decodeBody(fetched.body, fetched.contentType)
  const kind = kindOf(type, body)
  if (!kind) return { error: `Not read: this isn't a text page (${type}).` }

  let title = titleFromUrl(fetched.url)
  let text = body
  let links: string[] = []
  if (kind === "html") {
    const converted = htmlToText(body, fetched.url)
    title = converted.title || title
    text = converted.text
    links = converted.links
  } else if (kind === "json") {
    try {
      text = JSON.stringify(JSON.parse(body), null, 1)
    } catch {
      text = body
    }
  }

  if (!text.trim()) return { error: NO_TEXT_ERROR }
  if (fetched.truncated) text += "\n\n[The file was cut at 4 MB.]"

  const llmsUrl = llms && !("error" in llms) ? llms.url : null
  const pageLinks = links.filter((link) => findKeys(link).length === 0)
  const docLinks = [...new Set([...pageLinks.slice(0, llmsUrl ? MAX_DOC_LINKS - 1 : MAX_DOC_LINKS), ...(llmsUrl ? [llmsUrl] : [])])]
  return {
    url: redactKeys(fetched.url).text,
    title: redactKeys(title).text,
    text: redactKeys(text).text,
    docLinks,
  }
}

export async function readPage(
  url: string,
  options: { find?: string | null; cache?: PageCache } = {},
): Promise<{ url: string; title: string; text: string; docLinks: string[] } | { error: string }> {
  try {
    if (!isPublicHttpsUrl(url)) return { error: "Not read: only public https pages can be read." }
    const cache = options.cache ?? new Map()
    const key = pageCacheKey(url)
    let loading = cache.get(key)
    if (!loading) {
      loading = loadPage(url, cache).catch(() => ({ error: READ_FAILED_ERROR }))
      cache.set(key, loading)
    }
    const loaded = await loading
    if ("error" in loaded) return { error: loaded.error }
    return { url: loaded.url, title: loaded.title, text: pageExcerpt(loaded.text, options.find ?? null), docLinks: loaded.docLinks }
  } catch {
    return { error: READ_FAILED_ERROR }
  }
}
