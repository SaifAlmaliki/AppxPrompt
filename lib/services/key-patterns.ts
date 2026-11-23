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

export const KEY_BOUNDARY = "(^|[^A-Za-z0-9_-])"

const KEY_PATTERN = new RegExp(KEY_BOUNDARY + "(" + KEY_PATTERN_SOURCES.join("|") + ")", "g")

function removeKeys(text: string): string {
  return text.replace(KEY_PATTERN, (_match, prefix: string) => prefix + KEY_REMOVED)
}

export function findKeys(text: string): string[] {
  return [...new Set([...text.matchAll(KEY_PATTERN)].map((m) => m[2]))]
}

export function redactKeys(text: string): { text: string; keys: string[] } {
  return { text: removeKeys(text), keys: findKeys(text) }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const URL_KEYS = new Set(["url", "http.url", "url.full"])
const QUERY_KEYS = new Set(["http.query", "url.query", "query_string"])

function scrubString(key: string, value: string): string {
  if (QUERY_KEYS.has(key)) return ""
  const text = URL_KEYS.has(key) ? value.replace(/\?[^#]*/, "") : value
  return removeKeys(text)
}

function scrub(value: unknown, key: string, active: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(key, value)
  if (typeof value !== "object" || value === null) return value
  const isArray = Array.isArray(value)
  if (!isArray && !isPlainObject(value)) return value
  if (active.has(value)) return "[Circular]"
  active.add(value)
  try {
    if (isArray) return value.map((item) => scrub(item, "", active))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k, active)]))
  } finally {
    active.delete(value)
  }
}

/** Removes keys from every string, and the query string from url-like fields, so telemetry never carries credentials. */
export function scrubSecrets<T>(value: T): T {
  return scrub(value, "", new WeakSet()) as T
}