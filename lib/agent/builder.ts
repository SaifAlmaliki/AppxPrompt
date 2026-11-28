import { Agent, assistant, run, user, type AgentInputItem } from "@openai/agents"
import { and, asc, eq, ne, sql } from "drizzle-orm"

import { builds, db, messages, projects, screens, type Project, type Screen, type ServerRoute } from "@/db"
import type { Locale } from "@/i18n/config"
import {
  BACKEND_SERVICE,
  componentLabel,
  screenFilePath,
  statusEvent,
  toProjectScreen,
  toProjectServerRoute,
  type AgentEvent,
  type AppPlan,
  type PendingChanges,
  type PlannedServerRoute,
} from "@/lib/agent-protocol"
import { mergePlan } from "@/lib/agent/changes"
import { generateComponents, writeComponent } from "@/lib/agent/components"
import { BUILDER_MODEL, configureAgents } from "@/lib/agent/config"
import { changeCollections, generateFoundation } from "@/lib/agent/foundation"
import { BUILDER_INSTRUCTIONS, builderPrompt } from "@/lib/agent/instructions"
import { BuildLostError, type BuildLog } from "@/lib/agent/builds"
import { jobTimeoutSeconds } from "@/lib/jobs"
import { buildServerRoute, nextServerRoute, serviceContext } from "@/lib/agent/server-builder"
import { fatalScreenProblem, screenProblems, visibleCode } from "@/lib/agent/validate-screen"
import { refundUnfinishedBuild } from "@/lib/billing/credits"
import { getBackendStatus, isBackendLinked, setUpBackend } from "@/lib/cloudhike/backend"
import { isolate } from "@/lib/i18n/activity"
import { chatLocale, translatorFor } from "@/lib/i18n/server"
import { fillGeneratedImages, hasGeneratedImages } from "@/lib/imagekit"
import { serverAllowedHosts } from "@/lib/sandbox/bundle"
import { getSandboxRunner } from "@/lib/sandbox/runner"
import { ifIntegrations } from "@/lib/server-routes/gate"
import { SELF_TEST_BUDGET_MS, selfTestRoute } from "@/lib/server-routes/self-test"
import { finishServerRoute, listServerRoutes, saveServerHelper, setServerRouteStatus } from "@/lib/server-routes/store"
import { listServiceDefinitions, listServiceSummaries } from "@/lib/services/store"

const builderAgent = new Agent({
  name: "AppxPrompt Screen Builder",
  model: BUILDER_MODEL,
  instructions: BUILDER_INSTRUCTIONS,
})

// A step runs for as long as Jobs allows, but never past the route's own 300 seconds (app/api/jobs/build-step).
// A function's try and fixes stay within what is left of it, less a margin to answer.
const STEP_MARGIN_MS = 15_000
const SERVER_STEP_BUDGET_MS = Math.min(jobTimeoutSeconds(), 300) * 1000 - STEP_MARGIN_MS

/** The sentence about each function built since `since` that failed its test, or an empty string. Earlier failures stay on the Code tab. */
export function selfTestNote(
  rows: { path: string; purpose: string; kind: string; selfTest: string | null; selfTestDetail: string | null; updatedAt: Date }[],
  planned: PlannedServerRoute[],
  locale: Locale,
  since: Date
) {
  const t = translatorFor(locale, "agentMessages")
  const wrap = (text: string) => (locale === "ar" ? isolate(text) : text)
  return rows
    .filter((row) => row.kind === "function" && row.selfTest === "failed" && row.updatedAt >= since)
    .map((row) => {
      const name = planned.find((route) => route.path === row.path)?.id.replaceAll("-", " ") ?? row.purpose
      const summary = (row.selfTestDetail ?? "it didn't work").replace(/[.\s]+$/, "")
      return t("selfTestFailed", { name: wrap(name), summary: wrap(summary) })
    })
    .join(" ")
}

// Keeps the style reference prompt small.
const MAX_STYLE_REFERENCE = 8000

/** The project's screen rows for `plan`, recreated when the plan's screens changed. */
async function syncScreens(projectId: string, plan: AppPlan) {
  const existing = await db
    .select()
    .from(screens)
    .where(eq(screens.projectId, projectId))
    .orderBy(asc(screens.position))

  const matchesPlan =
    existing.length === plan.screens.length &&
    existing.every(
      (row, i) =>
        row.slug === plan.screens[i].id &&
        row.name === plan.screens[i].name &&
        row.filePath === screenFilePath(row.slug, i, plan.screens[i].tab)
    )
  if (matchesPlan) return existing

  return db.transaction(async (tx) => {
    await tx.delete(screens).where(eq(screens.projectId, projectId))
    return tx
      .insert(screens)
      .values(
        plan.screens.map((screen, position) => ({
          projectId,
          slug: screen.id,
          name: screen.name,
          position,
          layout: screen.layout,
          filePath: screenFilePath(screen.id, position, screen.tab),
        }))
      )
      .returning()
  })
}

/**
 * The screen rows for a new build of `plan`. Finished screens are kept and the
 * rest are queued again. Only a screen waiting for an edit has code here, and it
 * keeps that until the new code is ready.
 */
export async function prepareScreens(projectId: string, plan: AppPlan) {
  const rows = await syncScreens(projectId, plan)
  await db
    .update(screens)
    .set({ status: "pending" })
    .where(and(eq(screens.projectId, projectId), ne(screens.status, "done")))
  return rows.map((row) => (row.status === "done" ? row : { ...row, status: "pending" as const }))
}

/** Screen, component and app names are agent-authored, so in Arabic each stays in its own direction. */
const isolateNames = (names: string[], locale: Locale) => (locale === "ar" ? names.map(isolate) : names)

/** "A, B" for a list of names, with the separator of the language. */
const commaList = (items: string[], locale: Locale) => items.join(locale === "ar" ? "، " : ", ")

/** "A, B and C", with "and" in the language. */
export function listNames(items: string[], locale: Locale) {
  if (items.length < 2) return items.join("")
  return translatorFor(locale, "agentMessages")("listLast", { rest: commaList(items.slice(0, -1), locale), last: items.at(-1)! })
}

/** The message for a finished round of changes to a built app. */
export function changesSummary({ added, updated, removed, failed = [] }: PendingChanges, locale: Locale) {
  const t = translatorFor(locale, "agentMessages")
  const names = (list: string[]) => listNames(isolateNames(list, locale), locale)
  const done = [
    added.length > 0 && t("changesAdded", { names: names(added) }),
    updated.length > 0 && t("changesUpdated", { names: names(updated) }),
    removed.length > 0 && t("changesRemoved", { names: names(removed) }),
  ].filter((part): part is string => Boolean(part))
  const what = done.length > 0 ? t("changesDone", { parts: listNames(done, locale) }) : t("changesNone")
  const missed = failed.length > 0 ? ` ${t("changesMissed", { names: names(failed), count: failed.length })}` : ""
  return t("changesSummary", { what, missed })
}

/** Writes one server function or agent route, and checks it. A route that can't be written is marked failed, so the build carries on. */
async function buildServerRouteStep(log: BuildLog, project: Project, plan: AppPlan, route: PlannedServerRoute, serverRows: ServerRoute[]) {
  const row = serverRows.find((candidate) => candidate.path === route.path)!
  const requests = plan.pendingChanges?.serverRoutes
  const queued = requests !== undefined && Object.hasOwn(requests, route.path)

  const writing = await setServerRouteStatus(project.id, route.path, "generating")
  log.emit({ type: "server-route", route: toProjectServerRoute({ ...writing, code: null }) })
  log.emit(statusEvent("writingServerFunction", { name: route.purpose }))

  const stepEndsAt = Date.now() + SERVER_STEP_BUDGET_MS
  const timeLeftMs = () => stepEndsAt - Date.now()

  /** Saves the code where the sandbox reads it, and calls the route once. Free: no credits are used. */
  const tryRoute = async (code: string, testBody: Record<string, unknown>) => {
    log.emit(statusEvent("tryingServerFunction"))
    await setServerRouteStatus(project.id, route.path, "generating", code)
    const [summaries, backend] = await Promise.all([listServiceSummaries(project.id), getBackendStatus(project.id, project.userId)])
    return selfTestRoute({
      projectId: project.id,
      path: route.path,
      testBody,
      runner: getSandboxRunner(),
      usesServices: route.services,
      connectedServices: summaries.filter((service) => service.status === "connected").map((service) => service.slug),
      backendConnected: backend.state === "ready",
      backendSlug: BACKEND_SERVICE,
      budgetMs: Math.min(SELF_TEST_BUDGET_MS, timeLeftMs()),
    })
  }

  let saved: ServerRoute
  try {
    const definitions = await listServiceDefinitions(project.id)
    const result = await buildServerRoute(
      {
        plan,
        route,
        current: queued ? row.code : null,
        request: requests?.[route.path] || null,
        services: definitions.filter((definition) => route.services.includes(definition.slug)).map(serviceContext),
        helpers: serverRows.filter((other) => other.kind === "helper" && other.code !== null).map((other) => ({ path: other.path, code: other.code! })),
        dataHosts: serverAllowedHosts(plan, []),
      },
      {
        signal: log.signal,
        saveHelper: async (path, purpose, code) => {
          await saveServerHelper(project.id, path, purpose, code)
        },
        onChecking: () => log.emit(statusEvent("checkingServerFunction")),
        selfTest: { run: tryRoute, timeLeftMs },
      }
    )
    await log.flush()

    if ("code" in result) {
      saved = await finishServerRoute(project.id, route.path, result.code, result.selfTest ?? null)
    } else {
      console.error(`Writing server function ${route.path} failed`, result.problems)
      saved = await setServerRouteStatus(project.id, route.path, "failed")
    }
  } catch (error) {
    if (log.signal.aborted || error instanceof BuildLostError) throw error
    console.error(`Writing server function ${route.path} failed`, error)
    saved = await setServerRouteStatus(project.id, route.path, "failed")
  }
  log.emit({ type: "server-route", route: toProjectServerRoute(saved) })
}

/**
 * Does the next piece of a build: the foundation, or one screen, streaming each
 * file's code as it's written. Pieces that are already done are kept, so this
 * can run again after an interruption. Returns whether there's more to do.
 */
export async function runBuildStep(log: BuildLog, project: Project): Promise<boolean> {
  configureAgents()

  const plan = project.plan
  if (!plan) throw new Error(`Project ${project.id} has no plan to build.`)
  // Runs from CloudHike Jobs, with no request, so the chat language of the project words what's said.
  const locale = chatLocale(project)
  const t = translatorFor(locale, "agentMessages")

  if (!plan.themePackage || !plan.collections) {
    log.emit(statusEvent("designingFoundation"))
    const foundation = await generateFoundation(plan)
    if (hasGeneratedImages(foundation.collections)) log.emit(statusEvent("generatingAppImages"))
    const next = { ...plan, ...foundation, collections: await fillGeneratedImages(project.id, foundation.collections) }
    await log.flush()
    await db.update(projects).set({ plan: next }).where(eq(projects.id, project.id))
    log.emit({ type: "plan", plan: next })
    return true
  }

  const changes = plan.pendingChanges
  if (changes?.data) {
    log.emit(statusEvent("updatingData"))
    const collections = await fillGeneratedImages(project.id, await changeCollections(plan, changes.data))
    await log.flush()
    const next = await mergePlan(project.id, { collections, pendingChanges: { ...changes, data: null } })
    log.emit({ type: "plan", plan: next })
    return true
  }

  const rows = await db
    .select()
    .from(screens)
    .where(eq(screens.projectId, project.id))
    .orderBy(asc(screens.position))
  const isWaiting = (row: Screen) => row.status === "pending" || row.status === "generating"

  // Apps built before shared components existed keep their screens as they are.
  if (!plan.components && !rows.some((row) => row.code)) {
    log.emit(statusEvent("buildingComponents"))
    const components = await fillGeneratedImages(project.id, await generateComponents(plan))
    await log.flush()
    const next = await mergePlan(project.id, { components })
    log.emit({ type: "plan", plan: next })
    return true
  }

  // Comes before the screens, since they may use what changes here. One at a time, so an interruption keeps what's done.
  const componentChange = changes && Object.entries(changes.components ?? {})[0]
  if (componentChange) {
    const [name, { purpose, request }] = componentChange
    const library = plan.components ?? []
    const current = library.find((component) => component.name === name)
    log.emit(statusEvent("updatingComponent", { name: componentLabel(name) }))
    const code = await fillGeneratedImages(project.id, await writeComponent(plan, { name, purpose }, current?.code ?? null, request))
    await log.flush()
    const { [name]: _done, ...waiting } = changes.components!
    const next = await mergePlan(project.id, {
      components: !code
        ? library
        : current
          ? library.map((component) => (component === current ? { ...component, code } : component))
          : [...library, { name, purpose, code }],
      pendingChanges: {
        ...changes,
        components: waiting,
        failed: code ? changes.failed : [...(changes.failed ?? []), componentLabel(name)],
      },
    })
    log.emit({ type: "plan", plan: next })
    return true
  }

  // Functions come first, then agents that may import them, and both before the screens that call them.
  const serverRows = await ifIntegrations(() => listServerRoutes(project.id))
  const route = nextServerRoute(plan.serverRoutes ?? [], serverRows)
  if (route) {
    await buildServerRouteStep(log, project, plan, route, serverRows)
    return true
  }

  const row = rows.find(isWaiting)
  if (row) {
    const screen = plan.screens[row.position]
    const request = changes?.edits[row.slug]
    const edit = row.code && request ? { code: row.code, request } : null
    const styleReference = edit ? null : (rows.find((other) => other.status === "done" && other.code)?.code ?? null)
    const progress = { name: screen.name, position: row.position + 1, total: rows.length }

    // A screen being edited keeps its code here until the new code is ready, and the browser only sees the new code arrive.
    const [generating] = await db
      .update(screens)
      .set({ status: "generating", ...(edit ? {} : { code: null }) })
      .where(eq(screens.id, row.id))
      .returning()
    Object.assign(row, generating)
    const writing = () => toProjectScreen({ ...row, code: null })
    log.emit({ type: "screen", screen: writing() })
    log.emit(statusEvent("designingScreen", progress))

    /** Streams one attempt at the file to the client and returns the finished code. */
    const generate = async (input: AgentInputItem[], status: AgentEvent) => {
      const result = await run(builderAgent, input, { stream: true, signal: log.signal })
      let raw = ""
      let shown = ""
      for await (const event of result) {
        if (event.type !== "raw_model_stream_event" || event.data.type !== "output_text_delta") continue
        if (!raw) log.emit(status)
        raw += event.data.delta
        const next = visibleCode(raw)
        if (next.length > shown.length && next.startsWith(shown)) {
          log.emit({ type: "code-delta", screenId: row.id, delta: next.slice(shown.length) })
          shown = next
        }
      }
      await result.completed
      log.signal.throwIfAborted()
      return `${visibleCode(raw).trim()}\n`
    }

    try {
      const prompt = user(
        builderPrompt({
          plan,
          screen,
          position: row.position,
          styleReference: styleReference?.slice(0, MAX_STYLE_REFERENCE) ?? null,
          edit,
        })
      )
      let code = await generate([prompt], statusEvent("writingScreen", progress))

      // One rewrite if the screen breaks the rules, since it wouldn't run or follow the theme.
      const problems = screenProblems(
        code,
        (plan.collections ?? []).map((c) => c.name),
        (plan.components ?? []).map((c) => c.name),
        !edit,
        edit ? `${edit.code}\n${edit.request}` : "",
        plan.serverRoutes?.length ? plan.serverRoutes.map((route) => route.path) : null
      )
      if (problems.length > 0) {
        log.emit({ type: "screen", screen: writing() })
        log.emit(statusEvent("polishingScreen", { name: screen.name }))
        code = await generate(
          [
            prompt,
            assistant(code),
            user(
              `This file has problems:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nRewrite the complete file with these fixed and everything else kept. Reply with only the file.`
            ),
          ],
          statusEvent("rewritingScreen", progress)
        )
      }

      const fatal = fatalScreenProblem(code)
      if (fatal) throw new Error(fatal)

      if (hasGeneratedImages(code)) log.emit(statusEvent("generatingScreenImages", { name: screen.name }))
      code = await fillGeneratedImages(project.id, code)

      // Stops here if a newer execution took over, so it can't overwrite that one's screen.
      await log.flush()
      const done = await db.transaction(async (tx) => {
        if (request) {
          await tx
            .update(projects)
            .set({ plan: sql`${projects.plan} #- ${`{pendingChanges,edits,${row.slug}}`}::text[]` })
            .where(eq(projects.id, project.id))
        }
        const [saved] = await tx
          .update(screens)
          .set({ status: "done", code })
          .where(eq(screens.id, row.id))
          .returning()
        return saved
      })
      Object.assign(row, done)
    } catch (error) {
      if (log.signal.aborted || error instanceof BuildLostError) throw error
      console.error(`Generating screen "${screen.name}" failed`, error)
      const [failed] = await db
        .update(screens)
        .set({ status: "failed" })
        .where(eq(screens.id, row.id))
        .returning()
      Object.assign(row, failed)
    }
    log.emit({ type: "screen", screen: toProjectScreen(row) })
    if (rows.some(isWaiting)) return true
  }

  const built = rows.filter((row) => row.status === "done")
  // A server function or agent that couldn't be written counts like a screen that couldn't be: it fails the build, and its credits go back.
  const failed = [
    ...rows.filter((row) => row.status !== "done").map((row) => row.name),
    ...serverRows.filter((serverRow) => serverRow.kind !== "helper" && serverRow.status !== "done").map((serverRow) => serverRow.purpose),
  ]

  // Deploying can take minutes, so it gets a step of its own. It's safe to repeat if this step is retried.
  const linked = failed.length === 0 && (await isBackendLinked(project))
  if (linked && row) return true
  let backendNote = ` ${plan.backend ? t("backendCloud") : t("backendLocal")}`
  if (linked) {
    log.emit(statusEvent("settingUpBackend"))
    const result = await setUpBackend(project, { emit: (event) => log.emit(event) })
    await log.flush()
    backendNote = ` ${result.ok ? t("backendSynced") : t("backendFailed", { message: result.message })}`
  }

  const status = failed.length === 0 ? "ready" : "failed"
  await db.update(projects).set({ status }).where(eq(projects.id, project.id))
  // After a failure these stay, so trying again carries on with them.
  if (changes && status === "ready") await mergePlan(project.id, { pendingChanges: null })
  log.emit({ type: "status", label: null })
  log.emit({ type: "project-status", status })

  const refunded = status === "failed" ? await refundUnfinishedBuild(log.buildId) : 0
  const refundNote = refunded > 0 ? ` ${t("refund", { credits: refunded })}` : ""

  const names = (list: (Screen | string)[]) => commaList(isolateNames(list.map((item) => (typeof item === "string" ? item : item.name)), locale), locale)
  // Only the functions this build wrote are mentioned: an earlier failure shows on the Code tab, not in every message.
  const [thisBuild] = serverRows.some((serverRow) => serverRow.selfTest === "failed")
    ? await db.select({ createdAt: builds.createdAt }).from(builds).where(eq(builds.id, log.buildId))
    : []
  const testNote = thisBuild ? selfTestNote(serverRows, plan.serverRoutes ?? [], locale, thisBuild.createdAt) : ""
  const testSentence = testNote ? ` ${testNote}` : ""
  const content =
    failed.length === 0
      ? changes
        ? `${changesSummary(changes, locale)}${linked ? backendNote : ""}${testSentence}`
        : `${t("ready", { appName: plan.appName, count: built.length, names: names(built), backendNote })}${testSentence}`
      : built.length === 0
        ? t("failedNone", { refundNote })
        : t("failedSome", { built: built.length, total: rows.length, names: names(failed), refundNote, count: failed.length })

  const saved = await db.transaction(async (tx) => {
    // Everything asked for so far is done. This message says what was, so later requests can still refer to it.
    if (failed.length === 0) await tx.update(messages).set({ handled: true }).where(eq(messages.projectId, project.id))
    const [message] = await tx
      .insert(messages)
      .values({ projectId: project.id, role: "assistant", content })
      .returning({ id: messages.id, role: messages.role, content: messages.content, plan: messages.plan })
    return message
  })
  log.emit({ type: "message", message: saved })
  return false
}
