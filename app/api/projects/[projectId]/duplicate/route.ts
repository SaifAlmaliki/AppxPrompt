import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"

import { db, messages, projectAssets, projects, screens } from "@/db"
import { activeBuild } from "@/lib/agent/builds"
import { assertProjectSlot, claimProjectSlot, hasProjectSlot, PlanLimitError, planLimitResponse } from "@/lib/billing/credits"
import { getRun } from "@/lib/agent/runs"
import { errorResponse, serverT, type ErrorKey } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import { MAX_PROJECT_NAME_LENGTH } from "@/lib/projects"
import { integrationsEnabled } from "@/lib/services/flags"
import { copyServiceDefinitions } from "@/lib/services/store"
import { getCurrentUser } from "@/lib/session"
import { copyObject, deleteObjects, safeFileName } from "@/lib/storage"

function error(key: ErrorKey, status: number) {
  return errorResponse(key, status)
}

/**
 * Copies a project with its chat, screens, and files, using no credits. The copy
 * starts private and without a backend, because the original's backend, website,
 * and repository stay the original's alone.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("signInRequired", 401)
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return error("projectNotFound", 404)
  const { project } = access
  const t = await serverT("errors")

  if (project.status === "building" || getRun(project.id) || (await activeBuild(project.id))) {
    return error("agentBusyDuplicate", 409)
  }

  try {
    assertProjectSlot(await hasProjectSlot(user.id, user.plan), user.plan, t)
  } catch (cause) {
    if (cause instanceof PlanLimitError) return planLimitResponse(cause)
    throw cause
  }

  const newId = crypto.randomUUID()
  const name = `${(project.plan?.appName || project.title).slice(0, MAX_PROJECT_NAME_LENGTH - 5)} copy`

  const [assetRows, messageRows, screenRows] = await Promise.all([
    db.select().from(projectAssets).where(eq(projectAssets.projectId, project.id)),
    db.select().from(messages).where(eq(messages.projectId, project.id)),
    db.select().from(screens).where(eq(screens.projectId, project.id)),
  ])

  const assets = assetRows.map((asset) => ({
    ...asset,
    newKey: `users/${user.id}/projects/${newId}/assets/${crypto.randomUUID()}-${safeFileName(asset.fileName)}`,
  }))
  const copies = await Promise.allSettled(assets.map((asset) => copyObject(asset.storageKey, asset.newKey)))
  const copiedKeys = assets.filter((_, i) => copies[i].status === "fulfilled").map((asset) => asset.newKey)

  if (copiedKeys.length < assets.length) {
    console.error(
      "Copying a project's files failed",
      copies.find((copy): copy is PromiseRejectedResult => copy.status === "rejected")?.reason
    )
    await deleteObjects(copiedKeys).catch(() => {})
    return error("copyFilesFailed", 502)
  }

  try {
    await db.transaction(async (tx) => {
      await claimProjectSlot(tx, user.id, t)
      await tx.insert(projects).values({
        id: newId,
        userId: user.id,
        title: name,
        prompt: project.prompt,
        platform: project.platform,
        chatLanguage: project.chatLanguage,
        status: project.status,
        plan: project.plan && { ...project.plan, appName: name, backend: null, pendingChanges: null },
      })
      if (integrationsEnabled()) await copyServiceDefinitions(tx, project.id, newId)
      if (messageRows.length > 0) {
        await tx.insert(messages).values(
          messageRows.map((message) => ({
            projectId: newId,
            role: message.role,
            content: message.content,
            plan: message.plan,
            handled: message.handled,
            archived: message.archived,
            // The chat is read in this order.
            createdAt: message.createdAt,
          }))
        )
      }
      if (screenRows.length > 0) {
        await tx.insert(screens).values(
          screenRows.map((screen) => ({
            projectId: newId,
            slug: screen.slug,
            name: screen.name,
            position: screen.position,
            status: screen.status,
            layout: screen.layout,
            filePath: screen.filePath,
            code: screen.code,
          }))
        )
      }
      if (assets.length > 0) {
        await tx.insert(projectAssets).values(
          assets.map((asset) => ({
            projectId: newId,
            storageKey: asset.newKey,
            fileName: asset.fileName,
            contentType: asset.contentType,
            size: asset.size,
          }))
        )
      }
    })
    return NextResponse.json({ id: newId }, { status: 201 })
  } catch (cause) {
    await deleteObjects(copiedKeys).catch(() => {})
    if (cause instanceof PlanLimitError) return planLimitResponse(cause)
    console.error("Duplicating a project failed", cause)
    return error("duplicateFailed", 500)
  }
}
