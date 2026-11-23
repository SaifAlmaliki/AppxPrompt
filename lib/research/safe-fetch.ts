import { lookup } from "node:dns"
import https from "node:https"
import { isIP, type LookupFunction } from "node:net"
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib"
import { isPublicIp } from "@/lib/services/public-host"

export const MAX_REDIRECTS = 3
export const MAX_BODY_BYTES = 4_000_000
export const PAGE_TIMEOUT_MS = 10_000

export function isPrivateAddress(ip: string): boolean {
  return !isPublicIp(ip)
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"]

export function isPublicHttpsUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:") return false
  if (parsed.username || parsed.password) return false
  if (parsed.port !== "" && parsed.port !== "443") return false
  const host = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase()
  if (isIP(host)) return !isPrivateAddress(host)
  if (host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  return host.includes(".")
}

export const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, "", 0)
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      return callback(Object.assign(new Error(`${hostname} resolves to a non-public address`), { code: "ERR_PRIVATE_ADDRESS" }), "", 0)
    }
    if (options.all) return (callback as unknown as (err: null, all: typeof addresses) => void)(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

export async function readLimited(stream: NodeJS.ReadableStream, maxBytes: number): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = []
  let size = 0
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (truncated: boolean) => {
      if (done) return
      done = true
      resolve({ body: Buffer.concat(chunks), truncated })
    }
    stream.on("data", (chunk: Buffer | string) => {
      if (done) return
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk
      if (size + buffer.length > maxBytes) {
        chunks.push(buffer.subarray(0, maxBytes - size))
        size = maxBytes
        ;(stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.()
        finish(true)
        return
      }
      chunks.push(buffer)
      size += buffer.length
    })
    stream.on("end", () => finish(false))
    stream.on("close", () => finish(false))
    stream.on("error", (error) => {
      if (done) return
      done = true
      reject(error)
    })
  })
}

export type RawResponse = { status: number; location: string | null; contentType: string; body: Buffer; truncated: boolean }
export type RequestOnce = (url: string, signal: AbortSignal) => Promise<RawResponse>
export type FetchedResponse = { url: string; contentType: string; body: Buffer; truncated: boolean }

export const httpsRequestOnce: RequestOnce = (url, signal) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; AppxPromptResearch/1.0)",
          accept: "text/html,application/xhtml+xml,text/markdown,text/plain,application/json,application/yaml;q=0.9,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0
        const contentType = String(response.headers["content-type"] ?? "")
        if (status >= 300 && status < 400) {
          const location = response.headers.location ?? null
          response.destroy()
          resolve({ status, location, contentType, body: Buffer.alloc(0), truncated: false })
          return
        }
        const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase()
        const decoder = encoding.includes("gzip")
          ? createGunzip()
          : encoding.includes("deflate")
            ? createInflate()
            : encoding.includes("br")
              ? createBrotliDecompress()
              : null
        let source: NodeJS.ReadableStream = response
        if (decoder) {
          response.on("error", (error) => decoder.destroy(error))
          source = response.pipe(decoder)
        }
        readLimited(source, MAX_BODY_BYTES)
          .then(({ body, truncated }) => {
            response.destroy()
            resolve({ status, location: null, contentType, body, truncated })
          })
          .catch(reject)
      },
    )
    request.on("error", reject)
    request.end()
  })

const PINNED_MAX_BODY_BYTES = 1_000_000
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
const unreachableMessage = "This address can't be reached."

export type PinnedInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
  /** Accepted for fetch compatibility; redirects are never followed. */
  redirect?: "manual"
}

const DEFAULT_REQUEST_HEADERS: Record<string, string> = { "user-agent": "AppxPrompt", accept: "*/*" }

function requestHeaders(custom: Record<string, string> = {}): Record<string, string> {
  const given = new Set(Object.keys(custom).map((name) => name.toLowerCase()))
  const defaults = Object.fromEntries(Object.entries(DEFAULT_REQUEST_HEADERS).filter(([name]) => !given.has(name)))
  const rest = Object.fromEntries(Object.entries(custom).filter(([name]) => name.toLowerCase() !== "accept-encoding"))
  return { ...defaults, ...rest, "accept-encoding": "identity" }
}

/**
 * One https request whose connection is made only to public addresses (checked at connect time by safeLookup),
 * so the address that was checked is the address that is used. No redirects, no decompression, 1 MB body cap.
 */
export function pinnedFetch(
  url: string,
  init: PinnedInit = {},
  requestImpl: typeof https.request = https.request,
): Promise<Response> {
  if (!isPublicHttpsUrl(url)) return Promise.reject(new Error(unreachableMessage))
  return new Promise<Response>((resolve, reject) => {
    // Only the error's name and code survive: its message can carry the URL.
    const fail = (error: unknown) => {
      const { code, name } = (error ?? {}) as { code?: string; name?: string }
      reject(Object.assign(new Error(unreachableMessage), { ...(code ? { code } : {}), ...(name ? { name } : {}) }))
    }
    try {
      const request = requestImpl(
        url,
        {
          method: init.method ?? "GET",
          headers: requestHeaders(init.headers),
          lookup: safeLookup,
          agent: false,
          signal: init.signal ?? AbortSignal.timeout(PAGE_TIMEOUT_MS),
        },
        (response) => {
          const status = response.statusCode ?? 0
          const headers = new Headers()
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers.set(name, value)
            else if (Array.isArray(value)) headers.set(name, value.join(", "))
          }
          readLimited(response, PINNED_MAX_BODY_BYTES)
            .then(({ body }) => {
              response.destroy()
              resolve(new Response(NULL_BODY_STATUSES.has(status) ? null : new Uint8Array(body), { status, headers }))
            })
            .catch((error) => {
              response.destroy()
              fail(error)
            })
        },
      )
      request.on("error", fail)
      request.end(init.body)
    } catch (error) {
      fail(error)
    }
  })
}

const errors = {
  onlyPublic: "Not read: only public https pages can be read.",
  badRedirect: "Not read: the page redirected to an address that isn't public https.",
  tooMany: "Not read: too many redirects.",
  privateAddress: "Not read: that site's address isn't public.",
  timeout: "Not read: the page took too long to load.",
  unreachable: "Not read: the page couldn't be reached.",
}

export async function fetchPublic(url: string, requestOnce: RequestOnce = httpsRequestOnce): Promise<FetchedResponse | { error: string }> {
  if (!isPublicHttpsUrl(url)) return { error: errors.onlyPublic }
  const signal = AbortSignal.timeout(PAGE_TIMEOUT_MS)
  let current = url
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await requestOnce(current, signal)
      if (response.status >= 300 && response.status < 400) {
        if (!response.location) return { error: errors.badRedirect }
        if (redirects >= MAX_REDIRECTS) return { error: errors.tooMany }
        let next: string
        try {
          next = new URL(response.location, current).href
        } catch {
          return { error: errors.badRedirect }
        }
        if (!isPublicHttpsUrl(next)) return { error: errors.badRedirect }
        current = next
        continue
      }
      if (response.status < 200 || response.status >= 300) return { error: `Not read: the page answered ${response.status}.` }
      return { url: current, contentType: response.contentType, body: response.body, truncated: response.truncated }
    }
  } catch (error) {
    const { code, name } = (error ?? {}) as { code?: string; name?: string }
    if (code === "ERR_PRIVATE_ADDRESS") return { error: errors.privateAddress }
    if (name === "TimeoutError" || name === "AbortError") return { error: errors.timeout }
    return { error: errors.unreachable }
  }
}
