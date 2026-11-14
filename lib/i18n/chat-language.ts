import type { Locale } from "@/i18n/config"

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi

/**
 * The language the agent's own chat messages are written in: what the person last wrote.
 * Arabic wins when a message mixes scripts. A message with no letters, such as "2" or a
 * link on its own, keeps the language it had.
 */
export function detectChatLanguage(text: string, previous: Locale): Locale {
  const words = text.replace(LINK, " ")
  if (/\p{Script=Arabic}/u.test(words)) return "ar"
  if (/\p{Script=Latin}/u.test(words)) return "en"
  return previous
}
