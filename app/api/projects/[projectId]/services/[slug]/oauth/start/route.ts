import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import { errorResponse } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
  authorizationUrl,
  createPkce,
  encodeOAuthState,
} from "@/lib/services/oauth"
import { oauthRedirectUri, type ServiceConnectResult } from "@/lib/services/protocol"
import { loadServiceSecrets } from "@/lib/services/store"
import { getCurrentUser } from "@/lib/session"

/** Sends the owner's browser to the service to allow access, using the owner's own OAuth client. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; slug: string }> },
) {
  const { projectId, slug } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.redirect(new URL("/", request.url))

  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return errorResponse("projectNotFound", 404)

  const back = (result: ServiceConnectResult) =>
    NextResponse.redirect(
      new URL(`/workspace/${projectId}?service=${encodeURIComponent(slug)}&serviceResult=${result}`, request.url),
    )

  const stored = await loadServiceSecrets(projectId, slug).catch(() => null)
  const oauth = stored?.definition.oauth
  if (!stored || stored.definition.authKind !== "oauth2" || !oauth) return back("error")
  const clientId = stored.values[oauth.clientIdField]
  const clientSecret = stored.values[oauth.clientSecretField]
  if (!clientId || !clientSecret) return back("error")

  // Ties the callback to this browser, project and service.
  const state = randomBytes(32).toString("hex")
  const { verifier, challenge } = createPkce()
  const response = NextResponse.redirect(
    authorizationUrl(stored.definition, clientId, oauthRedirectUri(request.nextUrl.origin), state, challenge),
  )
  response.cookies.set(OAUTH_STATE_COOKIE, encodeOAuthState({ state, projectId, slug, verifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/oauth",
    maxAge: OAUTH_STATE_MAX_AGE,
  })
  return response
}
