import type { Locale } from "@/i18n/config"
import type { Activity, StatusKey, StatusValues } from "@/lib/agent-protocol"

/** Keeps text of one direction, such as a Latin screen name, from reordering the Arabic around it. Only Arabic needs it, so English text stays as it was. */
export function isolate(text: string) {
  return `\u2068${text}\u2069`
}

/** The words for what the agent is doing. A string is an old saved label, which is shown as it is. */
export function activityText(t: (key: StatusKey, values?: StatusValues) => string, activity: Activity, locale: Locale) {
  if (typeof activity === "string") return activity
  const values =
    activity.values &&
    Object.fromEntries(Object.entries(activity.values).map(([name, value]) => [name, locale === "ar" && typeof value === "string" ? isolate(value) : value]))
  return t(activity.key, values)
}
