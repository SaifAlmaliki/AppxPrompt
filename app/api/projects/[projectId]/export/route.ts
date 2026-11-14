import { NextResponse } from "next/server"
import { strToU8, zipSync } from "fflate"

import { ExportUnavailableError, getProjectAccess, loadProjectExport } from "@/lib/project-access"
import { errorResponse, serverT, type ErrorKey } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

function error(key: ErrorKey, status: number) {
  return errorResponse(key, status)
}

/** Downloads the complete Expo project as a ZIP. Everyone the project is shared with can do this. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("signInRequired", 401)

  try {
    const access = await getProjectAccess(projectId, user.id)
    if (!access) return error("projectNotFound", 404)

    const { slug, files } = await loadProjectExport(access.project)
    const archive = zipSync(Object.fromEntries(files.map((file) => [`${slug}/${file.path}`, strToU8(file.content)])))
    return new NextResponse(Buffer.from(archive), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slug}.zip"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (cause) {
    if (cause instanceof ExportUnavailableError) return NextResponse.json({ error: cause.translate(await serverT("errors")) }, { status: 409 })
    console.error("Exporting a project failed", cause)
    return error("exportFailed", 500)
  }
}
