// Plan rules shared by the pricing page and upgrade prompts (client) and the limits they enforce (server).

import type { AppPlan } from "@/lib/agent-protocol"

export const PLAN_IDS = ["free", "pro"] as const
export type PlanId = (typeof PLAN_IDS)[number]

/** One-time and never expire. */
export const FREE_SIGNUP_CREDITS = 100
/** Replaces what's left of the last month's at each renewal. */
export const PRO_MONTHLY_CREDITS = 1000

// A small app is 4 screens, so 40 credits. Free's 100 is then about 2 apps and 4 edits, and Pro's 1,000 about 25 apps or 200 edits.
export const SCREEN_CREDITS = 10
export const EDIT_CREDITS = 5
export const IMAGE_CREDITS = 1
export const SMALL_APP_CREDITS = 4 * SCREEN_CREDITS

export const PLANS: Record<PlanId, { name: string; maxProjects: number | null; maxScreens: number; nativePublish: boolean }> = {
  free: { name: "Free", maxProjects: 2, maxScreens: 5, nativePublish: false },
  pro: { name: "Pro", maxProjects: null, maxScreens: 10, nativePublish: true },
}

/** Shown on the pricing page. Keep it the same as the Stripe price in `STRIPE_PRO_PRICE_ID`. */
export const PRO_PRICE_LABEL = process.env.NEXT_PUBLIC_PRO_PRICE_LABEL || "$19"

/** A limit the person ran into, which an upgrade prompt explains. API errors carry it as `code`. */
export const UPGRADE_REASONS = ["projects", "screens", "credits", "native-publish"] as const
export type UpgradeReason = (typeof UPGRADE_REASONS)[number]

export function isUpgradeReason(value: unknown): value is UpgradeReason {
  return UPGRADE_REASONS.includes(value as UpgradeReason)
}

export const CREDIT_REASONS = ["build", "edit", "server-route", "image", "refund", "renewal", "plan-ended", "topup"] as const

/** One-time packs. The price ids live in the matching STRIPE_TOPUP_* env vars. */
export const TOPUP_PACKS = [
  { id: "100", credits: 100, priceLabel: "$5" },
  { id: "400", credits: 400, priceLabel: "$15" },
  { id: "1000", credits: 1000, priceLabel: "$29" },
] as const
export type TopupId = (typeof TOPUP_PACKS)[number]["id"]

const TOPUP_PRICE_ENV: Record<TopupId, string> = {
  "100": "STRIPE_TOPUP_100_PRICE_ID",
  "400": "STRIPE_TOPUP_400_PRICE_ID",
  "1000": "STRIPE_TOPUP_1000_PRICE_ID",
}

export function isTopupId(value: unknown): value is TopupId {
  return TOPUP_PACKS.some((pack) => pack.id === value)
}

/** The Stripe price for a pack, or null when that env var isn't set. */
export function topupPriceId(id: TopupId) {
  return process.env[TOPUP_PRICE_ENV[id]] || null
}
export type CreditReason = (typeof CREDIT_REASONS)[number]

/**
 * What a build of `plan` costs, in parts: each screen with no code yet, each planned server function or agent
 * with no code yet, and the round of changes if it's one (route edits are part of that round).
 * What a failed build didn't finish is refunded by this same sum, and trying again charges it again.
 */
export function buildCostParts(
  plan: Pick<AppPlan, "screens" | "pendingChanges" | "serverRoutes">,
  rows: { slug: string; code: string | null }[],
  serverRows: { path: string; code: string | null }[] = []
) {
  const unbuiltScreens = plan.screens.filter((screen) => !rows.some((row) => row.slug === screen.id && row.code)).length
  const unbuiltRoutes = (plan.serverRoutes ?? []).filter((route) => !serverRows.some((row) => row.path === route.path && row.code)).length
  return {
    screens: unbuiltScreens * SCREEN_CREDITS,
    serverRoutes: unbuiltRoutes * SCREEN_CREDITS,
    edit: plan.pendingChanges ? EDIT_CREDITS : 0,
  }
}

export function buildCost(
  plan: Pick<AppPlan, "screens" | "pendingChanges" | "serverRoutes">,
  rows: { slug: string; code: string | null }[],
  serverRows: { path: string; code: string | null }[] = []
) {
  const parts = buildCostParts(plan, rows, serverRows)
  return parts.screens + parts.serverRoutes + parts.edit
}