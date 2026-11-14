import { NextResponse } from "next/server"

import { disconnectGitHub } from "@/lib/github/projects"
import { errorResponse } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

/** Disconnects the signed-in person's GitHub account. What they already pushed stays on GitHub. */
export async function DELETE() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return errorResponse("signInRequired", 401)

  try {
    await disconnectGitHub(user.id)
    return NextResponse.json({ ok: true })
  } catch (cause) {
    console.error("Disconnecting GitHub failed", cause)
    return errorResponse("githubDisconnectFailed", 500)
  }
}
