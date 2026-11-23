// The services a project uses and the values saved for them. Server only, and the
// only module that reads or writes these tables. Secrets are sealed here and only
// leave through `loadServiceSecrets`; everything else returns a `ServiceSummary`.

import { and, asc, eq, notInArray } from "drizzle-orm"

import { db, projectCredentials, projectServices } from "@/db"
import { seal, unseal } from "@/lib/cloudhike/crypto"
import { refreshAccessToken, runCheck, type CheckOutcome } from "@/lib/services/check"
import { refreshTokenName } from "@/lib/services/protocol"
import type { CheckResult, ServiceDefinition, ServiceSummary } from "@/lib/services/protocol"
import { credentialHint, summarizeService, type StoredCredential } from "@/lib/services/status"

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

async function findService(executor: Executor, projectId: string, slug: string): Promise<ServiceRow | null> {
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

/** Checks the saved values against the service. Null means there was nothing complete to check. */
async function checkService(definition: ServiceDefinition, rows: CredentialRow[]): Promise<CheckOutcome | null> {
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
    db.select().from(projectServices).where(eq(projectServices.projectId, projectId)).orderBy(asc(projectServices.createdAt)),
    db.select().from(projectCredentials).where(eq(projectCredentials.projectId, projectId)),
  ])
  return services.map((service) => toSummary(service, credentials))
}

export async function registerService(projectId: string, definition: ServiceDefinition): Promise<ServiceSummary> {
  return db.transaction(async (tx) => {
    await tx
      .insert(projectServices)
      .values({ projectId, slug: definition.slug, definition })
      .onConflictDoUpdate({
        target: [projectServices.projectId, projectServices.slug],
        set: { definition },
      })
    const keep = definition.fields.map((field) => field.name)
    if (definition.authKind === "oauth2") keep.push(refreshTokenName(definition.slug))
    const owned = and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.serviceSlug, definition.slug))
    await tx
      .delete(projectCredentials)
      .where(keep.length > 0 ? and(owned, notInArray(projectCredentials.name, keep)) : owned)
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
      .onConflictDoUpdate({ target: [projectCredentials.projectId, projectCredentials.name], set: stored })
  }
  const update: Partial<typeof projectServices.$inferInsert> = { approvedHosts: definition.allowedHosts }
  if (definition.authKind === "api_key") {
    const outcome = await checkService(definition, await serviceCredentials(db, projectId, slug))
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
  const outcome = await checkService(service.definition, await serviceCredentials(db, projectId, slug))
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
      .onConflictDoUpdate({ target: [projectCredentials.projectId, projectCredentials.name], set: stored })
    await tx
      .update(projectServices)
      .set({ approvedHosts: service.definition.allowedHosts, checkResult: "ok", checkedAt: new Date() })
      .where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
  })
}

export async function loadServiceSecrets(
  projectId: string,
  slug: string,
): Promise<{ definition: ServiceDefinition; values: Record<string, string> } | null> {
  const service = await findService(db, projectId, slug)
  if (!service) return null
  return { definition: service.definition, values: readValues(await serviceCredentials(db, projectId, slug)) }
}

export async function removeServiceValues(projectId: string, slug: string): Promise<void> {
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
  await db.delete(projectServices).where(and(eq(projectServices.projectId, projectId), eq(projectServices.slug, slug)))
}

export async function copyServiceDefinitions(tx: Transaction, fromProjectId: string, toProjectId: string): Promise<void> {
  const rows = await tx.select().from(projectServices).where(eq(projectServices.projectId, fromProjectId))
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
