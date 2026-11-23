/** The expiry of a sandbox token in epoch seconds, or null when it is malformed. Does not check the signature. */
export function sandboxTokenExpiry(token: string): number | null {
  const parts = token.split(".")
  if (parts.length !== 4) return null
  const expiry = Number(parts[2])
  return Number.isSafeInteger(expiry) && expiry > 0 ? expiry : null
}
