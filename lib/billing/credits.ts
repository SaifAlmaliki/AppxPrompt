import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { and, count, eq, sql } from "drizzle-orm"

import { builds, creditTransactions, db, projects, screens, users, type Project } from "@/db"
import type { AppPlan } from "@/lib/agent-protocol"
import { ifIntegrations } from "@/lib/server-routes/gate"
import { listServerRoutes } from "@/lib/server-routes/store"
import { translatorFor, type Translator } from "@/lib/i18n/server"
import { EDIT_CREDITS, PLANS, PRO_MONTHLY_CREDITS, buildCostParts, buildCost, type CreditReason, type PlanId, type UpgradeReason } from "@/lib/plans"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** A plan limit stopped this, and the browser shows an upgrade prompt for `reason`. */
export class PlanLimitError extends Error {
  constructor(
    readonly reason: UpgradeReason,
    message: string,
    readonly status = 403
  ) {
    super(message)
  }
}

export function planLimitResponse(error: PlanLimitError) {
  return NextResponse.json({ error: error.message, code: error.reason }, { status: error.status })
}

type ErrorsT = Translator<"errors">

function notEnoughCredits(needed: number, t: ErrorsT) {
  return new PlanLimitError("credits", t("creditsShort", { needed }), 402)
}

function projectLimitReached(maxProjects: number, t: ErrorsT) {
  return new PlanLimitError("projects", t("projectLimit", { max: maxProjects }))
}

/** English unless `t` says otherwise, since the agent's tool results, which the model reads, use it too. */
export function screenLimitMessage(plan: PlanId, t: ErrorsT = translatorFor("en", "errors")) {
  return t("screenLimit", { plan, max: PLANS[plan].maxScreens })
}

/** Stops a chat with the agent, or a new project, that no change could come out of. */
export function assertCanUseAgent(credits: number, t: ErrorsT) {
  if (credits < EDIT_CREDITS) throw notEnoughCredits(EDIT_CREDITS, t)
}

/** Takes what the parts add up to, this month's credits first, or throws without taking any. One transaction row per part. */
export async function spendCreditParts(
  userId: number,
  projectId: string,
  parts: { amount: number; reason: CreditReason; reference: string }[],
  t: ErrorsT
) {
  const charged = parts.filter((part) => part.amount > 0)
  const total = charged.reduce((sum, part) => sum + part.amount, 0)
  if (total === 0) return
  await db.transaction(async (tx) => {
    // The row is checked and changed in one statement, so spending at once from two tabs can't go below zero.
    const [user] = await tx
      .update(users)
      .set({
        monthlyCredits: sql`${users.monthlyCredits} - least(${users.monthlyCredits}, ${total}::int)`,
        credits: sql`${users.credits} - greatest(${total}::int - ${users.monthlyCredits}, 0)`,
      })
      .where(and(eq(users.id, userId), sql`${users.credits} + ${users.monthlyCredits} >= ${total}::int`))
      .returning({ credits: users.credits, monthlyCredits: users.monthlyCredits })
    if (!user) throw notEnoughCredits(total, t)
    let balance = user.credits + user.monthlyCredits + total
    await tx.insert(creditTransactions).values(
      charged.map((part) => {
        balance -= part.amount
        return { userId, projectId, reason: part.reason, reference: part.reference, amount: -part.amount, balanceAfter: balance }
      })
    )
  })
}

/** Takes `amount`, this month's credits first, or throws without taking any. */
export function spendCredits(
  userId: number,
  amount: number,
  entry: { reason: CreditReason; projectId: string; reference: string },
  t: ErrorsT
) {
  return spendCreditParts(userId, entry.projectId, [{ amount, reason: entry.reason, reference: entry.reference }], t)
}

/**
 * Gives credits back once per `reference`, as credits that don't expire, since
 * the month they came from may be over by now. Returns whether it did.
 */
export async function refundCredits(userId: number, amount: number, entry: { projectId: string; reference: string }) {
  if (amount <= 0) return false
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update")
    const saved = await tx
      .insert(creditTransactions)
      .values({ ...entry, userId, amount, balanceAfter: user.credits + user.monthlyCredits + amount, reason: "refund" })
      .onConflictDoNothing()
      .returning({ id: creditTransactions.id })
    if (saved.length === 0) return false
    await tx.update(users).set({ credits: user.credits + amount }).where(eq(users.id, userId))
    return true
  })
}

export type BuildCharge = { id: string; credits: number }

/** Charges for what a build of `plan` still has to do, before anything about the build is saved. */
export async function chargeForBuild(project: Pick<Project, "id" | "userId">, plan: AppPlan, userPlan: PlanId, t: ErrorsT): Promise<BuildCharge> {
  const rows = await db.select({ slug: screens.slug, code: screens.code }).from(screens).where(eq(screens.projectId, project.id))
  const serverRows = await ifIntegrations(() => listServerRoutes(project.id))
  // Someone who has downgraded keeps a bigger app they've built, but can't build more of it.
  const hasUnbuilt = plan.screens.some((screen) => !rows.some((row) => row.slug === screen.id && row.code))
  if (hasUnbuilt && plan.screens.length > PLANS[userPlan].maxScreens) {
    throw new PlanLimitError("screens", t("screenLimitUpgrade", { limit: screenLimitMessage(userPlan, t) }))
  }

  const id = randomUUID()
  const parts = buildCostParts(plan, rows, serverRows)
  const credits = parts.screens + parts.serverRoutes + parts.edit
  await spendCreditParts(
    project.userId,
    project.id,
    [
      { amount: parts.screens + parts.edit, reason: plan.pendingChanges ? "edit" : "build", reference: `build:${id}` },
      { amount: parts.serverRoutes, reason: "server-route", reference: `build:${id}:server` },
    ],
    t
  )
  return { id, credits }
}

/** Gives back a charge whose build never started. */
export function refundCharge(project: Pick<Project, "id" | "userId">, charge: BuildCharge) {
  return refundCredits(project.userId, charge.credits, { projectId: project.id, reference: `refund:${charge.id}` })
}

/**
 * Gives back what a failed build was charged for and didn't finish, which trying
 * again charges again. Safe to call twice. Returns how much came back.
 */
export async function refundUnfinishedBuild(buildId: string) {
  const [build] = await db
    .select({ charged: builds.creditsCharged, project: projects })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .where(eq(builds.id, buildId))
  if (!build?.charged || !build.project.plan) return 0

  const rows = await db.select({ slug: screens.slug, code: screens.code }).from(screens).where(eq(screens.projectId, build.project.id))
  const serverRows = await ifIntegrations(() => listServerRoutes(build.project.id))
  const amount = Math.min(build.charged, buildCost(build.project.plan, rows, serverRows))
  const refunded = await refundCredits(build.project.userId, amount, { projectId: build.project.id, reference: `refund:${buildId}` })
  return refunded ? amount : 0
}

export async function hasProjectSlot(userId: number, plan: PlanId) {
  const maxProjects = PLANS[plan].maxProjects
  if (maxProjects === null) return true
  const [{ owned }] = await db.select({ owned: count() }).from(projects).where(eq(projects.userId, userId))
  return owned < maxProjects
}

export function assertProjectSlot(hasSlot: boolean, plan: PlanId, t: ErrorsT) {
  const maxProjects = PLANS[plan].maxProjects
  if (!hasSlot && maxProjects !== null) throw projectLimitReached(maxProjects, t)
}

/** Checks for room again inside the transaction creating a project. The lock makes two requests at once take turns. */
export async function claimProjectSlot(tx: Transaction, userId: number, t: ErrorsT) {
  const [owner] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).for("update")
  const maxProjects = PLANS[owner.plan].maxProjects
  if (maxProjects === null) return
  const [{ owned }] = await tx.select({ owned: count() }).from(projects).where(eq(projects.userId, userId))
  if (owned >= maxProjects) throw projectLimitReached(maxProjects, t)
}

/** Adds a bought pack to the credits that never expire. Once per `reference`, the Checkout Session. */
export async function grantTopupCredits(userId: number, amount: number, reference: string) {
  if (amount <= 0) return false
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update")
    if (!user) return false
    const saved = await tx
      .insert(creditTransactions)
      .values({
        userId,
        amount,
        balanceAfter: user.credits + user.monthlyCredits + amount,
        reason: "topup",
        reference,
      })
      .onConflictDoNothing()
      .returning({ id: creditTransactions.id })
    if (saved.length === 0) return false
    await tx.update(users).set({ credits: user.credits + amount }).where(eq(users.id, userId))
    return true
  })
}

/** Replaces what's left of the last period's credits with a new month's. Once per `reference`, the paid invoice. */
export async function grantMonthlyCredits(userId: number, reference: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update")
    const saved = await tx
      .insert(creditTransactions)
      .values({
        userId,
        amount: PRO_MONTHLY_CREDITS - user.monthlyCredits,
        balanceAfter: user.credits + PRO_MONTHLY_CREDITS,
        reason: "renewal",
        reference,
      })
      .onConflictDoNothing()
      .returning({ id: creditTransactions.id })
    if (saved.length > 0) await tx.update(users).set({ monthlyCredits: PRO_MONTHLY_CREDITS }).where(eq(users.id, userId))
  })
}

/** Puts someone on Free. This month's credits go with Pro, and what never expires stays. */
export async function endProPlan(userId: number, reference: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update")
    await tx
      .update(users)
      .set({ plan: "free", monthlyCredits: 0, stripeSubscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false })
      .where(eq(users.id, userId))
    if (user.monthlyCredits === 0) return
    await tx
      .insert(creditTransactions)
      .values({ userId, amount: -user.monthlyCredits, balanceAfter: user.credits, reason: "plan-ended", reference })
      .onConflictDoNothing()
  })
}
