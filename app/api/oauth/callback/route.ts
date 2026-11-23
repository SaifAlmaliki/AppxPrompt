import { NextResponse, type NextRequest } from "next/server"

import { getProjectAccess } from "@/lib/project-access"
import { exchangeCode } from "@/lib/services/check"
import { OAUTH_STATE_COOKIE, parseOAuthState, sameState } from "@/lib/services/oauth"
import { oauthRedirectUri, type ServiceConnectResult } from "@/lib/services/protocol"
import { unapprovedHosts } from "@/lib/services/rules"
import { loadServiceSecrets, saveRefreshToken } from "@/lib/services/store"
import { getCurrentUser } from "@/lib/session"

/**
 * Where the service returns the browser. The project and service come from this
 * browser's own cookie, never from the URL. The code and token never go in the redirect.
 */
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const { searchParams } = request.nextUrl
  const saved = parseOAuthState(request.cookies.get(OAUTH_STATE_COOKIE)?.value)

  const back = (path: string) => {
    const response = NextResponse.redirect(new URL(path, appUrl))
    response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/oauth" })
    return response
  }
  if (!saved) return back("/")

  const { projectId, slug, verifier } = saved
  const finish = (result: ServiceConnectResult) =>
    back(`/workspace/${projectId}?service=${encodeURIComponent(slug)}&serviceResult=${result}`)

  const state = searchParams.get("state")
  if (!state || !sameState(saved.state, state)) return finish("error")

  const user = await getCurrentUser().catch(() => null)
  if (!user) return back("/")
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return finish("error")

  if (searchParams.get("error") === "access_denied") return finish("denied")
  const code = searchParams.get("code")
  if (!code) return finish("error")

  try {
    const stored = await loadServiceSecrets(projectId, slug)
    const oauth = stored?.definition.oauth
    if (!stored || stored.definition.authKind !== "oauth2" || !oauth) return finish("error")
    if (unapprovedHosts(stored.definition, stored.approvedHosts).length > 0) return finish("error")
    const clientId = stored.values[oauth.clientIdField]
    const clientSecret = stored.values[oauth.clientSecretField]
    if (!clientId || !clientSecret) return finish("error")

    const exchanged = await exchangeCode({
      definition: stored.definition,
      clientId,
      clientSecret,
      code,
      verifier,
      redirectUri: oauthRedirectUri(request.nextUrl.origin),
    })
    if ("error" in exchanged) return finish(exchanged.error === "no_refresh_token" ? "no_refresh_token" : "error")
    await saveRefreshToken(projectId, slug, exchanged.refreshToken)
    return finish("connected")
  } catch {
    console.error("Connecting a service failed")
    return finish("error")
  }
}
