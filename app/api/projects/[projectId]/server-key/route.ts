import { NextResponse } from "next/server"

import { errorResponse } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import { integrationsEnabled } from "@/lib/services/flags"
import { rotateServerKey } from "@/lib/services/server-key"
import { getCurrentUser } from "@/lib/session"

/** Gives the app's server functions a new key for reaching its data. Only the owner can. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return errorResponse("signInRequired", 401)
  if (!integrationsEnabled()) return errorResponse("projectNotFound", 404)

  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return errorResponse("projectNotFound", 404)

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null
  if (body?.action !== "rotate") return errorResponse("invalidRequest", 400)

  try {
    await rotateServerKey(access.project.id)
  } catch (cause) {
    console.error("Resetting the server key failed", cause)
    return errorResponse("serverKeyResetFailed", 500)
  }
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } })
}
