import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, projects, screens } from "@/db"
import { componentFilePath } from "@/lib/agent-protocol"
import { activeBuild } from "@/lib/agent/builds"
import { mergePlan } from "@/lib/agent/changes"
import { getRun } from "@/lib/agent/runs"
import { componentImportProblem, fatalScreenProblem, screenImportProblem } from "@/lib/agent/validate-screen"
import { errorResponse, type ErrorKey, type ErrorValues } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_FILE_LENGTH = 200_000

function error(key: ErrorKey, status: number, values?: ErrorValues) {
  return errorResponse(key, status, {}, values)
}

/**
 * Saves a screen or shared component the person edited by hand. `previous` is the
 * code they edited, so an edit never overwrites a newer version from the agent.
 */
export async function PUT(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    return await saveFile(request, context)
  } catch (cause) {
    console.error("Saving an edited file failed", cause)
    return error("saveEditFailed", 500)
  }
}

async function saveFile(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("signInRequired", 401)
  if (!UUID_PATTERN.test(projectId)) return error("projectNotFound", 404)

  const body = (await request.json().catch(() => null)) as { path?: unknown; code?: unknown; previous?: unknown } | null
  const { path, code, previous } = body ?? {}
  if (typeof path !== "string" || typeof code !== "string" || typeof previous !== "string") return error("invalidRequest", 400)
  if (code.length > MAX_FILE_LENGTH) return error("fileTooBigToSave", 400)

  const [project] = await db
    .select({ id: projects.id, plan: projects.plan, status: projects.status })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project?.plan) return error("projectNotFound", 404)
  if (project.status === "building" || getRun(project.id) || (await activeBuild(project.id))) {
    return error("agentBusyEdit", 409)
  }

  const problem = fatalScreenProblem(code)
  if (problem) return error("editRejected", 422, { problem })

  const library = project.plan.components ?? []
  const component = library.find((other) => componentFilePath(other.name) === path)
  // Only what this edit adds counts. An import the file already had shouldn't stop every edit to it.
  const newProblem = (check: (code: string) => string | null) => {
    const problem = check(code)
    return problem !== check(previous) ? problem : null
  }

  if (component) {
    const earlier = library.slice(0, library.indexOf(component)).map((other) => other.name)
    const unknown = newProblem((file) => componentImportProblem(file, earlier))
    if (unknown) return error("editRejected", 422, { problem: unknown })
    if (component.code !== previous) return error("fileChanged", 409)
    await mergePlan(project.id, { components: library.map((other) => (other === component ? { ...other, code } : other)) })
    return NextResponse.json({ ok: true })
  }

  const names = library.map((other) => other.name)
  const unknown = newProblem((file) => screenImportProblem(file, names))
  if (unknown) return error("editRejected", 422, { problem: unknown })
  const saved = await db
    .update(screens)
    .set({ code })
    .where(and(eq(screens.projectId, project.id), eq(screens.filePath, path), eq(screens.code, previous)))
    .returning({ id: screens.id })
  if (saved.length === 0) return error("fileChanged", 409)
  return NextResponse.json({ ok: true })
}
