import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { disconnectProject, getBackendStatus, linkProject } from "@/lib/cloudhike/backend"
import { errorResponse, serverT, type ErrorKey } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function error(key: ErrorKey, status: number) {
  return errorResponse(key, status)
}

async function ownedProject(projectId: string) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: await error("signInRequired", 401) }
  if (!UUID_PATTERN.test(projectId)) return { failure: await error("projectNotFound", 404) }
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return { failure: await error("projectNotFound", 404) }
  return { project, user }
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project, user } = await ownedProject((await params).projectId)
  if (failure) return failure
  return NextResponse.json(await getBackendStatus(project.id, user.id, await serverT("errors")))
}

/** Connects this app to the CloudHike account the person already connected for another app. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project, user } = await ownedProject((await params).projectId)
  if (failure) return failure
  const t = await serverT("errors")
  const status = await getBackendStatus(project.id, user.id, t)
  if (!status.accountConnected) return error("connectCloudHikeFirst", 409)
  await linkProject(project.id)
  return NextResponse.json(await getBackendStatus(project.id, user.id, t))
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project, user } = await ownedProject((await params).projectId)
  if (failure) return failure
  const t = await serverT("errors")
  const status = await getBackendStatus(project.id, user.id, t)
  if (status.state === "provisioning") return error("backendBusy", 409)
  await disconnectProject(project.id, user.id)
  return NextResponse.json(await getBackendStatus(project.id, user.id, t))
}
