// Who a gateway request acts as. A screen acts as its own person or install. An app's
// server routes may hold the server key and act as the caller they serve, or as the app.

import { deviceOwner, type Owner } from "@/lib/cloudhike/gateway"

export const SERVER_KEY_HEADER = "x-appxprompt-server-key"
export const SERVER_MODE_HEADER = "x-appxprompt-as"

/** Reads and changes every record of every collection. Only a valid server key can become it. */
export const APP_SERVER_OWNER: Owner = { id: "app:server", email: null, signedIn: false, all: true }

const DEVICE_ID = /^[a-f0-9]{64}$/

export type RequestOwnerDeps = {
  verifyServerKey(key: string): Promise<boolean>
  fromToken(token: string): Promise<Owner | null>
}

/** The caller from the forwarded `authorization` / `x-device-id`: a signed-in person, or else one install. */
async function callerOwner(headers: Headers, deps: RequestOwnerDeps): Promise<Owner | null> {
  const token = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (token) return deps.fromToken(token)
  const device = headers.get("x-device-id")
  return device && DEVICE_ID.test(device) ? deviceOwner(device) : null
}

export async function resolveRequestOwner(
  headers: Headers,
  deps: RequestOwnerDeps,
): Promise<{ owner: Owner | null; server: boolean } | "bad-key"> {
  const key = headers.get(SERVER_KEY_HEADER)
  if (key === null) return { owner: await callerOwner(headers, deps), server: false }

  if (!key || !(await deps.verifyServerKey(key))) return "bad-key"
  if (headers.get(SERVER_MODE_HEADER)?.trim().toLowerCase() === "app") return { owner: APP_SERVER_OWNER, server: true }
  return { owner: await callerOwner(headers, deps), server: true }
}
