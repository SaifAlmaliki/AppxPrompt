// Who can open a project, and what can be exported from it. Server only.

import { and, asc, eq } from "drizzle-orm"

import { db, projectPublishing, projectShares, projects, screens, type Project } from "@/db"
import { toProjectScreen } from "@/lib/agent-protocol"
import { activeBuild } from "@/lib/agent/builds"
import { getRun } from "@/lib/agent/runs"
import { exportedProjectFiles, filesForRole, projectSlug, type ExportedFile } from "@/lib/generated-app/export-project"
import { LocalizedError } from "@/lib/i18n/server"

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ProjectRole = "owner" | "viewer"

/** The project and this person's role in it, or null if it's missing or not theirs to see. */
export async function getProjectAccess(projectId: string, userId: number): Promise<{ project: Project; role: ProjectRole } | null> {
  if (!UUID_PATTERN.test(projectId)) return null
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!project) return null
  if (project.userId === userId) return { project, role: "owner" }
  const [share] = await db
    .select({ userId: projectShares.userId })
    .from(projectShares)
    .where(and(eq(projectShares.projectId, projectId), eq(projectShares.userId, userId)))
  return share ? { project, role: "viewer" } : null
}

export type LoadedExport = {
  name: string
  slug: string
  files: ExportedFile[]
  /** What the person calls each screen, by file path. */
  screenNames: Record<string, string>
}

/** Thrown when the project can't be exported right now, with a reason the person can act on. */
export class ExportUnavailableError extends LocalizedError {}

/** `includeServer` is for the owner's flows: anyone else gets the app without its server code. */
export async function loadProjectExport(project: Project, options: { includeServer: boolean }): Promise<LoadedExport> {
  if (project.status === "building" || getRun(project.id) || (await activeBuild(project.id))) {
    throw new ExportUnavailableError("exportBusy")
  }
  const rows = await db.select().from(screens).where(eq(screens.projectId, project.id)).orderBy(asc(screens.position))
  const projectScreens = rows.map(toProjectScreen)
  if (!projectScreens.some((screen) => screen.code !== null)) {
    throw new ExportUnavailableError("exportEmpty")
  }
  const name = project.plan?.appName || project.title
  const [publishing] = await db.select().from(projectPublishing).where(eq(projectPublishing.projectId, project.id))
  return {
    name,
    slug: projectSlug(name),
    files: options.includeServer
      ? exportedProjectFiles(project, projectScreens, publishing)
      : filesForRole(exportedProjectFiles(project, projectScreens, publishing), "viewer"),
    screenNames: Object.fromEntries(projectScreens.map((screen) => [screen.filePath, screen.name])),
  }
}
