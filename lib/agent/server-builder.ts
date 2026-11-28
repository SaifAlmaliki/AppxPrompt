import { Agent, assistant, run, tool, user, type AgentInputItem, type Tool } from "@openai/agents"
import { z } from "zod"

import {
  BACKEND_SERVICE,
  RESERVED_HELPER_FILE,
  SERVER_HELPER_FILE,
  SYSTEM_SERVER_FILES,
  type AppPlan,
  type PlannedServerRoute,
  type ScreenStatus,
} from "@/lib/agent-protocol"
import { BUILDER_MODEL } from "@/lib/agent/config"
import { SERVER_BUILDER_INSTRUCTIONS, serverBuilderPrompt } from "@/lib/agent/instructions"
import { endRunAtMaxTurns } from "@/lib/agent/max-turns"
import { createResearchTools, newResearchBudget, type ResearchBudget } from "@/lib/agent/research-tools"
import { validateServerRoute } from "@/lib/agent/validate-server-route"
import { visibleCode } from "@/lib/agent/validate-screen"
import { SELF_TEST_REASONS } from "@/lib/server-routes/self-test-protocol"
import { SELF_TEST_MIN_STEP_MS, summarizeSelfTest, type SelfTestResult } from "@/lib/server-routes/self-test"
import { refreshTokenName, type ServiceDefinition } from "@/lib/services/protocol"

export type ServerServiceContext = { slug: string; name: string; notes: string; allowedHosts: string[]; credentialNames: string[] }

export type ServerRouteContext = {
  plan: AppPlan
  route: PlannedServerRoute
  current: string | null
  request: string | null
  /** The services this route uses. */
  services: ServerServiceContext[]
  helpers: { path: string; code: string }[]
  /** The hosts of the app's own data and sign-in, which a route using the backend may call. */
  dataHosts: string[]
}

/** How the one try of a route went, as it's kept: the detail is the plain reason it failed or wasn't tried. */
export type RouteSelfTest = { status: SelfTestResult["status"]; detail: string | null }

export type SelfTestHooks = {
  /** Saves `code` where the sandbox reads it and calls the route once with `testBody`. */
  run: (code: string, testBody: Record<string, unknown>) => Promise<SelfTestResult>
  /** How much of the build step is left. */
  timeLeftMs?: () => number
}

/** `stop` aborts the call when the build step can't wait for it any longer. */
export type Generate = (input: AgentInputItem[], stop?: AbortSignal) => Promise<string>

type ValidationContext = Parameters<typeof validateServerRoute>[1]

// Research takes a model call per search or page, and saving a helper takes one more.
const MAX_SERVER_BUILDER_TURNS = 16

/** What the builder is told about a service. Credential names only, never values. */
export function serviceContext(definition: ServiceDefinition): ServerServiceContext {
  return {
    slug: definition.slug,
    name: definition.name,
    notes: definition.notes,
    allowedHosts: definition.allowedHosts,
    credentialNames: [
      ...definition.fields.map((field) => field.name),
      ...(definition.authKind === "oauth2" ? [refreshTokenName(definition.slug)] : []),
    ],
  }
}

const unique = <T>(values: T[]) => [...new Set(values)]

/** The first waiting function route, and only when none is waiting, the first waiting agent route. */
export function nextServerRoute(
  planned: PlannedServerRoute[],
  rows: { path: string; status: ScreenStatus }[]
): PlannedServerRoute | null {
  const waiting = (kind: PlannedServerRoute["kind"]) =>
    planned.find(
      (route) =>
        route.kind === kind &&
        rows.some((row) => row.path === route.path && (row.status === "pending" || row.status === "generating"))
    ) ?? null
  return waiting("function") ?? waiting("agent")
}

export function routeValidationContext(ctx: ServerRouteContext): ValidationContext {
  return {
    path: ctx.route.path,
    credentialNames: unique(ctx.services.flatMap((service) => service.credentialNames)),
    allowedHosts: unique([
      ...ctx.services.flatMap((service) => service.allowedHosts),
      ...(ctx.route.services.includes(BACKEND_SERVICE) ? ctx.dataHosts : []),
    ]),
    helperPaths: ctx.helpers.map((helper) => helper.path),
  }
}

const saveHelperSchema = z.object({
  path: z.string().describe("The helper file, server/<name>.ts, e.g. 'server/google.ts'"),
  purpose: z.string().describe("One sentence on what it does"),
  code: z.string().describe("The complete contents of the .ts file"),
})

export function createSaveHelperTool(
  ctx: ServerRouteContext,
  save: (path: string, purpose: string, code: string) => Promise<void>
): Tool {
  return tool({
    name: "save_helper",
    description:
      "Save shared server code, such as getting an access token from a refresh token, as a helper file at server/<name>.ts that routes can import. It is checked first, and you can import it right after it's saved. Save a helper before the file that uses it.",
    parameters: saveHelperSchema,
    async execute({ path, purpose, code }) {
      const isHelperPath =
        SERVER_HELPER_FILE.test(path) && !(SYSTEM_SERVER_FILES as readonly string[]).includes(path) && !RESERVED_HELPER_FILE.test(path)
      if (!isHelperPath) return `Helper not saved: ${path} isn't a helper path. Use server/<name>.ts.`

      const base = routeValidationContext(ctx)
      const problems = validateServerRoute(code, {
        ...base,
        path,
        helperPaths: base.helperPaths.filter((helper) => helper !== path),
      })
      if (problems.length > 0) {
        return `Helper not saved:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nFix them and call save_helper again.`
      }

      await save(path, purpose, code)
      const saved = { path, code }
      const at = ctx.helpers.findIndex((helper) => helper.path === path)
      if (at === -1) ctx.helpers.push(saved)
      else ctx.helpers[at] = saved
      return `Saved ${path}. Import it from "@/${path.replace(/\.ts$/, "")}".`
    },
  })
}

type RunContext = { research: ResearchBudget }

export async function buildServerRoute(
  ctx: ServerRouteContext,
  options: {
    generate?: Generate
    signal?: AbortSignal
    saveHelper: (path: string, purpose: string, code: string) => Promise<void>
    /** Appended to the prompt. Phase 4's agent rules. */
    extraPrompt?: string
    /** Added to the paths the file may import. */
    extraHelperPaths?: string[]
    /** More problems, after those of `validateServerRoute`. */
    extraValidate?: (code: string) => string[]
    /** Called before each check of a written file. */
    onChecking?: () => void
    /** Tries a checked function once, and gives the builder a chance to fix what fails. Without it, nothing is tried. */
    selfTest?: SelfTestHooks
  }
): Promise<{ code: string; selfTest?: RouteSelfTest } | { problems: string[] }> {
  const generate: Generate =
    options.generate ??
    (() => {
      const agent = new Agent<RunContext>({
        name: "AppxPrompt Server Builder",
        model: BUILDER_MODEL,
        instructions: SERVER_BUILDER_INSTRUCTIONS,
        tools: [...createResearchTools<RunContext>(), createSaveHelperTool(ctx, options.saveHelper)],
      })
      // One budget for this build step, kept across its rewrite.
      const context: RunContext = { research: newResearchBudget() }
      return async (input, stop) => {
        const signal = stop && options.signal ? AbortSignal.any([options.signal, stop]) : (stop ?? options.signal)
        const result = await run(agent, input, { context, signal, maxTurns: MAX_SERVER_BUILDER_TURNS, errorHandlers: endRunAtMaxTurns })
        options.signal?.throwIfAborted()
        return `${visibleCode(typeof result.finalOutput === "string" ? result.finalOutput : "").trim()}\n`
      }
    })()

  const problemsOf = (code: string) => {
    options.onChecking?.()
    const base = routeValidationContext(ctx)
    return [
      ...validateServerRoute(code, { ...base, helperPaths: [...base.helperPaths, ...(options.extraHelperPaths ?? [])] }),
      ...(options.extraValidate?.(code) ?? []),
    ]
  }

  const prompt = user(serverBuilderPrompt(ctx) + (options.extraPrompt ? `\n\n${options.extraPrompt}` : ""))
  let code = visibleCode(await generate([prompt])).trim() + "\n"
  let problems = problemsOf(code)
  if (problems.length > 0) {
    code = visibleCode(
      await generate([
        prompt,
        assistant(code),
        user(
          `This file has problems:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nRewrite the complete file with these fixed and everything else kept. Reply with only the file.`
        ),
      ])
    ).trim() + "\n"
    problems = problemsOf(code)
    if (problems.length > 0) return { problems }
  }

  const selfTest = options.selfTest
  if (!selfTest) return { code }
  if (ctx.route.kind !== "function") return { code, selfTest: { status: "skipped", detail: SELF_TEST_REASONS.agent } }

  let testBody = extractTestBody(code)
  if (testBody === SKIP_TEST) return { code, selfTest: { status: "skipped", detail: SELF_TEST_REASONS.sendsOrSpends } }
  let outcome = await runSelfTest(selfTest, code, testBody, options.signal)
  let earlierFailure: string | null = null
  for (let round = 0; outcome.result.status === "failed"; round++) {
    const summary = summarizeSelfTest(outcome.result)
    earlierFailure = summary
    const failed: RouteSelfTest = { status: "failed", detail: summary }
    const left = selfTest.timeLeftMs?.() ?? Infinity
    if (round >= MAX_FIX_ROUNDS || left < FIX_ROUND_MIN_MS) return { code, selfTest: failed }

    // The fix may take no longer than what leaves room for trying it again.
    const stop = left === Infinity ? undefined : AbortSignal.timeout(left - SELF_TEST_MIN_STEP_MS)
    let fixed: string
    try {
      fixed = visibleCode(await generate([prompt, assistant(code), user(selfTestFixMessage(summary))], stop)).trim() + "\n"
    } catch (error) {
      options.signal?.throwIfAborted()
      if (!stop?.aborted) throw error
      return { code, selfTest: failed }
    }
    options.signal?.throwIfAborted()
    // A fix that breaks the rules isn't kept: the file that passed the checks stays, as a failed test.
    if (problemsOf(fixed).length > 0) return { code, selfTest: failed }
    code = fixed
    const next = extractTestBody(code)
    if (next === SKIP_TEST) {
      outcome = { result: { status: "skipped", reason: SELF_TEST_REASONS.sendsOrSpends } }
    } else {
      testBody = next ?? testBody
      outcome = await runSelfTest(selfTest, code, testBody, options.signal)
    }
  }
  const { result } = outcome
  // A fix that couldn't be tried again doesn't hide that the route failed before.
  if (result.status === "skipped" && earlierFailure !== null) {
    return { code, selfTest: { status: "failed", detail: `${earlierFailure} (the fix wasn't tried again)` } }
  }
  return { code, selfTest: { status: result.status, detail: result.status === "skipped" ? (result.reason ?? null) : null } }
}
/** The message the builder gets when its route failed the one try. */
export const selfTestFixMessage = (summary: string) => `The route didn't work when tried: ${summary}. Fix it and save it again.`

const MAX_FIX_ROUNDS = 2
/** A fix takes a model call and another try, so one doesn't start with less than this left of the step. */
const FIX_ROUND_MIN_MS = 2 * SELF_TEST_MIN_STEP_MS
const MAX_TEST_BODY_LENGTH = 4000
const TEST_BODY_LINE = /^[ \t]*\/\/[ \t]*testBody:[ \t]*(\{.*\}|skip)[ \t]*$/

/** What `// testBody: skip` gives: the route sends or spends something, so it isn't tried. */
export const SKIP_TEST = Symbol("skip-test")

/** The sample request the builder gave on the first non-empty line of its file, SKIP_TEST for `skip`, or null when there isn't a usable one. */
export function extractTestBody(code: string): Record<string, unknown> | typeof SKIP_TEST | null {
  const first = code.split(/\r?\n/).find((line) => line.trim() !== "")
  const line = first === undefined ? undefined : TEST_BODY_LINE.exec(first)?.[1]
  if (line === "skip") return SKIP_TEST
  if (!line || line.length > MAX_TEST_BODY_LENGTH) return null
  try {
    const body: unknown = JSON.parse(line)
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function runSelfTest(
  selfTest: SelfTestHooks,
  code: string,
  testBody: Record<string, unknown> | null,
  signal: AbortSignal | undefined
): Promise<{ result: SelfTestResult }> {
  if (testBody === null) return { result: { status: "skipped", reason: SELF_TEST_REASONS.noSampleRequest } }
  if ((selfTest.timeLeftMs?.() ?? Infinity) < SELF_TEST_MIN_STEP_MS) return { result: { status: "skipped", reason: SELF_TEST_REASONS.notEnoughTime } }
  try {
    return { result: await selfTest.run(code, testBody) }
  } catch (error) {
    signal?.throwIfAborted()
    console.error("Trying a server function failed", error instanceof Error ? error.name : "unknown")
    return { result: { status: "skipped", reason: SELF_TEST_REASONS.couldNotRun } }
  }
}
