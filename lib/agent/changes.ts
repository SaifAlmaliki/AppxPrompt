import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { db, projects, screens, serverRoutes, type Screen } from "@/db"
import {
  API_ROUTE_FILE,
  apiRouteUrl,
  BACKEND_SERVICE,
  COMPONENT_NAME,
  componentLabel,
  MAX_TABS,
  MIN_TABS,
  screenFilePath,
  screenRoute,
  SERVER_ROUTE_ID,
  type AppPlan,
  type PendingChanges,
  type PlannedScreen,
  type PlannedServerRoute,
} from "@/lib/agent-protocol"
import { matchApiRoute } from "@/lib/sandbox/routes"
import { removeServerRoutes } from "@/lib/server-routes/store"
import { findKeys } from "@/lib/services/key-patterns"
import { removeService } from "@/lib/services/store"

/** What the person asked to change about a built app. */
export type AppChangeRequest = {
  appName: string | null
  navigation: AppPlan["navigation"] | null
  addScreens: PlannedScreen[]
  editScreens: (PlannedScreen & { request: string })[]
  removeScreenIds: string[]
  addComponents: { name: string; purpose: string; request: string }[]
  editComponents: { name: string; request: string }[]
  firstScreenId: string | null
  dataChange: string | null
  addServerRoutes: PlannedServerRoute[]
  editServerRoutes: (PlannedServerRoute & { request: string })[]
  removeServerRoutePaths: string[]
  /** Slugs of registered services the app stops using. */
  removeServices: string[]
}

export type AppChanges = {
  plan: AppPlan
  removed: string[]
  /** Paths of the server functions the app no longer has. */
  removedServerRoutes: string[]
  /** Slugs of the services to delete once the changes are saved. */
  removedServices: string[]
}

export type ServerRouteOptions = {
  /** Slugs of the services registered for the app. */
  services: string[]
  enabled: boolean
}

export const MAX_SERVER_ROUTES = 10
const MAX_PURPOSE = 300

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "screen"
}

/**
 * Treats "Settings", "settings" and "Settings Screen" as the same screen. Keeps letters from any script,
 * so Arabic names don't all collapse into one key. Null when there's nothing to compare.
 */
function screenKey(value: string) {
  const key = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-(screen|page)$/, "")
  return key || null
}

/** The ids slugify falls back to for names without Latin letters, which say nothing about the screen. */
const GENERIC_ID = /^screen(-\d+)?$/

function idKey(id: string) {
  return GENERIC_ID.test(id) ? null : screenKey(id)
}

function linksTo(code: string, slug: string) {
  return new RegExp(`["'\`]/${slug}(?:["'\`?])`).test(code)
}

// Phase 4 adds them. Until then the model plans the same work as a function route.
const AGENT_ROUTES_UNAVAILABLE = "AI agent routes aren't available yet; plan this as a function route."

/** The server functions as they'll be saved, or the first reason they can't be. */
export function normalizeServerRoutes(input: PlannedServerRoute[], options: ServerRouteOptions): PlannedServerRoute[] | string {
  if (input.length === 0) return []
  if (!options.enabled) return "Server functions aren't available on this AppxPrompt server yet."
  if (input.length > MAX_SERVER_ROUTES) return `An app has at most ${MAX_SERVER_ROUTES} server functions.`

  const urls = new Set<string>()
  const ids = new Set<string>()
  const routes: PlannedServerRoute[] = []
  for (const route of input) {
    if (route.kind === "agent") return AGENT_ROUTES_UNAVAILABLE
    if (!API_ROUTE_FILE.test(route.path)) {
      return `${route.path} isn't a server function path. Use app/api/<name>+api.ts.`
    }
    const url = apiRouteUrl(route.path)
    if (urls.has(url)) return `${route.path} answers on ${url}, which another server function already uses. Give each its own path.`
    urls.add(url)

    const base = slugify(route.id || route.path)
    let id = base
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
    if (!SERVER_ROUTE_ID.test(id)) {
      return `${route.id || route.path} isn't a valid server function id. Use short kebab-case that starts with a letter, at most 40 characters.`
    }
    ids.add(id)

    const unknown = route.services.find((slug) => slug !== BACKEND_SERVICE && !options.services.includes(slug))
    if (unknown) return `Register ${unknown} with register_service before planning a function that uses it.`

    const purpose = route.purpose.trim()
    if (purpose.length < 1 || purpose.length > MAX_PURPOSE) {
      return `The purpose of ${route.path} must be 1 to ${MAX_PURPOSE} characters.`
    }
    if (findKeys(purpose).length > 0) {
      return `The purpose of ${route.path} contains what looks like a key. Never put a key in a plan: the owner enters it in the keys dialog.`
    }

    routes.push({ id, path: route.path, purpose, kind: route.kind, services: [...new Set(route.services)], access: route.access })
  }
  return routes
}

const SERVER_CALL_PATH = /\bcallServer(?:<[^>]*>)?\(\s*(["'`])([^"'`]+)\1/g

/** Whether a screen's code calls the function at `path`. */
function callsRoute(code: string, path: string) {
  return [...code.matchAll(SERVER_CALL_PATH)].some((match) => matchApiRoute([path], match[2]))
}

/** The plan after `request`, or why it can't be used. Nothing is saved yet. */
export function planAppChanges(
  plan: AppPlan,
  rows: Pick<Screen, "slug" | "name" | "code">[],
  request: AppChangeRequest,
  maxScreens: number,
  options: ServerRouteOptions = { services: [], enabled: false }
): AppChanges | string {
  const existing = new Set(plan.screens.map((screen) => screen.id))
  const missing = [...request.editScreens.map((s) => s.id), ...request.removeScreenIds].filter((id) => !existing.has(id))
  if (missing.length > 0) return `These screens don't exist: ${missing.join(", ")}. Use the ids in the current plan.`

  const library = plan.components ?? []
  const earlierComponents = plan.pendingChanges?.components ?? {}
  const knownComponents = new Set([...library.map((component) => component.name), ...Object.keys(earlierComponents)])
  const missingComponents = request.editComponents.map((c) => c.name).filter((name) => !knownComponents.has(name))
  if (missingComponents.length > 0) {
    return `These components don't exist: ${missingComponents.join(", ")}. Use the names in the current plan, or addComponents for a new one.`
  }
  const newNames = request.addComponents.map((c) => c.name)
  const badNames = newNames.filter((name, i) => !COMPONENT_NAME.test(name) || knownComponents.has(name) || newNames.indexOf(name) !== i)
  if (badNames.length > 0) {
    return `Can't add ${badNames.join(", ")}. Each new component needs its own PascalCase name, and editComponents changes one the app already has.`
  }

  const currentRoutes = plan.serverRoutes ?? []
  const knownRoutes = new Set(currentRoutes.map((route) => route.path))
  const missingRoutes = [...request.editServerRoutes.map((route) => route.path), ...request.removeServerRoutePaths].filter(
    (path) => !knownRoutes.has(path)
  )
  if (missingRoutes.length > 0) return `These server functions don't exist: ${missingRoutes.join(", ")}.`
  const unregistered = request.removeServices.filter((slug) => !options.services.includes(slug))
  if (unregistered.length > 0) return `These services aren't registered: ${unregistered.join(", ")}.`

  const removedPaths = new Set(request.removeServerRoutePaths)
  const editedRoutes = request.editServerRoutes.filter((route) => !removedPaths.has(route.path))
  const editedPaths = new Set(editedRoutes.map((route) => route.path))
  const droppedServices = new Set(request.removeServices)
  const dropServices = (route: PlannedServerRoute) =>
    route.services.some((slug) => droppedServices.has(slug)) ? { ...route, services: route.services.filter((slug) => !droppedServices.has(slug)) } : route
  const keptRoutes = currentRoutes.filter((route) => !removedPaths.has(route.path) && !editedPaths.has(route.path))
  const changesRoutes =
    request.addServerRoutes.length > 0 || editedRoutes.length > 0 || removedPaths.size > 0 || currentRoutes.some((route) => dropServices(route) !== route)
  let nextRoutes = currentRoutes
  if (changesRoutes) {
    const result = normalizeServerRoutes(
      [
        ...keptRoutes,
        ...editedRoutes.map(({ request: _text, ...route }) => route),
        ...request.addServerRoutes,
      ].map(dropServices),
      { ...options, services: options.services.filter((slug) => !droppedServices.has(slug)) }
    )
    if (typeof result === "string") return result
    nextRoutes = result
  }
  const removedRoutes = currentRoutes.filter((route) => removedPaths.has(route.path))

  const removed = plan.screens.filter((screen) => request.removeScreenIds.includes(screen.id))
  const removedIds = removed.map((screen) => screen.id)
  const edited = new Map(request.editScreens.map((screen) => [screen.id, screen]))

  const taken = new Set(plan.screens.flatMap((screen) => [idKey(screen.id), screenKey(screen.name)]))
  taken.delete(null)
  const usedIds = new Set(plan.screens.map((screen) => screen.id))
  const repeated: string[] = []
  const idMap = new Map<string, string>()
  const added: PlannedScreen[] = []
  for (const screen of request.addScreens) {
    const base = slugify(screen.id || screen.name)
    const keys = [idKey(base), screenKey(screen.name)].filter((key) => key !== null)
    if (keys.some((key) => taken.has(key))) {
      repeated.push(screen.name)
      continue
    }
    keys.forEach((key) => taken.add(key))
    let id = base
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`
    usedIds.add(id)
    idMap.set(screen.id, id)
    added.push({ ...screen, id })
  }
  if (repeated.length > 0) {
    return `The app already has ${repeated.join(", ")}. Leave ${repeated.length === 1 ? "it" : "them"} out of addScreens and only add what the person's latest message asks for. To change an existing screen, use editScreens.`
  }

  let next = [
    ...plan.screens
      .filter((screen) => !removedIds.includes(screen.id))
      .map((screen) => {
        const edit = edited.get(screen.id)
        if (!edit) return screen
        const { request: _request, ...rest } = edit
        return rest
      }),
    ...added,
  ]
  // An app that's over the limit after a downgrade can still be edited, but not grow.
  if (next.length < 1 || (next.length > maxScreens && next.length > plan.screens.length)) {
    return `That leaves ${next.length} screens. An app has between 1 and ${maxScreens}.`
  }

  // A tab app from before the shared layout draws the bar in its screens, so a layout would be a second bar.
  const drawsOwnTabBars = plan.navigation === "tabs" && !plan.screens.some((screen) => screen.tab)
  if ((request.navigation ?? plan.navigation) === "stack" || drawsOwnTabBars) {
    next = next.map((screen) => ({ ...screen, tab: null }))
  } else {
    const tabs = next.filter((screen) => screen.tab).length
    if (tabs < MIN_TABS || tabs > MAX_TABS) {
      return `That leaves ${tabs} tabs. Tab navigation has between ${MIN_TABS} and ${MAX_TABS}, so set tab on the top-level screens, or use stack navigation.`
    }
  }

  const firstId = request.firstScreenId && (idMap.get(request.firstScreenId) ?? slugify(request.firstScreenId))
  if (firstId) {
    const first = next.find((screen) => screen.id === firstId)
    if (!first) return `There's no screen "${request.firstScreenId}" to open the app on.`
    next = [first, ...next.filter((screen) => screen !== first)]
  }

  const remaining = new Set(next.map((screen) => screen.id))
  next = next.map((screen) => ({
    ...screen,
    navigatesTo: [
      ...new Set(
        screen.navigatesTo.map((id) => idMap.get(id) ?? slugify(id)).filter((id) => remaining.has(id) && id !== screen.id)
      ),
    ],
  }))

  const unreachable = next.filter(
    (screen) =>
      added.some((other) => other.id === screen.id) &&
      !screen.tab &&
      screen.id !== next[0].id &&
      !next.some((other) => other.navigatesTo.includes(screen.id))
  )
  if (unreachable.length > 0) {
    return `Nothing links to ${unreachable.map((screen) => screen.name).join(", ")}, so people couldn't open it. Edit the screen that should open it: list it in that screen's navigatesTo and describe the new link in its request.`
  }

  const edits: Record<string, string> = Object.fromEntries(request.editScreens.map(({ id, request }) => [id, request]))
  // Links to a removed screen would lead nowhere, so those screens change too.
  for (const row of rows) {
    if (!row.code || removedIds.includes(row.slug)) continue
    const gone = removed.filter((screen) => linksTo(row.code!, screen.id))
    if (gone.length === 0) continue
    const note = `The ${gone.map((screen) => screen.name).join(", ")} screen no longer exists. Remove every link to it, and any control that only led there.`
    edits[row.slug] = edits[row.slug] ? `${edits[row.slug]}\n${note}` : note
  }

  // A screen calling a function that's gone, or one that no longer uses a removed service, has to change too.
  const addNote = (slug: string, note: string) => {
    edits[slug] = edits[slug] ? `${edits[slug]}\n${note}` : note
  }
  const callers = (path: string) => rows.filter((row) => row.code && !removedIds.includes(row.slug) && callsRoute(row.code, path))
  for (const route of removedRoutes) {
    const url = apiRouteUrl(route.path)
    for (const row of callers(route.path)) {
      addNote(row.slug, `The server function ${url} no longer exists. Remove what calls it, and any control that only did that.`)
    }
  }
  const strippedRoutes = currentRoutes.filter((route) => !removedPaths.has(route.path) && dropServices(route) !== route)
  for (const route of strippedRoutes) {
    const url = apiRouteUrl(route.path)
    for (const slug of route.services.filter((slug) => droppedServices.has(slug))) {
      for (const row of callers(route.path)) {
        addNote(row.slug, `The ${slug} service was removed, so ${url} no longer uses it. Remove what depended on it.`)
      }
    }
  }

  // What's still waiting from an earlier change comes first, so this one can build on it.
  const serverQueue: Record<string, string> = Object.fromEntries(
    Object.entries(plan.pendingChanges?.serverRoutes ?? {}).filter(([path]) => !removedPaths.has(path))
  )
  const queueRoute = (path: string, text: string) => {
    const waiting = serverQueue[path]
    serverQueue[path] = waiting ? `${waiting}\n${text}` : text
  }
  for (const route of request.addServerRoutes) serverQueue[route.path] = ""
  for (const route of editedRoutes) queueRoute(route.path, route.request)
  for (const route of strippedRoutes) {
    for (const slug of route.services.filter((slug) => droppedServices.has(slug))) {
      queueRoute(route.path, `The ${slug} service was removed. Rewrite this function without it, and drop what only it did.`)
    }
  }
  const purposeOf = (path: string) => nextRoutes.find((route) => route.path === path)?.purpose
  const routePurposes = (paths: string[]) => paths.map(purposeOf).filter((purpose): purpose is string => Boolean(purpose))

  const components = { ...earlierComponents }
  const queueComponent = (name: string, purpose: string, text: string) => {
    const waiting = components[name]?.request
    components[name] = { purpose, request: waiting ? `${waiting}\n${text}` : text }
  }
  for (const { name, purpose, request: text } of request.addComponents) queueComponent(name, purpose, text)
  const componentPurpose = (name: string) =>
    library.find((component) => component.name === name)?.purpose ?? earlierComponents[name]?.purpose ?? ""
  for (const { name, request: text } of request.editComponents) queueComponent(name, componentPurpose(name), text)
  // A component with a link to a removed screen would lead nowhere from every screen using it.
  for (const component of library) {
    const gone = removed.filter((screen) => linksTo(component.code, screen.id))
    if (gone.length === 0) continue
    const note = `The ${gone.map((screen) => screen.name).join(", ")} screen no longer exists. Remove every link to it.`
    queueComponent(component.name, component.purpose, note)
  }

  const earlier = plan.pendingChanges
  const earlierEdits = Object.entries(earlier?.edits ?? {}).filter(([slug]) => !removedIds.includes(slug))
  for (const [slug, text] of earlierEdits) edits[slug] = edits[slug] ? `${text}\n${edits[slug]}` : text

  const names = (list: PlannedScreen[]) => list.map((screen) => screen.name)
  const pendingChanges: PendingChanges = {
    data: [earlier?.data, request.dataChange].filter(Boolean).join("\n") || null,
    edits,
    components,
    ...(Object.keys(serverQueue).length > 0 ? { serverRoutes: serverQueue } : {}),
    added: [
      ...new Set([
        ...(earlier?.added ?? []),
        ...names(added),
        ...newNames.map(componentLabel),
        ...routePurposes(request.addServerRoutes.map((route) => route.path)),
      ]),
    ],
    updated: [
      ...new Set([
        ...(earlier?.updated ?? []),
        ...names(request.editScreens),
        ...request.editComponents.map((c) => componentLabel(c.name)),
        ...request.removeServices,
        ...routePurposes([...editedRoutes.map((route) => route.path), ...strippedRoutes.map((route) => route.path)]),
      ]),
    ],
    removed: [...new Set([...(earlier?.removed ?? []), ...names(removed)])],
  }

  const { appName, navigation } = request
  return {
    removed: removedIds,
    removedServerRoutes: [...removedPaths],
    removedServices: request.removeServices,
    plan: {
      ...plan,
      ...(appName ? { appName } : {}),
      ...(navigation ? { navigation } : {}),
      screens: next,
      ...(plan.serverRoutes || nextRoutes.length > 0 ? { serverRoutes: nextRoutes } : {}),
      pendingChanges,
    },
  }
}

// A bare "/" is also how dates and paths get split, so it only counts as a route after one of these.
const ENTRY_ROUTE_CONTEXT =
  /(?:\b(?:push|navigate|href|pathname|route|path|to|screen|target)\s*(?:\(\s*|=\s*\{?\s*|:\s*)|\brouter\.replace\(\s*)$/
const ROUTE_LITERAL = /(["'`])(\/[a-z0-9-]*)\1/g

/** Points a screen's links at the routes of screens that moved. */
export function rewriteRoutes(code: string, moved: Map<string, string>) {
  if (moved.size === 0) return code
  return code.replace(ROUTE_LITERAL, (match, quote: string, route: string, offset: number) => {
    const next = moved.get(route)
    if (!next) return match
    if (route === "/" && !ENTRY_ROUTE_CONTEXT.test(code.slice(Math.max(0, offset - 40), offset))) return match
    return `${quote}${next}${quote}`
  })
}

/** Changes these top-level values of the saved plan and leaves the rest, such as a theme switched meanwhile. */
export async function mergePlan(projectId: string, changes: Partial<AppPlan>) {
  const [project] = await db
    .update(projects)
    .set({ plan: sql`${projects.plan} || ${JSON.stringify(changes)}::jsonb` })
    .where(eq(projects.id, projectId))
    .returning({ plan: projects.plan })
  return project.plan!
}

/**
 * Saves the changes and queues the work: new screens and edited screens wait for
 * the build, and an edited screen keeps its code until its new code is ready.
 */
export async function applyAppChanges(projectId: string, { plan, removed, removedServerRoutes, removedServices }: AppChanges) {
  const edits = plan.pendingChanges?.edits ?? {}
  const queuedRoutes = Object.keys(plan.pendingChanges?.serverRoutes ?? {})
  const saved = await db.transaction(async (tx) => {
    const rows = await tx.select().from(screens).where(eq(screens.projectId, projectId)).orderBy(asc(screens.position))
    const bySlug = new Map(rows.map((row) => [row.slug, row]))

    const moved = new Map<string, string>()
    plan.screens.forEach((screen, position) => {
      const row = bySlug.get(screen.id)
      const route = screenRoute(screen.id, position)
      if (row && screenRoute(row.slug, row.position) !== route) moved.set(screenRoute(row.slug, row.position), route)
    })

    for (const slug of removed) {
      await tx.delete(screens).where(eq(screens.id, bySlug.get(slug)!.id))
    }
    for (const [position, screen] of plan.screens.entries()) {
      const row = bySlug.get(screen.id)
      const values = {
        name: screen.name,
        position,
        layout: screen.layout,
        filePath: screenFilePath(screen.id, position, screen.tab),
      }
      if (!row) {
        await tx.insert(screens).values({ ...values, projectId, slug: screen.id })
        continue
      }
      await tx
        .update(screens)
        .set({
          ...values,
          code: row.code && rewriteRoutes(row.code, moved),
          status: screen.id in edits ? "pending" : row.status,
        })
        .where(eq(screens.id, row.id))
    }

    await removeServerRoutes(tx, projectId, removedServerRoutes)
    if (queuedRoutes.length > 0) {
      await tx
        .update(serverRoutes)
        .set({ status: "pending" })
        .where(and(eq(serverRoutes.projectId, projectId), inArray(serverRoutes.path, queuedRoutes)))
    }

    const { themePackage: _themePackage, backend: _backend, ...changes } = plan
    if (changes.components) {
      changes.components = changes.components.map((c) => ({ ...c, code: rewriteRoutes(c.code, moved) }))
    }
    const [project] = await tx
      .update(projects)
      .set({ plan: sql`${projects.plan} || ${JSON.stringify(changes)}::jsonb` })
      .where(eq(projects.id, projectId))
      .returning({ plan: projects.plan })
    return project.plan!
  })
  // The changes are saved, so a service that can't be removed must not fail them: it stays registered.
  for (const slug of removedServices) {
    try {
      await removeService(projectId, slug)
    } catch (cause) {
      console.error(`Removing a service failed (${cause instanceof Error ? cause.name : "Error"}).`)
    }
  }
  return saved
}
