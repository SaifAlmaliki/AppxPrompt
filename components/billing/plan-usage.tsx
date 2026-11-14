"use client"

import Link from "next/link"
import { ArrowRightIcon, CoinsIcon, FolderIcon, SparklesIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import type { SessionUser } from "@/lib/auth-client"
import { EDIT_CREDITS, FREE_SIGNUP_CREDITS, PLANS, PRO_MONTHLY_CREDITS } from "@/lib/plans"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

/** The person's plan and what's left of it. */
export function PlanUsage({ user, projectCount }: { user: SessionUser; projectCount: number }) {
  const t = useTranslations()
  const format = useFormatter()
  const isPro = user.plan === "pro"
  const { maxProjects } = PLANS[user.plan]
  // Credits refunded or kept from Free can put this above the allowance, which simply shows as full.
  const allowance = isPro ? PRO_MONTHLY_CREDITS : FREE_SIGNUP_CREDITS
  const low = user.credits < EDIT_CREDITS
  const projectsFull = maxProjects !== null && projectCount >= maxProjects
  const periodEnd = user.currentPeriodEnd ? format.dateTime(new Date(user.currentPeriodEnd), "monthDayShort") : ""

  return (
    <div className="grid gap-4 rounded-[2rem] border border-border/60 bg-white/70 p-5 shadow-[0_8px_32px_-12px_rgba(76,29,149,0.15)] backdrop-blur-xl sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div>
        <p className="text-xs text-muted-foreground">{t("plans.current")}</p>
        <p className={cn("mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", isPro ? "bg-linear-to-r from-indigo-500 to-fuchsia-500 text-white" : "bg-violet-500/10 text-violet-700")}>
          {isPro && <SparklesIcon className="size-3.5" />}
          {t(`plans.${user.plan}.name`)}
        </p>
      </div>

      <div className="min-w-0">
        <p className="flex items-center justify-between gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <CoinsIcon className="size-4 text-violet-600" />
            {t("billing.creditsLeft", { credits: t("common.credits", { count: user.credits }) })}
          </span>
        </p>
        <Progress value={Math.min((user.credits / allowance) * 100, 100)} aria-label={t("billing.creditsLeftLabel")} className="mt-2" />
        <p className={cn("mt-1.5 text-xs", low ? "font-medium text-destructive" : "text-muted-foreground")}>
          {low
            ? t("billing.lowCredits")
            : !isPro
              ? t("billing.oneTimeCredits")
              : user.cancelAtPeriodEnd
                ? t("billing.endsWithPro", { date: periodEnd })
                : t("billing.expiresOn", { date: periodEnd })}
        </p>
      </div>

      <div className="min-w-0">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium">
          <FolderIcon className="size-4 text-violet-600" />
          {maxProjects === null
            ? t("billing.projectsCount", { count: projectCount })
            : t("billing.projectsOf", { used: Math.min(projectCount, maxProjects), max: maxProjects })}
        </p>
        {maxProjects !== null && <Progress value={Math.min((projectCount / maxProjects) * 100, 100)} aria-label={t("billing.projectsUsedLabel")} className="mt-2" />}
        <p className={cn("mt-1.5 text-xs", projectsFull ? "font-medium text-destructive" : "text-muted-foreground")}>
          {maxProjects === null
            ? t("billing.unlimited")
            : projectsFull
              ? t("billing.allProjectsUsed")
              : t("billing.screensEach", { count: PLANS[user.plan].maxScreens })}
        </p>
      </div>

      {isPro ? (
        <Button variant="outline" className="h-10 rounded-full px-4" render={<Link href="/pricing" />} nativeButton={false}>
          {t("billing.managePlan")}
          <ArrowRightIcon className="rtl:-scale-x-100" />
        </Button>
      ) : (
        <Button
          className="h-10 rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-4 text-white shadow-md shadow-violet-500/30 hover:opacity-95"
          render={<Link href="/pricing" />}
          nativeButton={false}
        >
          <SparklesIcon />
          {t("header.upgradePro")}
        </Button>
      )}
    </div>
  )
}
