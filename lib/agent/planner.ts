import { Agent, assistant, run, tool, user, type AgentInputItem, type Tool } from "@openai/agents"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { db, messages, projects, screens, type Project, type Screen, type ServerRoute } from "@/db"
import { MAX_TABS, MIN_TABS, SCREEN_LAYOUTS, statusEvent, type AppPlan, type ChatMessage, type StatusKey } from "@/lib/agent-protocol"
import { mergePlan, normalizeServerRoutes, planAppChanges, slugify, type AppChanges } from "@/lib/agent/changes"
import { configureAgents, DEFAULT_SCREEN_COUNT, PLANNER_MODEL } from "@/lib/agent/config"
import { plannerInstructions, type PlannerState } from "@/lib/agent/instructions"
import { firstPlanGate, MAX_INTERVIEW_REPLIES, MIN_INTERVIEW_REPLIES } from "@/lib/agent/first-plan-gate"
import { createLeakFilter, findLeakedToolCall } from "@/lib/agent/leaked-tool-call"
import { endRunAtMaxTurns } from "@/lib/agent/max-turns"
import { createResearchTools, newResearchBudget, type ResearchBudget } from "@/lib/agent/research-tools"
import type { ProjectRun } from "@/lib/agent/runs"
import { BACKEND_SERVICES } from "@/lib/backend-protocol"
import { screenLimitMessage } from "@/lib/billing/credits"
import { getBackendStatus, setUpBackend } from "@/lib/cloudhike/backend"
import { chatLocale, translatorFor } from "@/lib/i18n/server"
import { buildCost, PLANS } from "@/lib/plans"
import { expandNumberReply } from "@/lib/interview-choices"
import { normalizeService, serviceDefinitionSchema } from "@/lib/services/definition"
import { integrationsEnabled } from "@/lib/services/flags"
import { ifIntegrations } from "@/lib/server-routes/gate"
import { listServerRoutes } from "@/lib/server-routes/store"
import { plannerServices } from "@/lib/services/status"
import { getServiceNotes, listServiceSummaries, registerService as registerServiceDefinition } from "@/lib/services/store"
import { HEX_COLOR, themeFromDesign } from "@/lib/themes"

type PlannerContext = PlannerState & {
  project: Project
  projectId: string
  run: ProjectRun
  rows: Pick<Screen, "slug" | "name" | "code">[]
  serverRows: Pick<ServerRoute, "path" | "code">[]
  /** The plan proposed during this turn, saved with the reply. */
  proposedPlan: AppPlan | null
  /** Assistant replies already saved in this chat, before this turn. */
  priorAssistantReplies: number
  /** The person's latest message, used to see if they want to skip the interview. */
  latestUserMessage: string
  /** Set once propose_plan is refused this turn, so it isn't tried again until they've been asked something. */
  interviewBlocked: boolean
  confirmed: boolean
  /** The changes to a built app asked for during this turn, made right after the reply. */
  changes: AppChanges | null
  /** What's left of this turn's searches and page reads. */
  research: ResearchBudget
}

const serverRouteSchema = z.object({
  id: z.string().describe("Short kebab-case id, e.g. 'booking-slots'"),
  path: z.string().describe("The route file, app/api/<name>+api.ts, e.g. 'app/api/booking/slots+api.ts'. Nested folders are fine."),
  purpose: z.string().describe("One plain sentence on what it does and what it returns"),
  kind: z.enum(["function", "agent"]),
  services: z
    .array(z.string())
    .describe("Slugs of the registered services it uses, plus 'backend' if it reads or saves the app's own data"),
  access: z.enum(["public", "signed_in"]).describe("Who can call it. It answers POST only."),
})

const screenSchema = z.object({
  id: z.string().describe("Unique kebab-case slug, e.g. 'workout-detail'"),
  name: z.string().describe("Screen name, e.g. 'Workout Detail'"),
  purpose: z.string().describe("One sentence on what the user does here"),
  keyElements: z.array(z.string()).describe("3 to 6 concrete UI elements with real content"),
  layout: z
    .enum(SCREEN_LAYOUTS)
    .describe("Closest wireframe: home (dashboard), list (feed/search), detail (one item), profile (account/settings)"),
  navigatesTo: z.array(z.string()).describe("Ids of screens this screen links to"),
  tab: z
    .object({
      label: z.string().describe("Short tab label, e.g. 'Home'"),
      icon: z.string().describe("Ionicons outline name, e.g. 'home-outline'"),
    })
    .nullable()
    .describe("How this screen appears in the shared tab bar, or null if it isn't a tab"),
})

// No min/max/regex constraints: not every model behind CloudHike accepts them
// in strict tool schemas. `propose_plan` checks the rules itself instead.
const planSchema = z.object({
  appName: z.string().describe("Short, brandable app name"),
  tagline: z.string().describe("One line describing the app"),
  summary: z.string().describe("2 to 3 sentences: what the app does and its core user journeys"),
  targetUsers: z.string().describe("Who the app is for"),
  navigation: z.enum(["tabs", "stack"]),
  design: z.object({
    style: z.string().describe("Visual style in a few words, e.g. 'calm, minimal, rounded cards'"),
    mode: z.enum(["light", "dark"]),
    primaryColor: z.string().describe("Hex color, e.g. #6D28D9"),
    accentColor: z.string().describe("Hex color"),
    backgroundColor: z.string().describe("Hex color"),
  }),
  screens: z
    .array(screenSchema)
    .describe(`At most ${DEFAULT_SCREEN_COUNT}, plus a default Sign In screen, unless the person explicitly asks for more, in build order. The first one is where the app opens.`),
  serverRoutes: z
    .array(serverRouteSchema)
    .describe("Server functions the screens call. Empty unless a feature needs an outside service or must do work screens can't be trusted with."),
  confidence: z
    .number()
    .describe(
      "How sure you are, from 0 to 100, that this plan is what they want: the screens, where the main content comes from, and the outside services."
    ),
  openDecisions: z
    .array(z.string())
    .describe("Choices still open that would change the screens, the data, or the outside services. Empty when none. At most 5, each under 200 characters."),
})

const appChangesSchema = z.object({
  appName: z.string().nullable().describe("The new app name, or null to keep it"),
  navigation: z.enum(["tabs", "stack"]).nullable().describe("The new navigation style, or null to keep it"),
  addScreens: z
    .array(screenSchema)
    .describe("New screens the person's latest message asks for. Never a screen the current plan already has."),
  editScreens: z
    .array(
      screenSchema.extend({
        id: z.string().describe("The id of a screen in the current plan. It can't change, even when renaming."),
        request: z.string().describe("Exactly what to change in this screen's code, with every detail the person gave"),
      })
    )
    .describe("Existing screens to change, each with its complete updated details and what to change"),
  removeScreenIds: z.array(z.string()).describe("Ids of screens to delete"),
  addComponents: z
    .array(
      z.object({
        name: z.string().describe("New PascalCase name, e.g. 'RatingStars'"),
        purpose: z.string().describe("One sentence on what it draws"),
        request: z.string().describe("What it looks like, what it does, and the props screens will pass it"),
      })
    )
    .describe("New shared components that several screens need. Name them in the request of each screen that should use them."),
  editComponents: z
    .array(
      z.object({
        name: z.string().describe("The name of a shared component the app has"),
        request: z.string().describe("Exactly what to change in this component's code, with every detail the person gave"),
      })
    )
    .describe("Shared components to change. Every screen using one updates without being rewritten, so prefer this to editScreens."),
  firstScreenId: z.string().nullable().describe("Id of the screen the app should now open on, or null to keep it"),
  dataChange: z
    .string()
    .nullable()
    .describe("What the app needs to store that it doesn't yet: new collections or fields, with sample data ideas. Null if nothing."),
  addServerRoutes: z.array(serverRouteSchema).describe("New server functions the person's latest message needs. Never one the current plan already has."),
  editServerRoutes: z
    .array(serverRouteSchema.extend({ request: z.string().describe("Exactly what to change in this function, with every detail the person gave") }))
    .describe("Existing server functions to change, each with its complete updated details and what to change. The path can't change."),
  removeServerRoutePaths: z.array(z.string()).describe("Paths of server functions to delete. The screens that call them are rewritten without the calls."),
  removeServices: z
    .array(z.string())
    .describe("Slugs of registered services the app should stop using. Their keys are deleted, and the functions and screens that used them are rewritten without them."),
})

const themeSchema = z.object({
  themeId: z.string().nullable().describe("The id of an existing theme to switch to, or null when making a new one"),
  newTheme: z
    .object({
      name: z.string().describe("Short evocative name"),
      mode: z.enum(["light", "dark"]),
      primaryColor: z.string().describe("Hex color, e.g. #6D28D9"),
      accentColor: z.string().describe("Hex color"),
      backgroundColor: z.string().describe("Hex color"),
    })
    .nullable()
    .describe("Colors for a new theme to add and switch to, or null when using an existing theme"),
})

const backendSchema = z.object({
  services: z
    .array(z.enum(BACKEND_SERVICES))
    .describe("Services the person asked for by name. What the screens need is added for you, so this is often empty."),
  sharedCollections: z
    .array(z.string())
    .nullable()
    .describe("Names of the collections everyone should see the same records of, or null to keep them as they are"),
  acceptEmailPolicy: z.boolean().describe("True only if the person's latest message accepts CloudHike's email policy"),
})

/** Tidies a proposed plan, or returns why it can't be used. */
function normalizePlan(input: z.infer<typeof planSchema>, maxScreens: number, ctx: PlannerContext): AppPlan | string {
  if (input.screens.length < 1 || input.screens.length > maxScreens) {
    return `The plan has ${input.screens.length} screens. Plan between 1 and ${maxScreens}.`
  }
  for (const [key, color] of Object.entries(input.design)) {
    if (key.endsWith("Color") && !HEX_COLOR.test(color)) {
      return `design.${key} must be a 6-digit hex color like #6D28D9, not "${color}".`
    }
  }

  const tabs = input.screens.filter((screen) => screen.tab).length
  if (input.navigation === "tabs" && (tabs < MIN_TABS || tabs > MAX_TABS)) {
    return `The plan has ${tabs} tabs. Tab navigation has between ${MIN_TABS} and ${MAX_TABS}, so set tab on the top-level screens, or use stack navigation.`
  }

  const used = new Set<string>()
  const idMap = new Map<string, string>()
  const screens = input.screens.map((screen) => {
    let id = slugify(screen.id || screen.name)
    for (let n = 2; used.has(id); n++) id = `${slugify(screen.id || screen.name)}-${n}`
    used.add(id)
    idMap.set(screen.id, id)
    return { ...screen, id, tab: input.navigation === "tabs" ? screen.tab : null }
  })
  for (const screen of screens) {
    screen.navigatesTo = [
      ...new Set(screen.navigatesTo.map((id) => idMap.get(id) ?? slugify(id)).filter((id) => used.has(id) && id !== screen.id)),
    ]
  }
  const serverRoutes = normalizeServerRoutes(input.serverRoutes, {
    services: ctx.services.map((service) => service.slug),
    enabled: integrationsEnabled(),
  })
  if (typeof serverRoutes === "string") return serverRoutes
  const { confidence: _confidence, openDecisions: _openDecisions, ...saved } = input
  return { ...saved, screens, serverRoutes }
}

const UPGRADE_NOTE = "The person now sees a popup about upgrading to Pro, so mention it in one short sentence and don't repeat what it says."

/** For a request Free's screen limit stops. Pro has nothing to upgrade to, so it only gets the reason. */
function screenLimitReached(ctx: PlannerContext) {
  if (ctx.account.plan !== "free") return screenLimitMessage(ctx.account.plan)
  ctx.run.emit({ type: "upgrade", reason: "screens" })
  return `${screenLimitMessage(ctx.account.plan)} ${UPGRADE_NOTE}`
}

/** Checks there's enough for this work, so the reply can say so. The build itself is what charges for it. */
function creditsMissing(ctx: PlannerContext, plan: AppPlan) {
  const cost = buildCost(plan, ctx.rows, ctx.serverRows)
  if (cost <= ctx.account.credits) return null
  ctx.run.emit({ type: "upgrade", reason: "credits" })
  return `This costs ${cost} credits and the person has ${ctx.account.credits}. ${UPGRADE_NOTE}`
}

/** True when the person wants a plan now, without more questions. */
function declinesInterview(text: string) {
  return /\b(just (build|plan|do it)|you decide|your call|skip (the )?questions|don'?t ask|do not ask|no questions|go ahead and (plan|build)|surprise me|whatever you think)\b/i.test(text)
}

const proposePlan = tool<typeof planSchema, PlannerContext>({
  name: "propose_plan",
  description:
    `Show the person the app plan (or a revised plan) as a card in the chat, with a button to confirm it. Always pass the complete plan. On a project with no plan yet, don't call this until they have answered at least ${MIN_INTERVIEW_REPLIES} questions (up to ${MAX_INTERVIEW_REPLIES} if you're still unsure), or they told you to decide. Revising a plan they can already see is immediate.`,
  parameters: planSchema,
  async execute(input, runContext) {
    const ctx = runContext!.context
    if (ctx.status === "building") return "The app is being built right now, so the plan can't change."
    if (ctx.builtScreens > 0) return "The app is already built. Use update_app to change it, which keeps the finished screens."
    const refusal = firstPlanGate({
      hasPlan: Boolean(ctx.plan),
      declined: declinesInterview(ctx.latestUserMessage),
      replies: ctx.priorAssistantReplies,
      blocked: ctx.interviewBlocked,
      confidence: input.confidence,
      openDecisions: input.openDecisions,
    })
    if (refusal) {
      ctx.interviewBlocked = true
      return refusal
    }

    if (input.screens.length > PLANS[ctx.account.plan].maxScreens) {
      return `Plan not saved: ${screenLimitReached(ctx)} Call propose_plan again with what matters most within the limit, folding the rest into those screens.`
    }
    const plan = normalizePlan(input, PLANS[ctx.account.plan].maxScreens, ctx)
    if (typeof plan === "string") return `Plan not saved: ${plan} Fix it and call propose_plan again.`

    await db.update(projects).set({ plan, status: "planning" }).where(eq(projects.id, ctx.projectId))
    if (ctx.status !== "planning") ctx.run.emit({ type: "project-status", status: "planning" })
    ctx.plan = plan
    ctx.status = "planning"
    ctx.proposedPlan = plan
    ctx.run.emit({ type: "plan", plan })
    return `Plan saved. The person now sees it as a card listing all ${plan.screens.length} screens, with a "Confirm & build" button.`
  },
})

const confirmPlan = tool<z.ZodObject<Record<string, never>>, PlannerContext>({
  name: "confirm_plan",
  description:
    "Start building the app from the current plan. Only call this when the person's latest message clearly approves the plan.",
  parameters: z.object({}),
  async execute(_input, runContext) {
    const ctx = runContext!.context
    if (!ctx.plan) return "There's no plan to confirm yet. Propose one first."
    if (ctx.status === "building" || ctx.status === "ready") return "The app is already built or being built."
    const missing = creditsMissing(ctx, ctx.plan)
    if (missing) return `Not started: ${missing}`
    ctx.confirmed = true
    return "Confirmed. The build starts right after your reply, one screen at a time."
  },
})

const updateApp = tool<typeof appChangesSchema, PlannerContext>({
  name: "update_app",
  description:
    "Change the built app: add, edit, rename, or remove screens, add or edit its shared components, add, edit, or remove its server functions, remove services it no longer uses, choose the screen it opens on, and add to its data. Put everything the person's latest message asks for in one call, and nothing from earlier messages. The work starts right after your reply.",
  parameters: appChangesSchema,
  async execute(input, runContext) {
    const ctx = runContext!.context
    if (ctx.status === "building") return "The app is being built right now, so wait until it finishes."
    if (!ctx.plan || ctx.builtScreens === 0) return "No screens are built yet. Plan the app with propose_plan instead."
    if (ctx.changes) return "The changes are already queued. Tell the person what's being done."

    const screenCount = ctx.plan.screens.length + input.addScreens.length - input.removeScreenIds.length
    if (input.addScreens.length > 0 && screenCount > PLANS[ctx.account.plan].maxScreens) {
      return `Nothing changed: ${screenLimitReached(ctx)} Offer to fold this into an existing screen, or to replace a screen.`
    }
    const changes = planAppChanges(ctx.plan, ctx.rows, input, PLANS[ctx.account.plan].maxScreens, {
      services: ctx.services.map((service) => service.slug),
      enabled: integrationsEnabled(),
    })
    if (typeof changes === "string") return `Nothing changed: ${changes} Fix it and call update_app again.`
    const missing = creditsMissing(ctx, changes.plan)
    if (missing) return `Nothing changed: ${missing}`
    ctx.changes = changes
    ctx.services = ctx.services.filter((service) => !changes.removedServices.includes(service.slug))
    return "Queued. The changes start right after your reply, so don't say they're finished yet."
  },
})

const setTheme = tool<typeof themeSchema, PlannerContext>({
  name: "set_theme",
  description: "Switch the whole app to one of its themes, or add a new theme and switch to it. It applies straight away, with no screen rebuilt.",
  parameters: themeSchema,
  async execute({ themeId, newTheme }, runContext) {
    const ctx = runContext!.context
    const themePackage = ctx.plan?.themePackage
    if (!themePackage) return "This app has no themes yet, because it was built before they existed."

    let next = themePackage
    if (newTheme) {
      const colors = [newTheme.primaryColor, newTheme.accentColor, newTheme.backgroundColor]
      if (!colors.every((color) => HEX_COLOR.test(color))) return "Theme not saved: colors must be 6-digit hex values like #6D28D9."
      let id = slugify(newTheme.name)
      for (let n = 2; themePackage.themes.some((theme) => theme.id === id); n++) id = `${slugify(newTheme.name)}-${n}`
      const theme = { ...themeFromDesign(newTheme), id, name: newTheme.name }
      next = { activeThemeId: id, themes: [...themePackage.themes, theme] }
    } else if (themeId && themePackage.themes.some((theme) => theme.id === themeId)) {
      next = { ...themePackage, activeThemeId: themeId }
    } else {
      return `Theme not saved: use one of these ids: ${themePackage.themes.map((theme) => theme.id).join(", ")}.`
    }

    ctx.plan = await mergePlan(ctx.projectId, { themePackage: next })
    ctx.run.emit({ type: "plan", plan: ctx.plan })
    return "Done. The whole app now uses this theme."
  },
})

// The agent only gets this tool, and not CloudHike's MCP tools directly: those can read the
// project's secrets and reach every project in the person's workspace.
const setupBackend = tool<typeof backendSchema, PlannerContext>({
  name: "setup_backend",
  description:
    "Deploy the app's CloudHike backend and connect the app to it, so its data is stored in the cloud and syncs live. Adds only what's missing. Waits until the services are running.",
  parameters: backendSchema,
  async execute({ services, sharedCollections, acceptEmailPolicy }, runContext) {
    const ctx = runContext!.context
    if (ctx.status === "building") return "The app is being built right now, and the backend is set up when that finishes."
    if (ctx.builtScreens === 0) return "No screens are built yet. The backend is set up on its own once the build finishes."
    if (!ctx.backend.accountConnected || ctx.backend.state === "disconnected") {
      return "CloudHike isn't connected. Ask the person to click Connect Backend at the top of the workspace."
    }
    if (services.includes("email") && !acceptEmailPolicy && !ctx.backend.services.some((service) => service.type === "email")) {
      return "Nothing was deployed. Email needs the person to accept https://cloudhike.dev/legal/email-policy first. Ask them, or call this again without email."
    }

    if (sharedCollections && ctx.plan?.collections) {
      const collections = ctx.plan.collections.map((c) => ({ ...c, shared: sharedCollections.includes(c.name) }))
      ctx.plan = await mergePlan(ctx.projectId, { collections })
    }
    const result = await setUpBackend(ctx.project, { services, acceptEmailPolicy, emit: (event) => ctx.run.emit(event) })
    ctx.backend = await getBackendStatus(ctx.projectId, ctx.project.userId)
    if (!result.ok) return `The backend wasn't set up: ${result.message}`
    ctx.plan = result.plan
    return `Done. The app now saves to CloudHike, and these are running: ${result.services.map((service) => service.type).join(", ")}. Data people saved on the device isn't moved over.`
  },
})

const registerService = tool<typeof serviceDefinitionSchema, PlannerContext>({
  name: "register_service",
  description:
    "Add or update an outside service the app needs (an AI provider, a calendar, a social API), with the credentials the owner must provide. Opens the dialog where the owner enters them. Never ask for credentials in the chat.",
  parameters: serviceDefinitionSchema,
  async execute(input, runContext) {
    const ctx = runContext!.context
    const definition = normalizeService(input)
    if (typeof definition === "string") return `Service not saved: ${definition} Fix it and call register_service again.`

    const summary = await registerServiceDefinition(ctx.projectId, definition)
    if (typeof summary === "string") return `Service not saved: ${summary} Fix it and call register_service again.`
    const summaries = await listServiceSummaries(ctx.projectId)
    ctx.run.emit({ type: "services", services: summaries })
    ctx.services = plannerServices(summaries)

    if (summary.status !== "connected") {
      ctx.run.emit({ type: "service-request", slug: definition.slug })
      return "The dialog is open. The owner adds the values there, never in the chat. Tell them in one or two sentences what to get and that it's stored encrypted."
    }
    return "Already connected."
  },
})

const notesSchema = z.object({ slug: z.string().describe("The service's slug, e.g. 'google-calendar'") })

const readServiceNotes = tool<typeof notesSchema, PlannerContext>({
  name: "read_service_notes",
  description:
    "Read the research notes saved for a service the app already has. Call it before register_service updates that service, so nothing learned earlier is lost.",
  parameters: notesSchema,
  async execute({ slug }, runContext) {
    const ctx = runContext!.context
    const notes = await getServiceNotes(ctx.projectId, slug)
    if (notes === null) return `No service "${slug}" is registered.`
    return `Notes saved for ${slug}:\n${notes || "(none)"}\n\nWhen you call register_service for it again, keep everything here that's still true and add what you learned.`
  },
})

const BASE_TOOLS = [proposePlan, confirmPlan, updateApp, setTheme, setupBackend]

/** The planner's tools for one turn. The instructions get the same flag, so they can't disagree. */
export function plannerTools(integrations: boolean): Tool<PlannerContext>[] {
  return integrations ? [...BASE_TOOLS, registerService, readServiceNotes, ...createResearchTools<PlannerContext>()] : [...BASE_TOOLS]
}

const plannerAgents = new Map<boolean, Agent<PlannerContext>>()

function plannerAgentFor(integrations: boolean) {
  let agent = plannerAgents.get(integrations)
  if (!agent) {
    agent = new Agent<PlannerContext>({
      name: "AppxPrompt Planner",
      model: PLANNER_MODEL,
      instructions: (runContext) => plannerInstructions(runContext.context),
      tools: plannerTools(integrations),
    })
    plannerAgents.set(integrations, agent)
  }
  return agent
}

let warnedAboutSearch = false

/** A dev hint, once per process. It never logs the key. */
export function warnIfSearchUnavailable() {
  if (warnedAboutSearch || !integrationsEnabled() || process.env.TAVILY_API_KEY) return
  warnedAboutSearch = true
  console.warn("APP_INTEGRATIONS is on but TAVILY_API_KEY isn't set, so the agent can't search the web.")
}

// Research takes a model call per search or page, so the SDK's default of 10 is too few.
const MAX_PLANNER_TURNS = 24

const TOOL_STATUS: Record<string, StatusKey> = {
  propose_plan: "draftingPlan",
  confirm_plan: "confirmingPlan",
  update_app: "workingOutChanges",
  set_theme: "changingTheme",
  setup_backend: "settingUpBackend",
  register_service: "registeringService",
  web_search: "searchingWeb",
  read_page: "readingDocs",
  read_service_notes: "readingServiceNotes",
}

function toInputItems(thread: Pick<ChatMessage, "role" | "content" | "plan">[]): AgentInputItem[] {
  return thread.map((message, index) => {
    // A call written out as text did nothing, and seeing it would teach the model to do it again.
    if (message.role === "assistant") return assistant(findLeakedToolCall(message.content).visible || "…")
    const previous = thread.slice(0, index).findLast((item) => item.role === "assistant")
    // "1" or "1, 3" means those interview options. The chat keeps the number; the model reads the option.
    const content = previous ? expandNumberReply(message.content, previous.content, Boolean(previous.plan)) : message.content
    return user(content)
  })
}

/**
 * Answers the latest user message: understands the request, proposes or
 * revises the plan, confirms it, or changes the built app. Streams everything
 * to `run`, saves the reply, and says what should happen next.
 */
export async function runPlannerTurn(
  projectRun: ProjectRun,
  project: Project,
  assetNames: string[],
  account: PlannerState["account"]
): Promise<{ confirmed: boolean; plan: AppPlan | null; changes: AppChanges | null }> {
  configureAgents()
  warnIfSearchUnavailable()

  // Requests a finished build took care of are left out, so the agent can't act on them again.
  const thread = await db
    .select({ role: messages.role, content: messages.content, plan: messages.plan })
    .from(messages)
    .where(and(eq(messages.projectId, project.id), eq(messages.handled, false), eq(messages.archived, false)))
    .orderBy(messages.createdAt)

  const rows = await db
    .select({ slug: screens.slug, name: screens.name, code: screens.code })
    .from(screens)
    .where(eq(screens.projectId, project.id))
  const serverRows = await ifIntegrations(() => listServerRoutes(project.id))

  const integrations = integrationsEnabled()
  const context: PlannerContext = {
    project,
    backend: await getBackendStatus(project.id, project.userId),
    projectId: project.id,
    run: projectRun,
    rows,
    serverRows,
    serverRoutes: project.plan?.serverRoutes ?? [],
    status: project.status,
    platform: project.platform,
    plan: project.plan,
    builtScreens: rows.filter((row) => row.code).length,
    assetNames,
    account,
    services: integrations ? plannerServices(await listServiceSummaries(project.id)) : [],
    integrations,
    proposedPlan: null,
    confirmed: false,
    changes: null,
    priorAssistantReplies: thread.filter((message) => message.role === "assistant").length,
    latestUserMessage: [...thread].reverse().find((message) => message.role === "user")?.content ?? "",
    interviewBlocked: false,
    research: newResearchBudget(),
  }

  projectRun.emit(statusEvent(thread.length > 1 ? "readingMessage" : "readingRequest"))
  const input = toInputItems(thread)
  const first = await streamPlannerRun(projectRun, context, input, "")
  let text = first.text
  let failedCall = first.leaked !== null && !first.toolRan

  // The model wrote a tool call out as text, so nothing happened. It gets one more go.
  if (failedCall) {
    const retry = await streamPlannerRun(projectRun, context, [...input, assistant(text || "…"), user(leakedCallNudge(first.leaked))], text)
    text += retry.text
    failedCall = retry.leaked !== null && !retry.toolRan
  }

  projectRun.emit({ type: "status", label: null })
  // The route has already set the project's chat language to the language of this message.
  const fixed = translatorFor(chatLocale(project), "agentMessages")
  const content =
    (failedCall ? [text.trim(), fixed("noReply")].filter(Boolean).join("\n\n") : text.trim()) ||
    (context.confirmed
      ? fixed("planStarting")
      : context.changes
        ? fixed("changesStarting")
        : context.proposedPlan
          ? fixed("planProposed")
          : fixed("noReply"))

  const [saved] = await db
    .insert(messages)
    .values({ projectId: project.id, role: "assistant", content, plan: context.proposedPlan })
    .returning({ id: messages.id, role: messages.role, content: messages.content, plan: messages.plan })
  projectRun.emit({ type: "message", message: saved })

  return { confirmed: context.confirmed, plan: context.plan, changes: context.changes }
}

/** Model-facing, so English: why the last reply did nothing, and what to do instead. */
function leakedCallNudge(tool: string | null) {
  const call = tool ? `the ${tool} call` : "a tool call"
  return `Your last reply wrote ${call} out as text instead of calling the tool, so nothing happened and the person didn't see it. Call the tool now, through the tool interface, with the arguments you meant. Don't repeat what you already told them.`
}

/**
 * One run of the planner, streamed to the person. A tool call the model writes out as text
 * never reaches the chat: `leaked` names it, and `toolRan` says whether any real call ran.
 * `before` is what the person has already seen, so new text starts a new paragraph.
 */
async function streamPlannerRun(projectRun: ProjectRun, context: PlannerContext, input: AgentInputItem[], before: string) {
  const result = await run(plannerAgentFor(context.integrations), input, { stream: true, context, maxTurns: MAX_PLANNER_TURNS, errorHandlers: endRunAtMaxTurns })

  let text = ""
  let responseHasText = false
  let toolRan = false
  const filter = createLeakFilter()
  const announcedTools = new Set<string>()

  const show = (shown: string) => {
    if (!shown) return
    text += shown
    projectRun.emit({ type: "text-delta", delta: shown })
  }

  for await (const event of result) {
    if (event.type === "raw_model_stream_event") {
      const data = event.data
      if (data.type === "response_started") {
        responseHasText = false
        projectRun.emit(statusEvent(context.confirmed ? "startingBuild" : context.changes ? "startingChanges" : context.proposedPlan ? "summarizingPlan" : "thinking"))
      } else if (data.type === "output_text_delta") {
        // Text from separate model calls (before and after a tool call) becomes paragraphs.
        const delta = !responseHasText && (before || text) ? `\n\n${data.delta}` : data.delta
        if (!responseHasText) projectRun.emit({ type: "status", label: null })
        responseHasText = true
        show(filter.push(delta))
      } else if (data.type === "model") {
        // Raw Chat Completions chunks: reasoning and tool calls show up here first.
        const delta = (data.event as RawChunk)?.choices?.[0]?.delta
        if (typeof delta?.reasoning === "string" && delta.reasoning) {
          projectRun.emit({ type: "reasoning-delta", delta: delta.reasoning })
        }
        for (const call of delta?.tool_calls ?? []) {
          const name = call.function?.name
          if (name && TOOL_STATUS[name] && !announcedTools.has(name)) {
            announcedTools.add(name)
            projectRun.emit(statusEvent(TOOL_STATUS[name]))
          }
        }
      }
    } else if (event.type === "run_item_stream_event" && event.name === "tool_output") {
      toolRan = true
      announcedTools.clear()
    }
  }
  await result.completed
  show(filter.flush())

  return { text: text.trimEnd(), leaked: filter.leaked, toolRan }
}

type RawChunk = {
  choices?: {
    delta?: {
      reasoning?: unknown
      tool_calls?: { function?: { name?: string } }[]
    }
  }[]
}
