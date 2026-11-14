import { describe, expect, it, vi } from "vitest"

import ar from "@/messages/ar.json"
import en from "@/messages/en.json"

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "en" }) }),
  headers: async () => ({ get: () => null }),
}))

// Outside a request scope next-intl's own `getRequestConfig` refuses to run, so this stands in for it: it returns the function it is given, which is all the real one does.
vi.mock("next-intl/server", () => ({ getRequestConfig: (config: unknown) => config }))

const config = async (locale?: string) => {
  const { default: requestConfig } = await import("@/i18n/request")
  return (requestConfig as unknown as (params: { locale?: string; requestLocale: Promise<string | undefined> }) => Promise<{ locale: string; messages: unknown }>)({
    locale,
    requestLocale: Promise.resolve(locale),
  })
}

describe("the request config", () => {
  it("loads the locale next-intl asks for, whatever the cookie says", async () => {
    const result = await config("ar")
    expect(result.locale).toBe("ar")
    expect(result.messages).toEqual(ar)
  })

  it("falls back to the requester's locale when none is asked for", async () => {
    const result = await config(undefined)
    expect(result.locale).toBe("en")
    expect(result.messages).toEqual(en)
  })

  it("ignores a locale that isn't supported", async () => {
    const result = await config("fr")
    expect(result.locale).toBe("en")
  })
})
