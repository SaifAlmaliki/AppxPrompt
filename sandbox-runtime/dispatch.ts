// Runs inside the sandbox VM. Web APIs only, so it can be unit-tested without Node's http.
import { matchApiRoute } from "../lib/sandbox/routes"
import type { RuntimeBundle } from "../lib/sandbox/bundle"

export const RUNTIME_LIMITS = { timeoutMs: 30_000, maxBodyBytes: 1_048_576, maxRedirects: 5 }

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MIN_SECRET_LENGTH = 8

type ErrorCode = "bad_request" | "unavailable"
type Handler = (request: Request, params: Record<string, string>) => unknown

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
  }
}

function errorResponse(status: number, code: ErrorCode, message: string, service?: string) {
  return Response.json({ error: { code, message, ...(service ? { service } : {}) } }, { status })
}

function notAllowed(host: string) {
  return new TypeError(`${host} isn't one of this app's allowed hosts.`)
}

/** Wraps fetch so server code can only reach https hosts on the allow list, redirects included. */
export function guardedFetch(fetchImpl: typeof fetch, allowedHosts: string[]): typeof fetch {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()))
  const check = (url: URL) => {
    if (url.protocol !== "https:" || !allowed.has(url.hostname.toLowerCase())) throw notAllowed(url.hostname || url.protocol)
  }

  return async (input, init) => {
    let url: URL
    let options: RequestInit
    if (input instanceof Request) {
      url = new URL(input.url)
      const hasBody = input.method !== "GET" && input.method !== "HEAD"
      options = {
        method: input.method,
        headers: input.headers,
        body: hasBody ? await input.clone().arrayBuffer() : undefined,
        signal: input.signal,
        ...init,
      }
    } else {
      url = new URL(String(input))
      options = { ...init }
    }

    for (let hop = 0; ; hop++) {
      check(url)
      const response = await fetchImpl(url.href, { ...options, redirect: "manual" })
      const location = response.headers.get("location")
      if (!REDIRECT_STATUSES.has(response.status) || !location) return response
      if (hop >= RUNTIME_LIMITS.maxRedirects) throw new TypeError("Too many redirects.")

      const next = new URL(location, url)
      check(next)
      const method = (options.method ?? "GET").toUpperCase()
      const toGet = response.status === 303 ? method !== "HEAD" : (response.status === 301 || response.status === 302) && method === "POST"
      const headers = new Headers(options.headers)
      if (next.hostname !== url.hostname) {
        headers.delete("authorization")
        headers.delete("cookie")
      }
      options = { ...options, headers }
      if (toGet) {
        options = { ...options, method: "GET", body: undefined }
        headers.delete("content-type")
        headers.delete("content-length")
      }
      await response.body?.cancel().catch(() => {})
      url = next
    }
  }
}

/** Reads a stream, giving up (null) once it passes the limit. */
async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const SILENT_CONSOLE = new Proxy({}, { get: () => () => {} })

function resolveFile(files: Record<string, string>, from: string, specifier: string) {
  let base: string
  if (specifier.startsWith("@/")) {
    base = specifier.slice(2)
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = `${from.split("/").slice(0, -1).join("/")}/${specifier}`
  } else {
    return null
  }
  const parts: string[] = []
  for (const part of base.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  const joined = parts.join("/")
  for (const suffix of ["", ".ts", "/index.ts"]) {
    const candidate = joined + suffix
    if (Object.prototype.hasOwnProperty.call(files, candidate)) return candidate
  }
  return null
}

/** What a module sees as its own scope. A real evaluator must also make these its globals. */
export type ModuleScope = {
  require: (specifier: string) => unknown
  module: { exports: Record<string, unknown> }
  exports: Record<string, unknown>
  process: { env: Readonly<Record<string, string>> }
  console: Record<string, unknown>
  fetch: typeof fetch
}

/** Runs one compiled module. The default only shadows names; server.ts passes a vm-based one. */
export type Evaluator = (code: string, scope: ModuleScope, filename: string) => void

const shadowEvaluator: Evaluator = (code, scope) => {
  new Function("require", "module", "exports", "process", "console", "fetch", code)(
    scope.require,
    scope.module,
    scope.exports,
    scope.process,
    scope.console,
    scope.fetch
  )
}

function bytesToBase64(bytes: Uint8Array) {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

/** The ways a secret might be smuggled into an answer: as is, and encoded the usual ways. */
function secretForms(secret: string) {
  const bytes = new TextEncoder().encode(secret)
  const base64 = bytesToBase64(bytes)
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return [
    secret,
    base64,
    base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    hex,
    hex.toUpperCase(),
    encodeURIComponent(secret),
    JSON.stringify(secret).slice(1, -1),
  ]
}

// Neither the evaluator nor the timeout below is a security boundary. The sandbox VM's network policy is the egress wall.
// The timer can't stop a synchronous infinite loop (nothing else runs to fire it), so a spinning route
// is cut off by the host's own deadline, which restarts the VM.
export function createDispatcher(
  bundle: RuntimeBundle,
  options: { env: Record<string, string>; fetch: typeof fetch; timeoutMs?: number; maxBodyBytes?: number; evaluate?: Evaluator }
): (request: Request) => Promise<Response> {
  const timeoutMs = options.timeoutMs ?? RUNTIME_LIMITS.timeoutMs
  const maxBodyBytes = options.maxBodyBytes ?? RUNTIME_LIMITS.maxBodyBytes
  const evaluate = options.evaluate ?? shadowEvaluator
  const env = Object.freeze({ ...options.env })
  const secrets = bundle.secretNames
    .map((name) => env[name])
    .filter((value): value is string => typeof value === "string" && value.length >= MIN_SECRET_LENGTH)
    .flatMap(secretForms)
  const sandboxProcess = Object.freeze({ env })
  const guarded = guardedFetch(options.fetch, bundle.allowedHosts)
  const modules = new Map<string, { exports: Record<string, unknown> }>()

  function load(path: string): Record<string, unknown> {
    const cached = modules.get(path)
    if (cached) return cached.exports
    const module = { exports: {} as Record<string, unknown> }
    modules.set(path, module)
    try {
      const require = (specifier: string) => {
        const target = resolveFile(bundle.files, path, specifier)
        if (!target) throw new Error(`${specifier} isn't available on the server.`)
        return load(target)
      }
      evaluate(
        bundle.files[path],
        { require, module, exports: module.exports, process: sandboxProcess, console: SILENT_CONSOLE, fetch: guarded },
        path
      )
    } catch (error) {
      modules.delete(path)
      throw error
    }
    return module.exports
  }

  async function run(handler: Handler, request: Request, params: Record<string, string>) {
    const result = await handler(request, params)
    if (!(result instanceof Response)) throw new HttpError(500, "unavailable", "The server function didn't answer.")
    const body = await readCapped(result.body, maxBodyBytes)
    if (!body) throw new HttpError(500, "unavailable", "The server function's answer was too large.")
    return { result, body }
  }

  function leaksSecret(text: string) {
    return secrets.some((secret) => text.includes(secret))
  }

  return async (request) => {
    try {
      const url = new URL(request.url)
      const match = matchApiRoute(bundle.routes, url.pathname)
      if (!match) return errorResponse(404, "bad_request", `There's no server function at ${url.pathname}.`)

      const exported = load(match.route)
      const handler = Object.prototype.hasOwnProperty.call(exported, request.method) ? exported[request.method] : undefined
      if (typeof handler !== "function") {
        return errorResponse(405, "bad_request", `${url.pathname} doesn't answer ${request.method} requests.`)
      }

      const hasBody = request.method !== "GET" && request.method !== "HEAD"
      const requestBody = hasBody ? await readCapped(request.body, maxBodyBytes) : new Uint8Array(0)
      if (!requestBody) return errorResponse(413, "bad_request", "The request body is too large.")
      const forwarded = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: hasBody && requestBody.byteLength ? (requestBody as BodyInit) : undefined,
      })

      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpError(504, "unavailable", "The server function took too long.")), timeoutMs)
      })
      const pending = run(handler as Handler, forwarded, match.params)
      pending.catch(() => {})
      try {
        const { result, body } = await Promise.race([pending, timeout])
        const headerText = [...result.headers].map(([name, value]) => `${name}: ${value}`).join("\n")
        if (leaksSecret(new TextDecoder().decode(body)) || leaksSecret(headerText)) {
          return errorResponse(500, "unavailable", "The server function tried to return a secret, so its answer was blocked.")
        }
        const headers = new Headers(result.headers)
        for (const name of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(name)
        return new Response(body.byteLength ? (body as BodyInit) : null, { status: result.status, statusText: result.statusText, headers })
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message)
      return errorResponse(500, "unavailable", "The server function failed.")
    }
  }
}
