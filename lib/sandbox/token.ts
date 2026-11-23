import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { sandboxTokenExpiry } from "./token-expiry"

export { sandboxTokenExpiry }

export const SANDBOX_TOKEN_HEADER = "x-appxprompt-sandbox"
export const SANDBOX_TOKEN_TTL_SECONDS = 3600

function key() {
  const secret = process.env.CLOUDHIKE_ENCRYPTION_KEY
  if (!secret) return null
  return createHash("sha256").update(`appxprompt-sandbox:${secret}`).digest()
}

function sign(secret: Buffer, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

export function createSandboxToken(projectId: string, userId: number, ttlSeconds = SANDBOX_TOKEN_TTL_SECONDS) {
  const secret = key()
  if (!secret) throw new Error("CLOUDHIKE_ENCRYPTION_KEY is not set")
  const payload = `${projectId}.${userId}.${Math.floor(Date.now() / 1000) + ttlSeconds}`
  return `${payload}.${sign(secret, payload)}`
}

/** Whether the token was issued by this server for this project and has not expired. Never throws. */
export function verifySandboxToken(token: string, projectId: string) {
  try {
    const secret = key()
    if (!secret || typeof token !== "string") return false
    const parts = token.split(".")
    if (parts.length !== 4 || parts[0] !== projectId) return false
    const expiry = sandboxTokenExpiry(token)
    if (expiry === null || expiry <= Date.now() / 1000) return false
    const expected = Buffer.from(sign(secret, parts.slice(0, 3).join(".")))
    const actual = Buffer.from(parts[3])
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** The secret a project's own server functions use to call back into the platform. */
export function sandboxInternalSecret(projectId: string) {
  const secret = key()
  if (!secret) throw new Error("CLOUDHIKE_ENCRYPTION_KEY is not set")
  return sign(secret, `internal:${projectId}`)
}
