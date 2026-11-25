// Where a project's server routes run while the owner tests the app. Swappable: the Vercel Sandbox
// implementation lives in vercel-runner.ts, and anything else answers "unavailable".

export type SandboxRequest = { method: string; path: string; headers: Record<string, string>; body: string | null }
export type SandboxResponse = { status: number; headers: Record<string, string>; body: string }

export interface SandboxRunner {
  invoke(projectId: string, request: SandboxRequest): Promise<SandboxResponse>
  /** Clears only the stored signature. The next invoke stops the old sandbox and restarts. */
  reload(projectId: string): Promise<void>
  stop(projectId: string): Promise<void>
}

export class SandboxUnavailableError extends Error {
  constructor(readonly reason: "disabled" | "starting" | "limit" | "failed") {
    super(`The sandbox is unavailable: ${reason}`)
    this.name = "SandboxUnavailableError"
  }
}

export const SANDBOX_LIMITS = {
  port: 3000,
  sessionMs: 15 * 60_000,
  extendWhenMs: 5 * 60_000,
  extendByMs: 15 * 60_000,
  maxSessionMs: 2 * 3_600_000,
  startWaitMs: 25_000,
  startClaimMs: 60_000,
  proxyTimeoutMs: 35_000,
  dailyMs: 3 * 3_600_000,
  requestsPerMinute: 60,
}

const disabledRunner: SandboxRunner = {
  invoke: () => Promise.reject(new SandboxUnavailableError("disabled")),
  reload: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

/** Builds the Vercel runner on first use, so nothing from the SDK or the database loads until it is needed. */
function lazyVercelRunner(): SandboxRunner {
  let real: Promise<SandboxRunner> | null = null
  const load = () => (real ??= import("@/lib/sandbox/vercel-runner").then((module) => module.createProductionVercelRunner()))
  return {
    invoke: async (projectId, request) => (await load()).invoke(projectId, request),
    reload: async (projectId) => (await load()).reload(projectId),
    stop: async (projectId) => (await load()).stop(projectId),
  }
}

let memoized: SandboxRunner | null = null

export function getSandboxRunner(): SandboxRunner {
  if (process.env.SANDBOX_PROVIDER !== "vercel") return disabledRunner
  return (memoized ??= lazyVercelRunner())
}

const requestTimes = new Map<string, number[]>()

/** Whether this project may make another request: at most 60 per rolling minute per process. */
export function takeSandboxRequest(projectId: string, now = Date.now()): boolean {
  const recent = (requestTimes.get(projectId) ?? []).filter((time) => now - time < 60_000)
  if (recent.length >= SANDBOX_LIMITS.requestsPerMinute) {
    requestTimes.set(projectId, recent)
    return false
  }
  recent.push(now)
  requestTimes.set(projectId, recent)
  return true
}
