export const KEY_PATTERN_SOURCES = [
  "sk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{20,}",
  "(?:sk|rk)_(?:live_|test_)?[A-Za-z0-9]{20,}",
  "GOCSPX-[A-Za-z0-9_-]{20,}",
  "AIza[0-9A-Za-z_-]{35}",
  "gh[pousr]_[A-Za-z0-9]{30,}",
  "github_pat_[A-Za-z0-9_]{40,}",
  "xox[abposr]-[A-Za-z0-9-]{10,}",
  "AKIA[0-9A-Z]{16}",
  "eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}",
] as const

export const KEY_REMOVED = "[key removed and moved to the keys dialog]"

const KEY_PATTERN = new RegExp(KEY_PATTERN_SOURCES.join("|"), "g")

export function findKeys(text: string): string[] {
  return [...new Set(text.match(KEY_PATTERN) ?? [])]
}

export function redactKeys(text: string): { text: string; keys: string[] } {
  return { text: text.replace(KEY_PATTERN, KEY_REMOVED), keys: findKeys(text) }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function scrubSecrets<T>(value: T): T {
  if (typeof value === "string") return value.replace(KEY_PATTERN, KEY_REMOVED) as T
  if (Array.isArray(value)) return value.map(scrubSecrets) as T
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubSecrets(v)])) as T
  }
  return value
}
