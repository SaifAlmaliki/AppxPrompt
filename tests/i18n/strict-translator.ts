import { createTranslator } from "next-intl"

import type { Locale } from "@/i18n/config"
import { formats } from "@/i18n/formats"
import ar from "@/messages/ar.json"
import en from "@/messages/en.json"

type Namespace = keyof typeof en

/**
 * A translator for catalog checks. next-intl normally logs a missing or broken message
 * and answers `namespace.key`, which would pass a check for "some text came back".
 * This one throws instead, and the text it returns is checked against that fallback too.
 */
export function strictTranslator(locale: Locale, namespace: Namespace) {
  const t = createTranslator({
    locale,
    messages: locale === "en" ? en : ar,
    namespace,
    formats,
    onError: (error) => {
      throw error
    },
  }) as unknown as (key: string, values?: object) => string

  return (key: string, values?: object) => {
    const text = t(key, values)
    if (!text || text === `${namespace}.${key}`) {
      throw new Error(`${locale} ${namespace}.${key} has no text of its own`)
    }
    return text
  }
}
