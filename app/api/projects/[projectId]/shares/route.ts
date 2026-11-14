import { NextResponse } from "next/server"
import { and, asc, eq } from "drizzle-orm"

import { db, projectShares, users } from "@/db"
import { validateAuthFields } from "@/lib/auth-validation"
import { errorResponse, type ErrorKey } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import { getCurrentUser } from "@/lib/session"

type Context = { params: Promise<{ projectId: string }> }

function error(key: ErrorKey, status: number) {
  return errorResponse(key, status)
}

/** Only the owner sees and changes who a project is shared with. */
async function ownedProject({ params }: Context) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: await error("signInRequired", 401) }
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return { failure: await error("projectNotFound", 404) }
  return { user, project: access.project }
}

async function listPeople(projectId: string) {
  return db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(projectShares)
    .innerJoin(users, eq(projectShares.userId, users.id))
    .where(eq(projectShares.projectId, projectId))
    .orderBy(asc(projectShares.createdAt))
}

export async function GET(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  return NextResponse.json({ people: await listPeople(owned.project.id), isPublic: owned.project.isPublic })
}

export async function POST(request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  const problem = validateAuthFields("sign-in", { name: "", email, password: "-" }).email
  if (problem) return error(problem.key === "enterEmail" ? "enterEmail" : "invalidEmail", 400)
  if (email === owned.user.email) return error("shareOwnProject", 400)

  // Accounts don't confirm their email, so a share waiting for someone to sign up
  // could be claimed by anyone who signs up with that address. Only existing accounts get one.
  const [person] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  if (!person) return error("shareNoAccount", 404)

  await db.insert(projectShares).values({ projectId: owned.project.id, userId: person.id }).onConflictDoNothing()
  return NextResponse.json({ people: await listPeople(owned.project.id) }, { status: 201 })
}

export async function DELETE(request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure

  const body = (await request.json().catch(() => null)) as { userId?: unknown } | null
  if (!Number.isInteger(body?.userId)) return error("invalidRequest", 400)
  await db
    .delete(projectShares)
    .where(and(eq(projectShares.projectId, owned.project.id), eq(projectShares.userId, body!.userId as number)))
  return NextResponse.json({ people: await listPeople(owned.project.id) })
}
