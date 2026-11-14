import { NextResponse } from "next/server"

import { PublishBlockedError } from "@/lib/publish/builds"
import { ExpoError } from "@/lib/publish/expo"
import { getWebPublish, startWebPublish } from "@/lib/publish/web"
import { ExportUnavailableError, getProjectAccess } from "@/lib/project-access"
import { errorResponse, serverT, type ErrorKey } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

// Only sending the project to Expo happens in this request, which takes seconds. The deploy itself runs on EAS.
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

/** Where the project's website stands. `web` is null until its first publish. */
export async function GET(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  try {
    return NextResponse.json({ web: await getWebPublish(owned.project.id, owned.user.id, await serverT("errors")) })
  } catch (cause) {
    console.error("Reading the website's status failed", cause)
    return error("websiteCheckFailed", 500)
  }
}

/** Publishes or updates the website, and returns as soon as Expo has the app. */
export async function POST(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  const t = await serverT("errors")
  try {
    return NextResponse.json({ web: await startWebPublish(owned.project, owned.user.id, t) })
  } catch (cause) {
    if (cause instanceof PublishBlockedError) return NextResponse.json({ error: cause.translate(t), code: cause.code }, { status: cause.status })
    if (cause instanceof ExportUnavailableError) return NextResponse.json({ error: cause.translate(t) }, { status: 409 })
    if (cause instanceof ExpoError) return NextResponse.json({ error: cause.translate(t) }, { status: 502 })
    console.error("Publishing the website failed", cause)
    return error("publishStartFailed", 500)
  }
}
