import { NextResponse } from "next/server"

import { errorResponse } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import { integrationsEnabled } from "@/lib/services/flags"
import { sandboxAllowedFor } from "@/lib/sandbox/allowed"
import { createSandboxToken, sandboxTokenExpiry } from "@/lib/sandbox/token"
import { getCurrentUser } from "@/lib/session"

/** Gives the owner's preview a short-lived pass to call the project's server functions. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return errorResponse("signInRequired", 401)
  if (!integrationsEnabled() || !sandboxAllowedFor(user.id)) return errorResponse("projectNotFound", 404)

  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return errorResponse("projectNotFound", 404)

  const token = createSandboxToken(projectId, user.id)
  return NextResponse.json({ token, expiresAt: sandboxTokenExpiry(token) }, { headers: { "cache-control": "no-store" } })
}
