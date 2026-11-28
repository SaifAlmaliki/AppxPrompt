// The services a project uses and the values saved for them. Server only, and the
// only module that reads or writes these tables. Secrets are sealed here and only
// leave through `loadServiceSecrets`; everything else returns a `ServiceSummary`.

import { and, asc, eq, inArray, ne, notInArray } from "drizzle-orm"

import { db, projectCredentials, projectServices } from "@/db"
import { seal, unseal } from "@/lib/cloudhike/crypto"
import { refreshAccessToken, runCheck, type CheckOutcome } from "@/lib/services/check"
import { addLesson } from "@/lib/services/lessons"
import { refreshTokenName, SERVER_KEY_NAME, SYSTEM_SERVICE_SLUG } from "@/lib/services/protocol"
import type { CheckResult, ServiceDefinition, ServiceSummary } from "@/lib/services/protocol"
import { canCheck, credentialCollision, definitionNames, staleCredentialNames } from "@/lib/services/rules"
import { ensureServerKey } from "@/lib/services/server-key"
import { credentialHint, serviceStatus, summarizeService, type StoredCredential } from "@/lib/services/status"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Transaction

type CredentialRow = typeof projectCredentials.$inferSelect
type ServiceRow = typeof projectServices.$inferSelect

function toStored(row: CredentialRow): StoredCredential {
  return {
    name: row.name,
    kind: row.kind,
    hint: row.hint,
    publicValue: row.kind === "public" ? row.value : null,
  }
}

function toSummary(row: ServiceRow, credentials: CredentialRow[]): ServiceSummary {
  return summarizeService(
    row.definition,
    credentials.filter((credential) => credential.serviceSlug === row.slug).map(toStored),
    row.approvedHosts,
    row.checkResult,
    row.checkedAt,
  )
}

/** The hidden system service is never found, so nothing that works on a service by slug can reach the server key. */
async function findService(executor: Executor, projectId: string, slug: string): Promise<ServiceRow | null> {
  if (slug === SYSTEM_SERVICE_SLUG) return null
  const [row] = await executor
    .select()
    .from(projectServices)
    .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
  return row ?? null
}

function serviceCredentials(executor: Executor, projectId: string, slug: string): Promise<CredentialRow[]> {
  return executor
    .select()
    .from(projectCredentials)
    .where(and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.serviceSlug, slug)))
}

async function summaryOf(executor: Executor, projectId: string, slug: string): Promise<ServiceSummary | null> {
  const row = await findService(executor, projectId, slug)
  if (!row) return null
  return toSummary(row, await serviceCredentials(executor, projectId, slug))
}

function readValues(rows: CredentialRow[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const row of rows) {
    if (row.kind === "public") {
      values[row.name] = row.value
      continue
    }
    try {
      values[row.name] = unseal(row.value)
    } catch (error) {
      // The encryption key changed, so this value is lost.
      console.error("Reading a saved service value failed", error)
    }
  }
  return values
}

function outcomeToResult(outcome: CheckOutcome): CheckResult {
  return outcome === "unreachable" ? null : outcome
}

/**
 * Checks the saved values against the service. Null means nothing was sent: the values are
 * incomplete, the owner hasn't approved every host, or the service has no way to test them.
 */
async function checkService(
  definition: ServiceDefinition,
  rows: CredentialRow[],
  approvedHosts: readonly string[],
): Promise<CheckOutcome | null> {
  if (!canCheck(definition, approvedHosts)) return null
  const values = readValues(rows)
  if (definition.authKind === "api_key") {
    if (definition.fields.some((field) => values[field.name] === undefined)) return null
    return runCheck(definition, values)
  }
  const oauth = definition.oauth
  const refreshToken = values[refreshTokenName(definition.slug)]
  if (!oauth || refreshToken === undefined) return null
  const clientId = values[oauth.clientIdField]
  const clientSecret = values[oauth.clientSecretField]
  if (clientId === undefined || clientSecret === undefined) return null
  return refreshAccessToken({ definition, clientId, clientSecret, refreshToken })
}

export async function listServiceSummaries(projectId: string): Promise<ServiceSummary[]> {
  const [services, credentials] = await Promise.all([
    db
      .select()
      .from(projectServices)
      .where(and(eq(projectServices.projectId, projectId), ne(projectServices.slug, SYSTEM_SERVICE_SLUG)))
      .orderBy(asc(projectServices.createdAt)),
    db
      .select()
      .from(projectCredentials)
      .where(and(eq(projectCredentials.projectId, projectId), ne(projectCredentials.serviceSlug, SYSTEM_SERVICE_SLUG))),
  ])
  return services.map((service) => toSummary(service, credentials))
}

/** The project's service definitions, without the hidden system service. */
export async function listServiceDefinitions(projectId: string): Promise<ServiceDefinition[]> {
  const rows = await db
    .select({ definition: projectServices.definition })
    .from(projectServices)
    .where(and(eq(projectServices.projectId, projectId), ne(projectServices.slug, SYSTEM_SERVICE_SLUG)))
    .orderBy(asc(projectServices.createdAt))
  return rows.map((row) => row.definition)
}

/**
 * The credentials that may leave the database: the server key, and those of services that are
 * connected. A service with an unapproved host or a rejected check keeps its values to itself.
 * Everything that sends credential values anywhere goes through this.
 */
export function connectedServiceCredentials<T extends { serviceSlug: string; name: string }>(
  services: { slug: string; definition: ServiceDefinition; approvedHosts: string[]; checkResult: CheckResult }[],
  credentials: T[],
): T[] {
  const namesBySlug = new Map<string, Set<string>>()
  for (const credential of credentials) {
    const names = namesBySlug.get(credential.serviceSlug) ?? new Set<string>()
    names.add(credential.name)
    namesBySlug.set(credential.serviceSlug, names)
  }
  const connected = new Set(
    services
      .filter(
        (service) =>
          service.slug !== SYSTEM_SERVICE_SLUG &&
          serviceStatus(
            service.definition,
            namesBySlug.get(service.slug) ?? new Set<string>(),
            service.approvedHosts,
            service.checkResult,
          ) === "connected",
      )
      .map((service) => service.slug),
  )
  return credentials.filter(
    (credential) =>
      credential.serviceSlug === SYSTEM_SERVICE_SLUG
        ? credential.name === SERVER_KEY_NAME
        : connected.has(credential.serviceSlug),
  )
}

/** What the app's server needs in its environment, and which of those values are secret. Only the sandbox bundle reads this. */
export async function loadProjectEnvironment(
  projectId: string,
): Promise<{ env: Record<string, string>; secretNames: string[] }> {
  await ensureServerKey(projectId)
  const [services, credentials] = await Promise.all([
    db.select().from(projectServices).where(eq(projectServices.projectId, projectId)),
    db.select().from(projectCredentials).where(eq(projectCredentials.projectId, projectId)),
  ])
  const kept = connectedServiceCredentials(services, credentials)
  const env = readValues(kept)
  return {
    env,
    secretNames: kept.filter((row) => row.kind !== "public" && row.name in env).map((row) => row.name),
  }
}

/** The research notes saved with a service, or null when the project has no such service. Never reads credentials. */
export async function getServiceNotes(projectId: string, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ definition: projectServices.definition })
    .from(projectServices)
    .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
  return row ? row.definition.notes : null
}

/** Adds one lesson to a service's notes. It changes the notes and nothing else: not the fields, hosts, auth, check, values or status. */
export async function addServiceLesson(
  projectId: string,
  slug: string,
  lesson: string,
): Promise<{ ok: true; added: boolean } | { ok: false; reason: string }> {
  return db.transaction(async (tx) => {
    if (slug === SYSTEM_SERVICE_SLUG) return { ok: false, reason: `No service "${slug}" is registered.` }
    const [row] = await tx
      .select({ definition: projectServices.definition })
      .from(projectServices)
      .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
      .for("update")
    if (!row) return { ok: false, reason: `No service "${slug}" is registered.` }
    const result = addLesson(row.definition.notes, lesson)
    if ("refused" in result) return { ok: false, reason: result.refused }
    if (result.added) {
      await tx
        .update(projectServices)
        .set({ definition: { ...row.definition, notes: result.notes }, updatedAt: new Date() })
        .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
    }
    return { ok: true, added: result.added }
  })
}

/** Saves the service, or returns why it can't be saved. */
export async function registerService(projectId: string, definition: ServiceDefinition): Promise<ServiceSummary | string> {
  return db.transaction(async (tx) => {
    const keep = definitionNames(definition)
    const [otherServices, otherCredentials] = await Promise.all([
      tx
        .select({ slug: projectServices.slug, definition: projectServices.definition })
        .from(projectServices)
        .where(and(eq(projectServices.projectId, projectId), ne(projectServices.slug, definition.slug))),
      tx
        .select({ name: projectCredentials.name, serviceSlug: projectCredentials.serviceSlug })
        .from(projectCredentials)
        .where(and(eq(projectCredentials.projectId, projectId), inArray(projectCredentials.name, keep))),
    ])
    const collision = credentialCollision(definition.slug, keep, [
      ...otherCredentials,
      ...otherServices.flatMap((service) =>
        definitionNames(service.definition).map((name) => ({ name, serviceSlug: service.slug })),
      ),
    ])
    if (collision) return collision

    await tx
      .insert(projectServices)
      .values({ projectId, slug: definition.slug, definition })
      .onConflictDoUpdate({
        target: [projectServices.projectId, projectServices.slug],
        set: { definition, updatedAt: new Date() },
      })
    const owned = and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.serviceSlug, definition.slug))
    await tx
      .delete(projectCredentials)
      .where(keep.length > 0 ? and(owned, notInArray(projectCredentials.name, keep)) : owned)
    const stale = staleCredentialNames(definition.fields, await serviceCredentials(tx, projectId, definition.slug))
    if (stale.length > 0) await tx.delete(projectCredentials).where(and(owned, inArray(projectCredentials.name, stale)))
    const summary = await summaryOf(tx, projectId, definition.slug)
    if (!summary) throw new Error("The service was not saved.")
    return summary
  })
}

export async function saveServiceValues(
  projectId: string,
  slug: string,
  values: Record<string, string>,
): Promise<ServiceSummary | null> {
  const service = await findService(db, projectId, slug)
  if (!service) return null
  const { definition } = service
  for (const field of definition.fields) {
    const value = values[field.name]
    if (value === undefined) continue
    const stored = {
      kind: field.kind,
      value: field.kind === "secret" ? seal(value) : value,
      hint: credentialHint(value, field.kind),
    }
    await db
      .insert(projectCredentials)
      .values({ projectId, name: field.name, serviceSlug: slug, ...stored })
      .onConflictDoUpdate({
        target: [projectCredentials.projectId, projectCredentials.name],
        set: { ...stored, updatedAt: new Date() },
        setWhere: eq(projectCredentials.serviceSlug, slug),
      })
  }
  const update: Partial<typeof projectServices.$inferInsert> = { approvedHosts: definition.allowedHosts }
  if (definition.authKind === "api_key") {
    // Saving the values is the owner approving the hosts, so they count as approved here.
    const outcome = await checkService(definition, await serviceCredentials(db, projectId, slug), definition.allowedHosts)
    if (outcome !== null) {
      update.checkResult = outcomeToResult(outcome)
      update.checkedAt = new Date()
    }
  }
  await db
    .update(projectServices)
    .set(update)
    .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
  return summaryOf(db, projectId, slug)
}

export async function retestService(projectId: string, slug: string): Promise<ServiceSummary | null> {
  const service = await findService(db, projectId, slug)
  if (!service) return null
  const outcome = await checkService(
    service.definition,
    await serviceCredentials(db, projectId, slug),
    service.approvedHosts,
  )
  if (outcome !== null) {
    await db
      .update(projectServices)
      .set({ checkResult: outcomeToResult(outcome), checkedAt: new Date() })
      .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
  }
  return summaryOf(db, projectId, slug)
}

export async function saveRefreshToken(projectId: string, slug: string, refreshToken: string): Promise<void> {
  await db.transaction(async (tx) => {
    const service = await findService(tx, projectId, slug)
    if (!service) return
    const stored = { kind: "oauth_token" as const, value: seal(refreshToken), hint: null }
    await tx
      .insert(projectCredentials)
      .values({ projectId, name: refreshTokenName(slug), serviceSlug: slug, ...stored })
      .onConflictDoUpdate({
        target: [projectCredentials.projectId, projectCredentials.name],
        set: { ...stored, updatedAt: new Date() },
        setWhere: eq(projectCredentials.serviceSlug, slug),
      })
    await tx
      .update(projectServices)
      .set({ approvedHosts: service.definition.allowedHosts, checkResult: "ok", checkedAt: new Date() })
      .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
  })
}

export async function loadServiceSecrets(
  projectId: string,
  slug: string,
): Promise<{ definition: ServiceDefinition; approvedHosts: string[]; values: Record<string, string> } | null> {
  const service = await findService(db, projectId, slug)
  if (!service) return null
  return {
    definition: service.definition,
    approvedHosts: service.approvedHosts,
    values: readValues(await serviceCredentials(db, projectId, slug)),
  }
}

export async function removeServiceValues(projectId: string, slug: string): Promise<void> {
  if (slug === SYSTEM_SERVICE_SLUG) return
  await db.transaction(async (tx) => {
    await tx
      .delete(projectCredentials)
      .where(and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.serviceSlug, slug)))
    await tx
      .update(projectServices)
      .set({ approvedHosts: [], checkResult: null, checkedAt: null })
      .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
  })
}

export async function removeService(projectId: string, slug: string): Promise<void> {
  if (slug === SYSTEM_SERVICE_SLUG) return
  await db.delete(projectServices).where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
}

export async function copyServiceDefinitions(tx: Transaction, fromProjectId: string, toProjectId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(projectServices)
    .where(and(eq(projectServices.projectId, fromProjectId), ne(projectServices.slug, SYSTEM_SERVICE_SLUG)))
  if (rows.length === 0) return
  await tx.insert(projectServices).values(
    rows.map((row) => ({
      projectId: toProjectId,
      slug: row.slug,
      definition: row.definition,
      approvedHosts: [],
      checkResult: null,
      checkedAt: null,
    })),
  )
}
