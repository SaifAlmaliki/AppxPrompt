/**
 * Whether this account may run server functions in a sandbox. SANDBOX_ALLOWED_USERS is a comma-separated
 * list of user ids: unset or blank allows everyone, anything else allows only the listed ids.
 */
export function sandboxAllowedFor(userId: number, env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.SANDBOX_ALLOWED_USERS?.trim()
  if (!raw) return true
  const listed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number)
  return listed.includes(userId)
}
