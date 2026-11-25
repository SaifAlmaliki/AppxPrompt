// The key a project's server routes use to prove a request comes from its own app server.
// It is a credential of the hidden `appxprompt` service, sealed like any secret, and its
// hash is kept in the credential's hint so a request can be checked without unsealing it.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { and, eq } from "drizzle-orm"

import { db, projectCredentials, projectServices } from "@/db"
import { seal } from "@/lib/cloudhike/crypto"
import { SERVER_KEY_NAME, SYSTEM_SERVICE_SLUG, type ServiceDefinition } from "@/lib/services/protocol"

const HASH_PREFIX = "sha256:"
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const CACHE_MS = 60_000
const MISS_CACHE_MS = 30_000
const MAX_CACHED_MISSES = 10_000

const SYSTEM_SERVICE: ServiceDefinition = {
  slug: SYSTEM_SERVICE_SLUG,
  name: "AppxPrompt",
  purpose: "Lets the app's server routes recognise requests from the app's own server.",
  docsUrl: "https://appxprompt.com",
  authKind: "api_key",
  fields: [],
  allowedHosts: [],
  oauth: null,
  check: null,
  setupSteps: "",
  notes: "",
}

/** Keyed by project id. Each process keeps its own, so a rotation reaches other processes within `CACHE_MS`. */
const hashCache = new Map<string, { hint: string; expiresAt: number }>()

/** Projects with no key, so requests with a made-up key don't each cost a database read. */
const missCache = new Map<string, number>()

export function newServerKey(): string {
  return randomBytes(32).toString("base64url")
}

export function hashServerKey(key: string): string {
  return HASH_PREFIX + createHash("sha256").update(key).digest("hex")
}

export function serverKeyMatches(given: string, storedHash: string): boolean {
  if (!HASH_PATTERN.test(storedHash)) return false
  return timingSafeEqual(Buffer.from(hashServerKey(given)), Buffer.from(storedHash))
}

function serverKeyRow(projectId: string) {
  return and(
    eq(projectCredentials.projectId, projectId),
    eq(projectCredentials.serviceSlug, SYSTEM_SERVICE_SLUG),
    eq(projectCredentials.name, SERVER_KEY_NAME),
  )
}

/** Gives the project a server key if it has none. */
export async function ensureServerKey(projectId: string): Promise<void> {
  const [existing] = await db.select({ name: projectCredentials.name }).from(projectCredentials).where(serverKeyRow(projectId))
  if (existing) return
  const key = newServerKey()
  await db.transaction(async (tx) => {
    await tx
      .insert(projectServices)
      .values({ projectId, slug: SYSTEM_SERVICE_SLUG, definition: SYSTEM_SERVICE })
      .onConflictDoNothing()
    // Two requests can race here: the first key saved wins.
    await tx
      .insert(projectCredentials)
      .values({
        projectId,
        name: SERVER_KEY_NAME,
        serviceSlug: SYSTEM_SERVICE_SLUG,
        kind: "secret",
        value: seal(key),
        hint: hashServerKey(key),
      })
      .onConflictDoNothing()
  })
  missCache.delete(projectId)
}

/** Replaces the project's server key, so the old one stops working. Does nothing if there isn't one. */
export async function rotateServerKey(projectId: string): Promise<void> {
  const key = newServerKey()
  await db
    .update(projectCredentials)
    .set({ value: seal(key), hint: hashServerKey(key) })
    .where(serverKeyRow(projectId))
  hashCache.delete(projectId)
  missCache.delete(projectId)
}

export async function verifyServerKey(projectId: string, given: string): Promise<boolean> {
  const now = Date.now()
  const missUntil = missCache.get(projectId)
  if (missUntil !== undefined && missUntil > now) return false
  let entry = hashCache.get(projectId)
  if (!entry || entry.expiresAt <= now) {
    const [row] = await db.select({ hint: projectCredentials.hint }).from(projectCredentials).where(serverKeyRow(projectId))
    if (!row?.hint) {
      hashCache.delete(projectId)
      if (missCache.size >= MAX_CACHED_MISSES) missCache.clear()
      missCache.set(projectId, now + MISS_CACHE_MS)
      return false
    }
    missCache.delete(projectId)
    entry = { hint: row.hint, expiresAt: now + CACHE_MS }
    hashCache.set(projectId, entry)
  }
  return serverKeyMatches(given, entry.hint)
}
