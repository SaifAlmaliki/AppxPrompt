import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, messages, projects } from "@/db"
import { activeBuild } from "@/lib/agent/builds"
import { getRun } from "@/lib/agent/runs"
import { errorResponse, type ErrorKey } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function error(key: ErrorKey, status: number) {
  return errorResponse(key, status)
}

/** Starts a new chat session: the conversation so far is archived, and the app and its plan stay as they are. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("signInRequired", 401)
  if (!UUID_PATTERN.test(projectId)) return error("projectNotFound", 404)

  const [project] = await db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return error("projectNotFound", 404)

  if (project.status === "building" || getRun(project.id) || (await activeBuild(project.id))) {
    return error("agentBusy", 409)
  }

  await db.update(messages).set({ archived: true }).where(eq(messages.projectId, project.id))
  return NextResponse.json({ ok: true })
}
