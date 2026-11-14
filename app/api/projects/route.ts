import { NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"

import { db, messages, projectAssets, projects } from "@/db"
import { assertCanUseAgent, assertProjectSlot, claimProjectSlot, hasProjectSlot, PlanLimitError, planLimitResponse } from "@/lib/billing/credits"
import { requestLocale } from "@/i18n/request"
import { detectChatLanguage } from "@/lib/i18n/chat-language"
import { errorResponse, serverT, type ErrorKey, type ErrorValues } from "@/lib/i18n/server"
import { LAST_EDITED, SUMMARY_COLUMNS, toProjectSummary } from "@/lib/project-summaries"
import {
  isAcceptedAsset,
  isProjectPlatform,
  MAX_ASSET_SIZE,
  MAX_ASSETS,
  MAX_PROMPT_LENGTH,
  projectNameFromPrompt,
} from "@/lib/projects"
import { getCurrentUser } from "@/lib/session"
import { deleteObjects, safeFileName, uploadObject } from "@/lib/storage"

function badRequest(key: ErrorKey, values?: ErrorValues) {
  return errorResponse(key, 400, {}, values)
}

/** The signed-in person's own projects, most recently edited first. */
export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return errorResponse("signInRequired", 401)

  const rows = await db
    .select({ ...SUMMARY_COLUMNS, prompt: projects.prompt })
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(LAST_EDITED))

  return NextResponse.json({
    projects: rows.map((row) => toProjectSummary({ ...row, tagline: row.tagline ?? row.prompt }, "owner", null)),
  })
}

/**
 * Creates a project from the composer: uploads the attached assets to storage,
 * then saves the project, its first message, and its assets in one transaction.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser().catch((error) => {
    console.error("Session lookup failed", error)
    return null
  })
  if (!user) return errorResponse("signInToCreate", 401)

  const t = await serverT("errors")

  // Before anything is uploaded.
  try {
    assertProjectSlot(await hasProjectSlot(user.id, user.plan), user.plan, t)
    assertCanUseAgent(user.credits, t)
  } catch (error) {
    if (error instanceof PlanLimitError) return planLimitResponse(error)
    throw error
  }

  const form = await request.formData().catch(() => null)
  if (!form) return badRequest("invalidRequest")

  const prompt = String(form.get("prompt") ?? "").trim()
  if (!prompt) return badRequest("describeApp")
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return badRequest("promptTooLong", { max: MAX_PROMPT_LENGTH })
  }

  const platform = form.get("platform")
  if (!isProjectPlatform(platform)) return badRequest("choosePlatform")

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length > MAX_ASSETS) return badRequest("attachLimit", { max: MAX_ASSETS })
  for (const file of files) {
    if (file.size > MAX_ASSET_SIZE) return badRequest("fileTooLarge", { name: file.name })
    if (!isAcceptedAsset(file.name, file.type)) {
      return badRequest("fileUnsupported", { name: file.name })
    }
  }

  const chatLanguage = detectChatLanguage(prompt, await requestLocale())
  const projectId = crypto.randomUUID()
  const assets = files.map((file) => ({
    file,
    storageKey: `users/${user.id}/projects/${projectId}/assets/${crypto.randomUUID()}-${safeFileName(file.name)}`,
    contentType: file.type || "application/octet-stream",
  }))

  const uploads = await Promise.allSettled(
    assets.map(async (asset) =>
      uploadObject(asset.storageKey, new Uint8Array(await asset.file.arrayBuffer()), asset.contentType)
    )
  )
  const uploadedKeys = assets
    .filter((_, i) => uploads[i].status === "fulfilled")
    .map((asset) => asset.storageKey)

  if (uploadedKeys.length < assets.length) {
    console.error(
      "Asset upload failed",
      uploads.find((u): u is PromiseRejectedResult => u.status === "rejected")?.reason
    )
    await deleteObjects(uploadedKeys).catch(() => {})
    return errorResponse("uploadFailed", 502)
  }

  try {
    const project = await db.transaction(async (tx) => {
      await claimProjectSlot(tx, user.id, t)
      const [created] = await tx
        .insert(projects)
        .values({
          id: projectId,
          userId: user.id,
          title: projectNameFromPrompt(prompt),
          prompt,
          platform,
          chatLanguage,
        })
        .returning({ id: projects.id, status: projects.status })

      await tx.insert(messages).values({ projectId, role: "user", content: prompt })

      if (assets.length > 0) {
        await tx.insert(projectAssets).values(
          assets.map((asset) => ({
            projectId,
            storageKey: asset.storageKey,
            fileName: asset.file.name,
            contentType: asset.contentType,
            size: asset.file.size,
          }))
        )
      }
      return created
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    // Don't leave orphaned files behind when the project wasn't saved.
    await deleteObjects(uploadedKeys).catch(() => {})
    if (error instanceof PlanLimitError) return planLimitResponse(error)
    console.error("Project creation failed", error)
    return errorResponse("createFailed", 500)
  }
}
