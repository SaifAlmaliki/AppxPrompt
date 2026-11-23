import { transform } from "sucrase"
import { apiRouteUrl } from "@/lib/agent-protocol"

export function compileServerFile(path: string, code: string) {
  return transform(code, { transforms: ["typescript", "imports"], filePath: path }).code
}

function requestSegments(path: string) {
  const bare = path.split("#")[0].split("?")[0]
  if (!bare.startsWith("/")) return null
  const trimmed = bare.endsWith("/") ? bare.slice(0, -1) : bare
  const segments: string[] = []
  for (const raw of trimmed.slice(1).split("/")) {
    let segment: string
    try {
      segment = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (!segment || segment === "." || segment === ".." || /[/\\]/.test(segment)) return null
    segments.push(segment)
  }
  return segments.length ? segments : null
}

const dynamicSegment = /^\[([A-Za-z][A-Za-z0-9]*)\]$/

/** Finds the route file that answers a URL path. Exact matches only, static segments beat `[param]` ones. */
export function matchApiRoute(routes: string[], path: string): { route: string; params: Record<string, string> } | null {
  const segments = requestSegments(path)
  if (!segments) return null
  let best: { route: string; params: Record<string, string>; staticAt: boolean[] } | null = null
  for (const route of routes) {
    const pattern = apiRouteUrl(route).split("/").slice(1)
    if (pattern.length !== segments.length) continue
    const params: Record<string, string> = {}
    const staticAt: boolean[] = []
    let matched = true
    for (let i = 0; i < pattern.length; i++) {
      const dynamic = dynamicSegment.exec(pattern[i])
      if (dynamic) {
        params[dynamic[1]] = segments[i]
        staticAt.push(false)
      } else if (pattern[i] === segments[i]) {
        staticAt.push(true)
      } else {
        matched = false
        break
      }
    }
    if (matched && (!best || beats(staticAt, best.staticAt))) best = { route, params, staticAt }
  }
  return best && { route: best.route, params: best.params }
}

function beats(a: boolean[], b: boolean[]) {
  const countA = a.filter(Boolean).length
  const countB = b.filter(Boolean).length
  if (countA !== countB) return countA > countB
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]
  return false
}
