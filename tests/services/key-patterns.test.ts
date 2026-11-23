import { describe, expect, it } from "vitest"
import { KEY_PATTERN_SOURCES, KEY_REMOVED, findKeys, redactKeys, scrubSecrets } from "@/lib/services/key-patterns"

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
})

describe("redactKeys", () => {
  it("replaces every key and keeps the rest", () => {
    expect(redactKeys(`use ${openai}\nand ${zernio}.`)).toEqual({
      text: `use ${KEY_REMOVED}\nand ${KEY_REMOVED}.`,
      keys: [openai, zernio],
    })
  })
})

describe("scrubSecrets", () => {
  it("redacts nested strings without changing other values", () => {
    expect(scrubSecrets({ a: [`x ${openai}`], n: 1, ok: true })).toEqual({ a: [`x ${KEY_REMOVED}`], n: 1, ok: true })
  })
})

describe("KEY_PATTERN_SOURCES", () => {
  it("uses no syntax Postgres can't run", () => {
    for (const source of KEY_PATTERN_SOURCES) expect(source).not.toMatch(/\\b|\(\?<|\(\?=|\(\?!/)
  })
})
