// Native builds of generated apps. Nothing is built here: this hands the project to EAS,
// and then reads how it's going whenever someone looks. Server only.

import { createHash } from "node:crypto"
import { and, desc, eq, inArray, lt } from "drizzle-orm"

import { appBuilds, db, expoConnections, projectPublishing, type AppBuild, type Project } from "@/db"
import { seal, unseal } from "@/lib/cloudhike/crypto"
import { buildWorkflow, EAS_JSON } from "@/lib/generated-app/build-files"
import { projectSlug, storeIdentifier } from "@/lib/generated-app/export-project"
import {
  ensureAndroidKeystore,
  ensureExpoApp,
  ExpoError,
  expoAccountName,
  hasIosCredentials,
  readWorkflowRun,
  startWorkflowRun,
  type WorkflowRunState,
} from "@/lib/publish/expo"
import { LocalizedError, type ErrorKey, type ErrorValues, type Translator } from "@/lib/i18n/server"
import { applicationFailure, failureText, storeFailure, type PublishFailure } from "@/lib/publish/errors"
import { projectTarball } from "@/lib/publish/tarball"
import {
  FORMAT_PLATFORM,
  type AppBuildFormat,
  type AppBuildSummary,
  type PublishErrorCode,
  type PublishResult,
  type PublishStatus,
} from "@/lib/publish-protocol"
import { ExportUnavailableError, loadProjectExport } from "@/lib/project-access"

/** However many browsers are polling, a build is only asked about this often. */
export const CHECK_EVERY_MS = 15 * 1000
/** Starting a build takes seconds, so one with no run after this long had its request die part way. */
export const NEVER_STARTED_AFTER_MS = 10 * 60 * 1000
const BUILDS_SHOWN = 5

/** Something stopping a build that the person can act on, as opposed to a build that failed. */
export class PublishBlockedError extends LocalizedError {
  constructor(
    key: ErrorKey,
    public code?: PublishErrorCode,
    public status = 400,
    values?: ErrorValues
  ) {
    super(key, values)
  }
}

export function isPublishAvailable() {
  return Boolean(process.env.CLOUDHIKE_ENCRYPTION_KEY)
}

function toSummary(build: AppBuild, t: Translator<"errors">): AppBuildSummary {
  return {
    id: build.id,
    platform: build.platform,
    format: build.format,
    version: build.version,
    status: build.status,
    easBuildId: build.easBuildId,
    artifactUrl: build.artifactUrl,
    error: failureText(build.error, t),
    createdAt: build.createdAt.toISOString(),
  }
}

/** Connects Expo. The token is checked first, then only ever kept encrypted. */
export async function connectExpo(userId: number, accessToken: string) {
  const accountName = await expoAccountName(accessToken)
  const values = { accessToken: seal(accessToken), accountName }
  await db.insert(expoConnections).values({ userId, ...values }).onConflictDoUpdate({ target: expoConnections.userId, set: values })
  return accountName
}

export async function disconnectExpo(userId: number) {
  await db.delete(expoConnections).where(eq(expoConnections.userId, userId))
}

export async function loadExpoConnection(userId: number) {
  const [connection] = await db.select().from(expoConnections).where(eq(expoConnections.userId, userId))
  return connection ?? null
}

async function latestBuilds(projectId: string) {
  return db.select().from(appBuilds).where(eq(appBuilds.projectId, projectId)).orderBy(desc(appBuilds.createdAt)).limit(BUILDS_SHOWN)
}

type BuildReport =
  | { status: "queued" | "building"; easBuildId?: string }
  | { status: "ready"; easBuildId?: string; artifactUrl: string }
  | { status: "failed"; easBuildId?: string; error: PublishFailure }

/** Only ever moves a build forward. A finished build stays as it finished. */
async function recordBuild(buildId: string, report: BuildReport) {
  await db
    .update(appBuilds)
    .set({
      status: report.status,
      ...(report.easBuildId ? { easBuildId: report.easBuildId } : {}),
      ...(report.status === "ready" ? { artifactUrl: report.artifactUrl, error: null } : {}),
      ...(report.status === "failed" ? { error: storeFailure(report.error) } : {}),
    })
    .where(and(eq(appBuilds.id, buildId), inArray(appBuilds.status, ["queued", "building"])))
}

/** What a workflow run means for the build. The EAS build's own answer wins, since it's the most specific. */
function reportFromRun(run: WorkflowRunState): BuildReport {
  const job = run.jobs.find((candidate) => candidate.turtleBuild) ?? run.jobs[0]
  const build = job?.turtleBuild ?? null
  const easBuildId = build?.id
  if (build?.status === "FINISHED") {
    const artifactUrl = build.artifacts?.applicationArchiveUrl ?? build.artifacts?.buildUrl
    if (artifactUrl) return { status: "ready", easBuildId, artifactUrl }
    return { status: "failed", easBuildId, error: applicationFailure("buildNoFile") }
  }
  if (build?.status === "CANCELED" || run.status === "CANCELED") return { status: "failed", easBuildId, error: applicationFailure("buildCancelled") }
  if (build?.status === "ERRORED" || run.status === "FAILURE") {
    const detail = [...(job?.errors ?? []), ...run.errors].find((error) => error.message)
    const message = build?.error?.message ?? detail?.message
    return { status: "failed", easBuildId, error: message != null ? { source: "provider", detail: message } : applicationFailure("buildErrored") }
  }
  return { status: build || run.status === "IN_PROGRESS" ? "building" : "queued", easBuildId }
}

/** The server holds a build's status, and it's brought up to date here, so nothing depends on a tab staying open. */
async function refreshBuilds(projectId: string, userId: number) {
  const due = await db
    .select()
    .from(appBuilds)
    .where(
      and(
        eq(appBuilds.projectId, projectId),
        inArray(appBuilds.status, ["queued", "building"]),
        lt(appBuilds.updatedAt, new Date(Date.now() - CHECK_EVERY_MS))
      )
    )
  if (due.length === 0) return
  const expo = await loadExpoConnection(userId)

  for (const build of due) {
    if (!build.easRunId) {
      if (Date.now() - build.createdAt.getTime() > NEVER_STARTED_AFTER_MS) {
        await recordBuild(build.id, { status: "failed", error: applicationFailure("buildNeverReached") })
      }
      continue
    }
    if (!expo) {
      await recordBuild(build.id, { status: "failed", error: applicationFailure("buildExpoDisconnected") })
      continue
    }
    try {
      await recordBuild(build.id, reportFromRun(await readWorkflowRun(unseal(expo.accessToken), build.easRunId)))
    } catch (cause) {
      if (cause instanceof ExpoError && cause.unauthorized) {
        await recordBuild(build.id, { status: "failed", error: applicationFailure("buildTokenRejected") })
      } else {
        // Only the network, most likely. The next look tries again.
        console.error(`Checking on app build ${build.id} failed`, cause)
      }
    }
  }
}

export async function listBuilds(projectId: string, userId: number, t: Translator<"errors">) {
  await refreshBuilds(projectId, userId)
  return (await latestBuilds(projectId)).map((build) => toSummary(build, t))
}

export async function getPublishStatus(project: Project, userId: number, t: Translator<"errors">): Promise<PublishStatus> {
  const [expo, [publishing], builds] = await Promise.all([
    loadExpoConnection(userId),
    db.select().from(projectPublishing).where(eq(projectPublishing.projectId, project.id)),
    listBuilds(project.id, userId, t),
  ])
  return {
    available: isPublishAvailable(),
    expo: expo ? { account: expo.accountName } : null,
    lastVersion: publishing?.version ?? null,
    builds,
  }
}

/**
 * The ids a project keeps for good. The app's name can change and two apps can share one, so
 * they come from the name once, plus the project's id, and are read from here ever after.
 */
export async function ensureIdentity(project: Project, easOwner: string, version: string) {
  const suffix = createHash("sha256").update(project.id).digest("hex").slice(0, 8)
  const slug = `${projectSlug(project.plan?.appName || project.title)}-${suffix}`
  const identifier = storeIdentifier(slug.slice(0, -suffix.length - 1), suffix)
  const [identity] = await db
    .insert(projectPublishing)
    .values({ projectId: project.id, slug, androidPackage: identifier, iosBundleIdentifier: identifier, version, easOwner })
    .onConflictDoUpdate({ target: projectPublishing.projectId, set: { version, easOwner } })
    .returning()
  return identity
}

export function friendlyStartError(cause: unknown, fallback: "buildStartFailed" | "publishStartFailed") {
  if (cause instanceof ExpoError && cause.key === "passthrough" && typeof cause.values?.message === "string") {
    return { source: "provider" as const, detail: cause.values.message }
  }
  if (cause instanceof ExpoError || cause instanceof ExportUnavailableError) return applicationFailure(cause.key, cause.values)
  return applicationFailure(fallback)
}

/** EAS reads the project id from the app's config. It's only needed for the build, so exports don't carry it. */
export function withProjectId(appJson: string, appId: string) {
  const config = JSON.parse(appJson) as { expo: { extra?: object } }
  config.expo.extra = { ...config.expo.extra, eas: { projectId: appId } }
  return `${JSON.stringify(config, null, 2)}\n`
}

/** Gets the app's project and signing key ready on EAS, sends it the app, and starts the build. It doesn't wait for the build. */
async function sendToExpo(project: Project, build: AppBuild, expoToken: string, easOwner: string, format: AppBuildFormat) {
  const identity = await ensureIdentity(project, easOwner, build.version)
  const { appId, accountId } = await ensureExpoApp(expoToken, identity.easOwner, identity.slug)
  if (FORMAT_PLATFORM[format] === "android") {
    await ensureAndroidKeystore(expoToken, identity.easOwner, identity.slug, identity.androidPackage)
  }

  // Loaded after the identity is saved, so the files carry it.
  const { files } = await loadProjectExport(project, { includeServer: true })
  const packageJson = files.find(({ path }) => path === "package.json")?.content ?? ""
  const tarball = projectTarball(files.map((file) => (file.path === "app.json" ? { ...file, content: withProjectId(file.content, appId) } : file)))
  return startWorkflowRun(expoToken, { appId, accountId, workflow: buildWorkflow(format), tarball, easJson: EAS_JSON, packageJson })
}

/** Saves the build and starts it on EAS. */
export async function startBuild(project: Project, userId: number, format: AppBuildFormat, version: string, t: Translator<"errors">): Promise<PublishResult> {
  const platform = FORMAT_PLATFORM[format]
  if (project.platform !== "ios-android" && project.platform !== platform) {
    throw new PublishBlockedError("platformOnly", undefined, 400, { platform: project.platform })
  }
  if (!isPublishAvailable()) throw new PublishBlockedError("publishUnavailable")

  const expo = await loadExpoConnection(userId)
  if (!expo) throw new PublishBlockedError("expoConnectFirst", "expo")

  // Finds problems the person can fix, such as the agent still working, before a build exists to fail.
  await loadProjectExport(project, { includeServer: true })
  const expoToken = unseal(expo.accessToken)

  if (platform === "ios") {
    const [existing] = await db.select().from(projectPublishing).where(eq(projectPublishing.projectId, project.id))
    const identity = existing ?? (await ensureIdentity(project, expo.accountName, version))
    const ready = await hasIosCredentials(expoToken, identity.easOwner, identity.slug, identity.iosBundleIdentifier).catch((cause) => {
      if (cause instanceof ExpoError && cause.unauthorized) throw new PublishBlockedError(cause.key, "expo", 400, cause.values)
      throw cause
    })
    if (!ready) return { iosSetup: { account: identity.easOwner, slug: identity.slug, bundleIdentifier: identity.iosBundleIdentifier } }
  }

  const [build] = await db
    .insert(appBuilds)
    .values({ projectId: project.id, userId, platform, format, version })
    .onConflictDoNothing()
    .returning()
  if (!build) throw new PublishBlockedError("buildRunning", undefined, 409)

  // This build replaces any failed attempts at the same file, so their errors don't linger.
  await db.delete(appBuilds).where(and(eq(appBuilds.projectId, project.id), eq(appBuilds.format, format), eq(appBuilds.status, "failed")))

  try {
    const easRunId = await sendToExpo(project, build, expoToken, expo.accountName, format)
    const [started] = await db.update(appBuilds).set({ easRunId }).where(eq(appBuilds.id, build.id)).returning()
    return { build: toSummary(started, t) }
  } catch (cause) {
    console.error(`Starting app build ${build.id} failed`, cause)
    await recordBuild(build.id, { status: "failed", error: friendlyStartError(cause, "buildStartFailed") })
    const [failed] = await db.select().from(appBuilds).where(eq(appBuilds.id, build.id))
    return { build: toSummary(failed, t) }
  }
}
