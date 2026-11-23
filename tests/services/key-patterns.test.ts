import { describe, expect, it } from "vitest"
import { KEY_BOUNDARY, KEY_PATTERN_SOURCES, KEY_REMOVED, findKeys, redactKeys, scrubSecrets } from "@/lib/services/key-patterns"

const openai = "sk-proj-" + "a".repeat(40)
const zernio = "sk_" + "0123456789abcdef".repeat(4)
const googleSecret = "GOCSPX-" + "b".repeat(28)
const googleKey = "AIza" + "c".repeat(35)

describe("findKeys", () => {
  it("finds common provider keys", () => {
    expect(findKeys(`a ${openai} b ${zernio} c ${googleSecret} d ${googleKey}`)).toEqual([openai, zernio, googleSecret, googleKey])
  })
  it("finds keys glued to punctuation and quotes", () => {
    expect(findKeys(`key:"${openai}",`)).toEqual([openai])
    expect(findKeys("`" + zernio + "`")).toEqual([zernio])
  })
  it("ignores ordinary text and short sk- words", () => {
    expect(findKeys("sk-short and a skin-care app")).toEqual([])
  })
  it("returns each key once", () => {
    expect(findKeys(`${openai} ${openai}`)).toEqual([openai])
  })
  it("ignores key-like endings inside ordinary words", () => {
    expect(findKeys("a risk-management-dashboard-app for teams")).toEqual([])
    expect(findKeys("task_" + "a".repeat(24))).toEqual([])
  })
  it("finds a key at the start of the string and after common separators", () => {
    expect(findKeys(openai)).toEqual([openai])
    expect(findKeys(`x\n${zernio}`)).toEqual([zernio])
    expect(findKeys(`x:${googleSecret}`)).toEqual([googleSecret])
    expect(findKeys(`'${googleKey}'`)).toEqual([googleKey])
  })
  it("finds two keys separated by a single character", () => {
    expect(findKeys(`${openai},${zernio}`)).toEqual([openai, zernio])
  })
})

describe("redactKeys", () => {
  it("replaces every key and keeps the rest", () => {
    expect(redactKeys(`use ${openai}\nand ${zernio}.`)).toEqual({
      text: `use ${KEY_REMOVED}\nand ${KEY_REMOVED}.`,
      keys: [openai, zernio],
    })
  })
  it("keeps the character before each key", () => {
    expect(redactKeys("x," + openai + "," + zernio)).toEqual({
      text: `x,${KEY_REMOVED},${KEY_REMOVED}`,
      keys: [openai, zernio],
    })
  })
  it("leaves ordinary words untouched", () => {
    const text = "a risk-management-dashboard-app"
    expect(redactKeys(text)).toEqual({ text, keys: [] })
  })
})

describe("scrubSecrets", () => {
  it("redacts nested strings without changing other values", () => {
    expect(scrubSecrets({ a: [`x ${openai}`], n: 1, ok: true })).toEqual({ a: [`x ${KEY_REMOVED}`], n: 1, ok: true })
  })

  it("strips query strings from url-like fields", () => {
    expect(
      scrubSecrets({
        request: { url: "https://api.example.com/v1/ping?key=abc123&x=1", query_string: "key=abc123" },
        data: {
          "http.url": "https://api.example.com/v1?token=t#frag",
          "url.full": "https://api.example.com/v1?token=t",
          "http.query": "?token=t",
          "url.query": "token=t",
          other: "https://example.com/page?keep=1",
        },
      }),
    ).toEqual({
      request: { url: "https://api.example.com/v1/ping", query_string: "" },
      data: {
        "http.url": "https://api.example.com/v1#frag",
        "url.full": "https://api.example.com/v1",
        "http.query": "",
        "url.query": "",
        other: "https://example.com/page?keep=1",
      },
    })
  })

  it("leaves a url without a query alone", () => {
    expect(scrubSecrets({ url: "https://example.com/a" })).toEqual({ url: "https://example.com/a" })
  })

  it("survives circular references", () => {
    const event: Record<string, unknown> = { message: `x ${openai}`, list: [] }
    event.self = event
    ;(event.list as unknown[]).push(event)
    const scrubbed = scrubSecrets(event) as Record<string, unknown>
    expect(scrubbed.message).toBe(`x ${KEY_REMOVED}`)
    expect(scrubbed.self).toBe("[Circular]")
    expect(scrubbed.list).toEqual(["[Circular]"])
  })

  it("keeps a value that appears twice without a cycle", () => {
    const shared = { note: `k ${openai}` }
    expect(scrubSecrets({ a: shared, b: shared })).toEqual({ a: { note: `k ${KEY_REMOVED}` }, b: { note: `k ${KEY_REMOVED}` } })
  })
})

describe("KEY_PATTERN_SOURCES", () => {
  it("uses no syntax Postgres can't run", () => {
    for (const source of KEY_PATTERN_SOURCES) expect(source).not.toMatch(/\\b|\(\?<|\(\?=|\(\?!/)
  })
  it("uses a boundary Postgres can run", () => {
    expect(KEY_BOUNDARY).not.toMatch(/\\b|\(\?<|\(\?=|\(\?!/)
  })
})
