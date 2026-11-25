import { NextResponse } from "next/server"

import { errorResponse } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import { listServerCalls } from "@/lib/server-routes/activity"
import { getCurrentUser } from "@/lib/session"

type Context = { params: Promise<{ projectId: string }> }

/** Only the owner sees how their app's server functions were called. */
export async function GET(_request: Request, { params }: Context) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return await errorResponse("signInRequired", 401)
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return await errorResponse("projectNotFound", 404)
  return NextResponse.json({ calls: await listServerCalls(access.project.id) }, { headers: { "cache-control": "no-store" } })
}
