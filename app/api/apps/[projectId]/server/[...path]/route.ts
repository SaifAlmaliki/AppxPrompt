import { createServerProxy, sandboxPreflight } from "@/lib/sandbox/proxy"

export const maxDuration = 60

const proxy = createServerProxy()

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy

export function OPTIONS() {
  return sandboxPreflight()
}
