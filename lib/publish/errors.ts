import { errorText, storedErrorText, type ErrorKey, type ErrorValues, type Translator } from "@/lib/i18n/server"
import en from "@/messages/en.json"

export type PublishFailure =
  | { source: "application"; key: ErrorKey; values?: ErrorValues }
  | { source: "provider"; detail: string }

// Versioned envelope in the existing text columns. Old plain-text errors remain readable.
const PREFIX = "appxprompt:publish-error:v1:"

export function applicationFailure(key: ErrorKey, values?: ErrorValues): PublishFailure {
  return { source: "application", key, values }
}

export function storeFailure(error: PublishFailure): string {
  return PREFIX + JSON.stringify(error)
}

export function failureText(stored: string | null, t: Translator<"errors">): string | null {
  if (!stored?.startsWith(PREFIX)) return storedErrorText(stored, t)
  try {
    const error = JSON.parse(stored.slice(PREFIX.length))
    if (error?.source === "provider" && typeof error.detail === "string") return error.detail
    if (
      error?.source === "application" &&
      typeof error.key === "string" && Object.hasOwn(en.errors, error.key) &&
      (error.values === undefined || (error.values !== null && typeof error.values === "object" &&
        !Array.isArray(error.values) && Object.values(error.values).every((value) => typeof value === "string" || typeof value === "number")))
    ) {
      return errorText(t, error.key as ErrorKey, error.values)
    }
  } catch {
    // An older or malformed stored message is still useful as plain text.
  }
  return stored
}
