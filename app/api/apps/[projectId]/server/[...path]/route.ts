import { after } from "next/server"

import { createServerProxy, sandboxPreflight } from "@/lib/sandbox/proxy"
import { recordServerCall } from "@/lib/server-routes/activity"

// A first call can start the VM (and restart it once), so this is as long as the plan allows. The runner stops waiting before it.
export const maxDuration = 300

const proxy = createServerProxy({ onCall: (call) => after(() => recordServerCall(call)) })

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy

export function OPTIONS() {
  return sandboxPreflight()
}
