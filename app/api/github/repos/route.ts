import { NextResponse } from "next/server"

import { GitHubError } from "@/lib/github/client"
import { listRepositories } from "@/lib/github/projects"
import { errorResponse, serverT } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

/** The repositories the signed-in person can push to. */
export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return errorResponse("signInRequired", 401)

  try {
    return NextResponse.json({ repositories: await listRepositories(user.id) })
  } catch (cause) {
    if (cause instanceof GitHubError) {
      return NextResponse.json({ error: cause.translate(await serverT("errors")), code: cause.code }, { status: cause.code === "reauth" ? 401 : 502 })
    }
    console.error("Listing GitHub repositories failed", cause)
    return errorResponse("reposLoadFailed", 500)
  }
}
