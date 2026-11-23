import { NextResponse } from "next/server"

import { errorResponse } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import { validateValues } from "@/lib/services/definition"
import {
  loadServiceSecrets,
  removeService,
  removeServiceValues,
  retestService,
  saveServiceValues,
} from "@/lib/services/store"
import { getCurrentUser } from "@/lib/session"

type Context = { params: Promise<{ projectId: string; slug: string }> }

const MAX_BODY_BYTES = 32 * 1024

/** Only the owner sees or changes the services an app uses. */
async function ownedProject({ params }: Context) {
  const { projectId, slug } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: await errorResponse("signInRequired", 401) }
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return { failure: await errorResponse("projectNotFound", 404) }
  return { project: access.project, slug }
}

/** The body as JSON, null when it isn't, or "tooLarge". The body is never logged. */
async function readBody(request: Request): Promise<unknown | "tooLarge"> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return "tooLarge"
  const text = await request.text().catch(() => null)
  if (text === null) return null
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return "tooLarge"
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Saves the values for a service, or re-tests the ones already saved. Never returns a value. */
export async function PUT(request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  const { project, slug } = owned

  const body = await readBody(request)
  if (body === "tooLarge") return errorResponse("serviceValuesInvalid", 413)
  if (typeof body !== "object" || body === null || Array.isArray(body)) return errorResponse("invalidRequest", 400)
  const { action, values } = body as { action?: unknown; values?: unknown }

  try {
    if (action === "retest") {
      const service = await retestService(project.id, slug)
      if (!service) return errorResponse("serviceNotFound", 404)
      return NextResponse.json({ service })
    }

    const stored = await loadServiceSecrets(project.id, slug)
    if (!stored) return errorResponse("serviceNotFound", 404)
    const checked = validateValues(stored.definition, values)
    if (typeof checked === "string") return errorResponse("serviceValuesInvalid", 400)
    const service = await saveServiceValues(project.id, slug, checked)
    if (!service) return errorResponse("serviceNotFound", 404)
    return NextResponse.json({ service })
  } catch {
    console.error("Saving service values failed")
    return errorResponse("serviceValuesInvalid", 500)
  }
}

/** `?scope=values` forgets the saved values; `?scope=service` also removes the service from the app. */
export async function DELETE(request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  const { project, slug } = owned

  const scope = new URL(request.url).searchParams.get("scope")
  if (scope !== "values" && scope !== "service") return errorResponse("invalidRequest", 400)
  if (!(await loadServiceSecrets(project.id, slug))) return errorResponse("serviceNotFound", 404)

  if (scope === "values") await removeServiceValues(project.id, slug)
  else await removeService(project.id, slug)
  return NextResponse.json({ ok: true })
}
