import { describe, expect, it } from "vitest"

import { detectChatLanguage } from "@/lib/i18n/chat-language"

describe("detectChatLanguage", () => {
  it("is Arabic for an Arabic message", () => {
    expect(detectChatLanguage("أريد تطبيق وصفات", "en")).toBe("ar")
  })

  it("is English for a Latin one, even after Arabic", () => {
    expect(detectChatLanguage("A recipe app", "ar")).toBe("en")
  })

  it("keeps the language when there are no letters", () => {
    expect(detectChatLanguage("2", "ar")).toBe("ar")
    expect(detectChatLanguage("👍 https://x.com", "en")).toBe("en")
    expect(detectChatLanguage("1, 3", "ar")).toBe("ar")
  })

  it("ignores the letters of a link", () => {
    expect(detectChatLanguage("https://example.com/menu", "ar")).toBe("ar")
    expect(detectChatLanguage("see https://example.com/menu", "ar")).toBe("en")
    expect(detectChatLanguage("https://example.com/مرحبا", "en")).toBe("en")
    expect(detectChatLanguage("www.مثال.com/مرحبا", "en")).toBe("en")
    expect(detectChatLanguage("see https://example.com/مرحبا", "ar")).toBe("en")
  })

  it("ignores Arabic letters inside a link", () => {
    expect(detectChatLanguage("https://ar.wikipedia.org/wiki/مصر", "en")).toBe("en")
    expect(detectChatLanguage("like https://ar.wikipedia.org/wiki/مصر", "ar")).toBe("en")
  })

  it("is Arabic when a message mixes scripts", () => {
    expect(detectChatLanguage("make it like Uber لكن للمطاعم", "en")).toBe("ar")
  })
})
