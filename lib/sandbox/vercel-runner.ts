// The Vercel Sandbox implementation of SandboxRunner: one Firecracker microVM per project.
// Credentials reach the VM only as one JSON line on stdin, never through env, args or files.

import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import type { SandboxBundle } from "@/lib/sandbox/bundle"
import {
  SANDBOX_LIMITS,
  SandboxUnavailableError,
  type SandboxRequest,
  type SandboxResponse,
  type SandboxRunner,
} from "@/lib/sandbox/runner"
import type { SandboxState, SandboxStateStore } from "@/lib/sandbox/state"

const INTERNAL_HEADER = "x-appxprompt-internal"
const SECRET_NAME = "APPXPROMPT_SANDBOX_SECRET"
const SOON_MS = 5_000
const HEALTH_POLL_MS = 300
const WAIT_POLL_MS = 500
const PROBE_TIMEOUT_MS = 10_000
/** After a failed self-check, the same bundle is refused for this long without creating another VM. */
const UNAVAILABLE_MS = 5 * 60_000

export type SandboxHandle = {
  /** Stored in sandbox_state.sandboxId. */
  name: string
  domain(port: number): string
  writeFiles(files: { path: string; content: Buffer }[]): Promise<void>
  runCommand(params: { cmd: string; args: string[]; detached: true; stdin: Readable }): Promise<unknown>
  update(params: { networkPolicy: "deny-all" | { allow: string[] } }): Promise<void>
  extendTimeout(ms: number): Promise<void>
  stop(): Promise<void>
  delete(): Promise<void>
}

/** `get` is `Sandbox.get({ name })`. */
export type SandboxSdk = { create(options: object): Promise<SandboxHandle>; get(name: string): Promise<SandboxHandle> }

export type VercelRunnerDeps = {
  sdk: SandboxSdk
  state: SandboxStateStore
  bundles: { signature(projectId: string): Promise<string>; build(projectId: string): Promise<SandboxBundle> }
  fetch: typeof fetch
  now(): number
  runtimeSource(): Promise<string>
  secret(projectId: string): string
  /** Waits between polls. Tests replace it. */
  sleep?(ms: number): Promise<void>
}

type Running = { sandboxId: string; domain: string; deadlineAt: Date; sessionStartedAt: Date | null }
type Ensured = { running: Running } | { response: SandboxResponse }

function errorResponse(status: number, code: string, message: string): SandboxResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: { code, message } }) }
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createVercelRunner(deps: VercelRunnerDeps): SandboxRunner {
  const { sdk, state, bundles } = deps
  const sleep = deps.sleep ?? sleepFor
  const refused = new Map<string, { signature: string; until: number }>()

  const day = () => new Date(deps.now()).toISOString().slice(0, 10)

  function runningOf(st: SandboxState | null, signature: string): Running | null {
    if (!st || !st.sandboxId || !st.domain || !st.deadlineAt || st.signature !== signature) return null
    if (st.deadlineAt.getTime() - deps.now() <= SOON_MS) return null
    return { sandboxId: st.sandboxId, domain: st.domain, deadlineAt: st.deadlineAt, sessionStartedAt: st.sessionStartedAt }
  }

  async function discard(name: string, handle?: SandboxHandle) {
    try {
      const target = handle ?? (await sdk.get(name))
      await target.stop().catch(() => {})
      await target.delete().catch(() => {})
    } catch {
      // Best effort: the sandbox may already be gone.
    }
  }

  function probe(domain: string, route: string, projectId: string) {
    return deps.fetch(`${domain}${route}`, {
      headers: { [INTERNAL_HEADER]: deps.secret(projectId) },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  }

  async function waitForHealth(domain: string, projectId: string) {
    const until = deps.now() + SANDBOX_LIMITS.startWaitMs
    for (;;) {
      try {
        if ((await probe(domain, "/__health", projectId)).ok) return
      } catch {
        // Not up yet.
      }
      if (deps.now() >= until) throw new Error("The sandbox did not become healthy.")
      await sleep(HEALTH_POLL_MS)
    }
  }

  /** Egress must be blocked and every credential must have arrived, or the VM never serves. */
  async function selfCheck(domain: string, projectId: string, secretNames: string[]) {
    const response = await probe(domain, "/__selfcheck", projectId)
    if (!response.ok) return "the self-check did not answer"
    const result = (await response.json()) as { egressBlocked?: unknown; envKeys?: unknown }
    if (result.egressBlocked !== true) return "egress is not blocked"
    if (result.envKeys !== new Set(secretNames).size) return "credentials did not all arrive"
    return null
  }

  async function start(projectId: string, old: SandboxState | null): Promise<Ensured> {
    if (old?.sandboxId) await discard(old.sandboxId)
    let handle: SandboxHandle | null = null
    try {
      const b = await bundles.build(projectId)
      if (b.runtime.routes.length === 0) {
        await state.clear(projectId)
        return { response: errorResponse(404, "bad_request", "This app has no server functions.") }
      }
      const used = await state.addUsage(projectId, SANDBOX_LIMITS.sessionMs, day())
      if (used > SANDBOX_LIMITS.dailyMs) {
        await state.clear(projectId)
        throw new SandboxUnavailableError("limit")
      }

      const name = `appx-${projectId.slice(0, 8)}-${deps.now().toString(36)}-${randomBytes(3).toString("hex")}`
      handle = await sdk.create({
        name,
        ports: [SANDBOX_LIMITS.port],
        timeout: SANDBOX_LIMITS.sessionMs,
        resources: { vcpus: 1 },
        image: "vercel/sandbox/node:24",
        persistent: false,
        networkPolicy: b.runtime.allowedHosts.length > 0 ? { allow: b.runtime.allowedHosts } : "deny-all",
      })
      await handle.writeFiles([
        { path: "server.mjs", content: Buffer.from(await deps.runtimeSource()) },
        { path: "bundle.json", content: Buffer.from(JSON.stringify(b.runtime)) },
      ])
      const credentials = JSON.stringify({ ...b.env, [SECRET_NAME]: deps.secret(projectId), PORT: String(SANDBOX_LIMITS.port) })
      await handle.runCommand({ cmd: "node", args: ["server.mjs"], detached: true, stdin: Readable.from([`${credentials}\n`]) })

      const domain = handle.domain(SANDBOX_LIMITS.port)
      await waitForHealth(domain, projectId)
      const problem = await selfCheck(domain, projectId, b.runtime.secretNames)
      if (problem) {
        console.warn(`[sandbox] a VM was refused: ${problem}`)
        refused.set(projectId, { signature: b.signature, until: deps.now() + UNAVAILABLE_MS })
        throw new Error(problem)
      }

      const startedAt = deps.now()
      const deadlineAt = new Date(startedAt + SANDBOX_LIMITS.sessionMs)
      await state.saveStarted(projectId, {
        sandboxId: name,
        domain,
        signature: b.signature,
        sessionStartedAt: new Date(startedAt),
        deadlineAt,
      })
      return { running: { sandboxId: name, domain, deadlineAt, sessionStartedAt: new Date(startedAt) } }
    } catch (error) {
      if (handle) await discard(handle.name, handle)
      await state.clear(projectId).catch(() => {})
      if (error instanceof SandboxUnavailableError) throw error
      throw new SandboxUnavailableError("failed")
    }
  }

  async function waitForStart(projectId: string, signature: string): Promise<Ensured> {
    const until = deps.now() + SANDBOX_LIMITS.startWaitMs
    for (;;) {
      const running = runningOf(await state.get(projectId), signature)
      if (running) return { running }
      const block = refused.get(projectId)
      if (block && block.signature === signature && block.until > deps.now()) throw new SandboxUnavailableError("failed")
      if (deps.now() >= until) throw new SandboxUnavailableError("starting")
      await sleep(WAIT_POLL_MS)
    }
  }

  async function ensureRunning(projectId: string): Promise<Ensured> {
    const signature = await bundles.signature(projectId)
    const block = refused.get(projectId)
    if (block && block.signature === signature && block.until > deps.now()) throw new SandboxUnavailableError("failed")

    const current = await state.get(projectId)
    const running = runningOf(current, signature)
    if (running) return { running }

    if (!(await state.claimStart(projectId, new Date(deps.now() + SANDBOX_LIMITS.startClaimMs)))) {
      return waitForStart(projectId, signature)
    }
    // Another request may have finished a start between the read above and the claim.
    const latest = await state.get(projectId)
    const fresh = runningOf(latest, signature)
    if (fresh && latest?.sandboxId && latest.domain && latest.signature && latest.sessionStartedAt && latest.deadlineAt) {
      await state.saveStarted(projectId, {
        sandboxId: latest.sandboxId,
        domain: latest.domain,
        signature: latest.signature,
        sessionStartedAt: latest.sessionStartedAt,
        deadlineAt: latest.deadlineAt,
      })
      return { running: fresh }
    }
    return start(projectId, latest)
  }

  async function forward(projectId: string, running: Running, request: SandboxRequest): Promise<SandboxResponse> {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(request.headers)) if (name.toLowerCase() !== INTERNAL_HEADER) headers[name] = value
    headers[INTERNAL_HEADER] = deps.secret(projectId)
    const hasBody = request.body !== null && request.method !== "GET" && request.method !== "HEAD"
    const response = await deps.fetch(running.domain + request.path, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(SANDBOX_LIMITS.proxyTimeoutMs),
    })
    const body = await response.text()
    const out = Object.fromEntries(response.headers)
    // The body is already decoded, so these would describe bytes that are no longer there.
    delete out["content-encoding"]
    delete out["content-length"]
    delete out["transfer-encoding"]
    return { status: response.status, headers: out, body }
  }

  /** Stops a VM that stopped answering, unless a newer one has already replaced it. */
  async function dropDead(projectId: string, sandboxId: string) {
    const latest = await state.get(projectId).catch(() => null)
    if (latest && latest.sandboxId !== sandboxId) return
    await discard(sandboxId)
    await state.clear(projectId).catch(() => {})
  }

  async function keepWarm(projectId: string, running: Running) {
    try {
      const now = deps.now()
      const startedAt = running.sessionStartedAt?.getTime() ?? now
      if (running.deadlineAt.getTime() - now >= SANDBOX_LIMITS.extendWhenMs) return
      if (now - startedAt + SANDBOX_LIMITS.extendByMs > SANDBOX_LIMITS.maxSessionMs) return
      const used = await state.addUsage(projectId, SANDBOX_LIMITS.extendByMs, day())
      let extended = false
      if (used <= SANDBOX_LIMITS.dailyMs) {
        try {
          await (await sdk.get(running.sandboxId)).extendTimeout(SANDBOX_LIMITS.extendByMs)
          extended = true
        } catch {
          // The plan's session limit: this session is over, and the next request starts a new one.
        }
      }
      if (extended) await state.saveDeadline(projectId, new Date(running.deadlineAt.getTime() + SANDBOX_LIMITS.extendByMs))
      else await state.addUsage(projectId, -SANDBOX_LIMITS.extendByMs, day())
    } catch {
      // Keeping warm never fails a request.
    }
  }

  return {
    async invoke(projectId, request) {
      let restarted = false
      for (;;) {
        const ensured = await ensureRunning(projectId)
        if ("response" in ensured) return ensured.response
        const { running } = ensured
        let response: SandboxResponse
        try {
          response = await forward(projectId, running, request)
        } catch {
          await dropDead(projectId, running.sandboxId)
          if (restarted) throw new SandboxUnavailableError("failed")
          restarted = true
          continue
        }
        await keepWarm(projectId, running)
        return response
      }
    },

    async reload(projectId) {
      refused.delete(projectId)
      await deps.state.clearSignature(projectId)
    },

    async stop(projectId) {
      refused.delete(projectId)
      const st = await state.get(projectId)
      if (st?.sandboxId) await discard(st.sandboxId)
      await state.clear(projectId)
    },
  }
}

/** The real thing: the Vercel SDK, the database state and the bundle builder. Loaded on first use. */
export async function createProductionVercelRunner(): Promise<SandboxRunner> {
  const [{ Sandbox }, { dbSandboxState }, bundleModule, { sandboxInternalSecret }] = await Promise.all([
    import("@vercel/sandbox"),
    import("@/lib/sandbox/state"),
    import("@/lib/sandbox/bundle"),
    import("@/lib/sandbox/token"),
  ])
  // Task 3b adds these two to bundle.ts; until then a start fails and the call answers "unavailable".
  const { buildSandboxBundle, sandboxSignature } = bundleModule as unknown as {
    buildSandboxBundle?: (projectId: string) => Promise<SandboxBundle>
    sandboxSignature?: (projectId: string) => Promise<string>
  }
  if (!buildSandboxBundle || !sandboxSignature) throw new Error("The sandbox bundle builder is not available.")

  const { VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId, VERCEL_TOKEN: token } = process.env
  const auth = teamId && projectId && token ? { teamId, projectId, token } : {}
  const wrap = (sandbox: InstanceType<typeof Sandbox>): SandboxHandle => ({
    name: sandbox.name,
    domain: (port) => sandbox.domain(port),
    writeFiles: (files) => sandbox.writeFiles(files),
    runCommand: (params) => sandbox.runCommand(params),
    update: (params) => sandbox.update(params),
    extendTimeout: (ms) => sandbox.extendTimeout(ms),
    stop: async () => {
      await sandbox.stop()
    },
    delete: () => sandbox.delete(),
  })

  let source: Promise<string> | null = null
  return createVercelRunner({
    sdk: {
      create: async (options) => wrap(await Sandbox.create({ ...options, ...auth })),
      get: async (name) => wrap(await Sandbox.get({ name, ...auth })),
    },
    state: dbSandboxState,
    bundles: { signature: sandboxSignature, build: buildSandboxBundle },
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    runtimeSource: () => (source ??= readFile(path.join(process.cwd(), "sandbox-runtime/dist/server.mjs"), "utf8")),
    secret: sandboxInternalSecret,
  })
}
