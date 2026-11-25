// What the preview does for the app's server functions. The app's `lib/server/config.ts`
// is replaced by a view of it that reads the sandbox token the workspace sent, so renewing
// the token never rebuilds the app, and a frame that can't be used (the canvas) never has one.

import type { FrameMessage } from "@/lib/preview-protocol"

import { postToHost } from "./host"

let sandboxToken = ""
let interactive = false

/** The token the workspace sent for this frame. "" means none. It's never put in a URL or logged. */
export function setSandboxToken(token: string) {
  sandboxToken = typeof token === "string" ? token : ""
}

export function setServerInteractive(value: boolean) {
  interactive = value
}

/** Both exports are read on every call. A frame that isn't interactive always reads "", so `callServer` fails with `preview` before it sends anything. */
export function previewServerConfig(file: { SERVER_BASE_URL: string; SERVER_TOKEN: string | null }) {
  return Object.defineProperties(
    {},
    {
      SERVER_BASE_URL: { enumerable: true, get: () => file.SERVER_BASE_URL },
      SERVER_TOKEN: { enumerable: true, get: () => (interactive ? sandboxToken || file.SERVER_TOKEN || "" : "") },
    }
  ) as { readonly SERVER_BASE_URL: string; readonly SERVER_TOKEN: string | null }
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

function isUnder(url: string, base: string) {
  if (!url.startsWith(base)) return false
  const next = url.charAt(base.length)
  return next === "" || next === "/" || next === "?" || next === "#"
}

async function notConnectedService(response: Response) {
  const body = await response.clone().json()
  const error = body?.error
  return error?.code === "not_connected" && typeof error.service === "string" ? (error.service as string) : null
}

/** Wraps `fetch` to tell the workspace when a server function says its service isn't connected. The response itself is never changed. */
export function watchServerResponses(
  fetchImpl: typeof fetch,
  baseUrl: () => string | null,
  post: (message: FrameMessage) => void = postToHost
): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init)
    if (interactive && response.status === 503) {
      const base = baseUrl()?.replace(/\/+$/, "")
      if (base && isUnder(requestUrl(input), base)) {
        notConnectedService(response)
          .then((slug) => {
            if (slug && interactive) post({ type: "service-needed", slug })
          })
          .catch(() => {})
      }
    }
    return response
  }
}
