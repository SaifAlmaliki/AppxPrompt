const PROBE_URL = "https://example.com"
const PROBE_TIMEOUT_MS = 5_000

/** Reports whether the VM's egress policy holds, and how many of the bundle's credentials arrived. Never returns values. */
export async function runSelfCheck(input: {
  hostFetch: typeof fetch
  env: Record<string, string>
  secretNames: string[]
  timeoutMs?: number
}) {
  let egressBlocked = true
  try {
    await input.hostFetch(PROBE_URL, { redirect: "manual", signal: AbortSignal.timeout(input.timeoutMs ?? PROBE_TIMEOUT_MS) })
    egressBlocked = false
  } catch {
    egressBlocked = true
  }
  const envKeys = new Set(input.secretNames.filter((name) => typeof input.env[name] === "string")).size
  return { egressBlocked, envKeys }
}
