import { NextResponse } from "next/server"

import { PLANS } from "@/lib/plans"
import { PublishBlockedError, getPublishStatus, listBuilds, startBuild } from "@/lib/publish/builds"
import { ExpoError } from "@/lib/publish/expo"
import { APP_BUILD_FORMATS, VERSION_PATTERN, type AppBuildFormat } from "@/lib/publish-protocol"
import { ExportUnavailableError, getProjectAccess } from "@/lib/project-access"
import { errorResponse, serverT, type ErrorKey } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

// Only sending the project to Expo happens in this request, which takes seconds. The build itself runs on EAS.
export const maxDuration = 300

type Context = { params: Promise<{ projectId: string }> }

function error(key: ErrorKey, status: number, code?: string) {
  return errorResponse(key, status, { code })
}

/** Publishing uses the owner's Expo account, so only the owner can do it. */
async function ownedProject({ params }: Context) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: await error("signInRequired", 401) }
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return { failure: await error("projectNotFound", 404) }
  return { user, project: access.project }
}

/** Where publishing stands. With `?only=builds` it answers with just the builds, for polling. */
export async function GET(request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  const t = await serverT("errors")
  try {
    if (new URL(request.url).searchParams.get("only") === "builds") {
      return NextResponse.json({ builds: await listBuilds(owned.project.id, owned.user.id, t) })
    }
    return NextResponse.json(await getPublishStatus(owned.project, owned.user.id, t))
  } catch (cause) {
    console.error("Reading publish status failed", cause)
    return error("buildsCheckFailed", 500)
  }
}

/** Starts a build, and returns as soon as Expo has it. */
export async function POST(request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  if (!PLANS[owned.user.plan].nativePublish) return error("nativePublishLocked", 403, "native-publish")

  const body = (await request.json().catch(() => null)) as { format?: unknown; version?: unknown } | null
  if (!APP_BUILD_FORMATS.includes(body?.format as AppBuildFormat)) return error("chooseFileType", 400)
  const version = typeof body?.version === "string" ? body.version.trim() : ""
  if (!VERSION_PATTERN.test(version)) return error("versionFormat", 400)

  const t = await serverT("errors")
  try {
    return NextResponse.json(await startBuild(owned.project, owned.user.id, body?.format as AppBuildFormat, version, t))
  } catch (cause) {
    if (cause instanceof PublishBlockedError) return NextResponse.json({ error: cause.translate(t), code: cause.code }, { status: cause.status })
    if (cause instanceof ExportUnavailableError) return NextResponse.json({ error: cause.translate(t) }, { status: 409 })
    if (cause instanceof ExpoError) return NextResponse.json({ error: cause.translate(t) }, { status: 502 })
    console.error("Starting a build failed", cause)
    return error("buildStartFailed", 500)
  }
}
