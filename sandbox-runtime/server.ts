// Runs inside the sandbox VM. Reads credentials from one JSON line on stdin, then serves the bundle's API routes.
import { createHash, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import path from "node:path"
import { createInterface } from "node:readline"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import type { RuntimeBundle } from "../lib/sandbox/bundle"
import { createDispatcher } from "./dispatch"
import { createVmEvaluator, hardenHost } from "./evaluate"
import { runSelfCheck } from "./selfcheck"

const SECRET_NAME = "APPXPROMPT_SANDBOX_SECRET"
const INTERNAL_HEADER = "x-appxprompt-internal"

function readEnvLine() {
  return new Promise<Record<string, string>>((resolve, reject) => {
    const lines = createInterface({ input: process.stdin })
    lines.once("line", (line) => {
      try {
        const parsed: unknown = JSON.parse(line)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
        const env: Record<string, string> = {}
        for (const [name, value] of Object.entries(parsed)) if (typeof value === "string") env[name] = value
        resolve(env)
      } catch {
        reject(new Error("The first line on stdin must be a JSON object of strings."))
      }
      lines.close()
    })
    lines.once("close", () => reject(new Error("No credentials arrived on stdin.")))
  })
}

function digest(value: string) {
  return createHash("sha256").update(value).digest()
}

function toWebRequest(req: IncomingMessage, port: number) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (name === INTERNAL_HEADER || value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item)
  }
  const method = req.method ?? "GET"
  const hasBody = method !== "GET" && method !== "HEAD"
  return new Request(`http://localhost:${port}${req.url ?? "/"}`, {
    method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
  } as RequestInit)
}

async function send(res: ServerResponse, response: Response) {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length) headers["set-cookie"] = cookies
  res.writeHead(response.status, headers)
  res.end(Buffer.from(await response.arrayBuffer()))
}

async function main() {
  const { [SECRET_NAME]: secret, ...env } = await readEnvLine()
  if (!secret) throw new Error("The internal secret is missing.")
  delete process.env[SECRET_NAME]
  // The credentials go to the dispatcher only, never into the host's process.env, which stray host-realm references could read.

  const bundle = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle.json"), "utf8")) as RuntimeBundle
  const port = Number(process.env.PORT) || 3000
  const expected = digest(secret)
  const hostFetch = globalThis.fetch.bind(globalThis)
  const dispatch = createDispatcher(bundle, { env, fetch: hostFetch, evaluate: createVmEvaluator() })

  process.on("unhandledRejection", () => {})
  process.on("uncaughtException", () => {})
  hardenHost()

  const server = createServer(async (req, res) => {
    try {
      const given = req.headers[INTERNAL_HEADER]
      if (typeof given !== "string" || !timingSafeEqual(digest(given), expected)) {
        res.writeHead(404).end()
        return
      }
      if (req.method === "GET" && req.url === "/__health") {
        await send(res, Response.json({ ok: true }))
        return
      }
      if (req.method === "GET" && req.url === "/__selfcheck") {
        await send(res, Response.json(await runSelfCheck({ hostFetch, env, secretNames: bundle.secretNames })))
        return
      }
      await send(res, await dispatch(toWebRequest(req, port)))
    } catch {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { code: "unavailable", message: "The server function failed." } }))
    }
  })
  server.listen(port)
}

main().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
