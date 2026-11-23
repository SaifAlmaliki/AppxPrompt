import { NextResponse } from "next/server"

import { errorResponse } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import { listServiceSummaries } from "@/lib/services/store"
import { getCurrentUser } from "@/lib/session"

type Context = { params: Promise<{ projectId: string }> }

/** Only the owner sees or changes the services an app uses. */
async function ownedProject({ params }: Context) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: await errorResponse("signInRequired", 401) }
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return { failure: await errorResponse("projectNotFound", 404) }
  return { project: access.project }
}

export async function GET(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  return NextResponse.json({ services: await listServiceSummaries(owned.project.id) })
}
