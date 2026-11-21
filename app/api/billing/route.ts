import { NextResponse } from "next/server"

import { BillingError, createCheckoutUrl, createPortalUrl, createTopupCheckoutUrl, setDowngrade } from "@/lib/billing/stripe"
import { isTopupId } from "@/lib/plans"
import { errorResponse, serverT, type ErrorKey } from "@/lib/i18n/server"
import { getCurrentUser } from "@/lib/session"

function error(key: ErrorKey, status: number) {
  return errorResponse(key, status)
}

/**
 * Changes the signed-in person's plan: `upgrade` and `manage` answer with a page
 * to send them to, and `downgrade` and `keep-pro` apply straight away.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("signInRequired", 401)

  const body = (await request.json().catch(() => null)) as { action?: unknown; pack?: unknown } | null
  try {
    switch (body?.action) {
      case "upgrade":
        return NextResponse.json({ url: await createCheckoutUrl(user.id) })
      case "topup":
        if (!isTopupId(body.pack)) return error("invalidRequest", 400)
        return NextResponse.json({ url: await createTopupCheckoutUrl(user.id, body.pack) })
      case "manage":
        return NextResponse.json({ url: await createPortalUrl(user.id) })
      case "downgrade":
        await setDowngrade(user.id, true)
        return NextResponse.json({ ok: true })
      case "keep-pro":
        await setDowngrade(user.id, false)
        return NextResponse.json({ ok: true })
      default:
        return error("invalidRequest", 400)
    }
  } catch (cause) {
    if (cause instanceof BillingError) return NextResponse.json({ error: cause.translate(await serverT("errors")) }, { status: cause.status })
    console.error("Changing a plan failed", cause)
    return error("paymentProviderFailed", 502)
  }
}
