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
  /** How long one invoke may take in all. Defaults to SANDBOX_LIMITS.invokeBudgetMs. */
  invokeBudgetMs?: number
  /** Calls `fire` after `ms`, and returns what cancels it. Tests replace it. */
  startTimer?(ms: number, fire: () => void): () => void
  /** Asks the platform to keep the function running until `work` settles, which a start the invoke gave up on needs. */
  keepAlive?(work: Promise<unknown>): void
}

type Running = { sandboxId: string; domain: string; deadlineAt: Date; sessionStartedAt: Date | null }
type Ensured = { running: Running } | { response: SandboxResponse }

function errorResponse(status: number, code: string, message: string): SandboxResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: { code, message } }) }
}

/** One leading slash, no backslash or control character (URL parsing drops tabs and newlines): anything else could point the URL at another host. */
function isSafePath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value)
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function timerFor(ms: number, fire: () => void) {
  const timer = setTimeout(fire, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

/** What a gateway or the platform answers when the VM behind it is gone. The runtime's own errors are JSON. */
function isPlatformFailure(response: SandboxResponse) {
  return [502, 503, 504].includes(response.status) && !/json/i.test(response.headers["content-type"] ?? "")
}

export function createVercelRunner(deps: VercelRunnerDeps): SandboxRunner {
  const { sdk, state, bundles } = deps
  const sleep = deps.sleep ?? sleepFor
  const startTimer = deps.startTimer ?? timerFor
  const refused = new Map<string, { signature: string; until: number }>()

  const day = () => new Date(deps.now()).toISOString().slice(0, 10)

  function runningOf(st: SandboxState | null, signature: string): Running | null {
    if (!st || !st.sandboxId || !st.domain || !st.deadlineAt || st.signature !== signature) return null
    if (st.deadlineAt.getTime() - deps.now() <= SOON_MS) return null
    return { sandboxId: st.sandboxId, domain: st.domain, deadlineAt: st.deadlineAt, sessionStartedAt: st.sessionStartedAt }
  }

  /** Gives back the part of a session's charge that the VM never used. */
  async function refundUnused(projectId: string, deadlineAt: Date | null | undefined) {
    if (!deadlineAt) return
    const unused = deadlineAt.getTime() - deps.now()
    if (unused > 0) await state.addUsage(projectId, -unused, day()).catch(() => {})
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
    if (old?.sandboxId) {
      await discard(old.sandboxId)
      await refundUnused(projectId, old.deadlineAt)
    }
    let handle: SandboxHandle | null = null
    let charged = false
    try {
      const b = await bundles.build(projectId)
      if (b.runtime.routes.length === 0) {
        await state.clear(projectId)
        return { response: errorResponse(404, "bad_request", "This app has no server functions.") }
      }
      const used = await state.addUsage(projectId, SANDBOX_LIMITS.sessionMs, day())
      charged = true
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
      // Nothing was served from this session, so none of it is charged.
      if (charged) await state.addUsage(projectId, -SANDBOX_LIMITS.sessionMs, day()).catch(() => {})
      if (error instanceof SandboxUnavailableError) throw error
      throw new SandboxUnavailableError("failed")
    }
  }

  /**
   * Runs a start for the caller, who stops waiting at `deadline`. The start itself isn't stopped then: it
   * saves its VM for the next call, or stops and deletes it, whichever way it ends.
   */
  function startWithin(projectId: string, old: SandboxState | null, deadline: number): Promise<Ensured> {
    const remaining = deadline - deps.now()
    if (remaining <= 0) throw new SandboxUnavailableError("starting")
    const work = start(projectId, old)
    const settled = work.then(
      () => {},
      () => {},
    )
    try {
      deps.keepAlive?.(settled)
    } catch {
      // Outside a request there is nothing to extend.
    }
    return new Promise<Ensured>((resolve, reject) => {
      const cancel = startTimer(remaining, () => reject(new SandboxUnavailableError("starting")))
      work.then(resolve, reject).finally(cancel)
    })
  }

  async function waitForStart(projectId: string, signature: string, deadline: number): Promise<Ensured> {
    const until = Math.min(deps.now() + SANDBOX_LIMITS.startWaitMs, deadline)
    for (;;) {
      const running = runningOf(await state.get(projectId), signature)
      if (running) return { running }
      const block = refused.get(projectId)
      if (block && block.signature === signature && block.until > deps.now()) throw new SandboxUnavailableError("failed")
      if (deps.now() >= until) throw new SandboxUnavailableError("starting")
      await sleep(WAIT_POLL_MS)
    }
  }

  async function ensureRunning(projectId: string, deadline: number): Promise<Ensured> {
    const signature = await bundles.signature(projectId)
    const block = refused.get(projectId)
    if (block && block.signature === signature && block.until > deps.now()) throw new SandboxUnavailableError("failed")

    const current = await state.get(projectId)
    const running = runningOf(current, signature)
    if (running) return { running }

    if (!(await state.claimStart(projectId, new Date(deps.now() + SANDBOX_LIMITS.startClaimMs)))) {
      return waitForStart(projectId, signature, deadline)
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
    return startWithin(projectId, latest, deadline)
  }

  async function forward(projectId: string, running: Running, request: SandboxRequest, deadline: number): Promise<SandboxResponse> {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(request.headers)) if (name.toLowerCase() !== INTERNAL_HEADER) headers[name] = value
    headers[INTERNAL_HEADER] = deps.secret(projectId)
    const hasBody = request.body !== null && request.method !== "GET" && request.method !== "HEAD"
    const target = new URL(request.path, running.domain)
    if (target.origin !== new URL(running.domain).origin) throw new Error("The path left the sandbox origin.")
    const response = await deps.fetch(target.href, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(SANDBOX_LIMITS.proxyTimeoutMs, Math.max(1, deadline - deps.now()))),
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
  async function dropDead(projectId: string, running: Running) {
    const latest = await state.get(projectId).catch(() => null)
    if (latest && latest.sandboxId !== running.sandboxId) return
    await discard(running.sandboxId)
    await state.clear(projectId).catch(() => {})
    await refundUnused(projectId, latest?.deadlineAt ?? running.deadlineAt)
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
      if (!isSafePath(request.path)) throw new SandboxUnavailableError("failed")
      const deadline = deps.now() + (deps.invokeBudgetMs ?? SANDBOX_LIMITS.invokeBudgetMs)
      let restarted = false
      for (;;) {
        const ensured = await ensureRunning(projectId, deadline)
        if ("response" in ensured) return ensured.response
        const { running } = ensured
        if (deadline - deps.now() <= 0) throw new SandboxUnavailableError("starting")
        let response: SandboxResponse | null
        try {
          response = await forward(projectId, running, request, deadline)
          if (isPlatformFailure(response)) response = null
        } catch {
          response = null
        }
        if (!response) {
          await dropDead(projectId, running)
          if (restarted) throw new SandboxUnavailableError("failed")
          // The next call starts a new VM, so there is no need to risk the time this one has left.
          if (deadline - deps.now() < SANDBOX_LIMITS.restartMinMs) throw new SandboxUnavailableError("starting")
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
      if (st?.sandboxId) {
        await discard(st.sandboxId)
        await refundUnused(projectId, st.deadlineAt)
      }
      await state.clear(projectId)
    },
  }
}

/** The real thing: the Vercel SDK, the database state and the bundle builder. Loaded on first use. */
export async function createProductionVercelRunner(): Promise<SandboxRunner> {
  const [{ Sandbox }, { dbSandboxState }, { buildSandboxBundle, sandboxSignature }, { sandboxInternalSecret }, { after }] = await Promise.all([
    import("@vercel/sandbox"),
    import("@/lib/sandbox/state"),
    import("@/lib/sandbox/bundle"),
    import("@/lib/sandbox/token"),
    import("next/server"),
  ])
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
    keepAlive: (work) => after(() => work),
  })
}
