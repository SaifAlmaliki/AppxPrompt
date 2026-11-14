"use client"

import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import * as React from "react"
import { CheckIcon, Loader2Icon, MinusIcon, SparklesIcon } from "lucide-react"

import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone"
import { useAuth } from "@/lib/auth-client"
import {
  EDIT_CREDITS,
  FREE_SIGNUP_CREDITS,
  PLANS,
  PRO_MONTHLY_CREDITS,
  PRO_PRICE_LABEL,
  SMALL_APP_CREDITS,
  type PlanId,
} from "@/lib/plans"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useBillingRedirect } from "@/components/billing/upgrade-dialog"
import { useSignInDialog } from "@/components/home/sign-in-dialog"

type Translator = ReturnType<typeof useTranslations<never>>

const FEATURE_IDS = ["credits", "build", "projects", "screens", "web", "stores"] as const

// Edits the Free plan's credits cover after one small app is built, as the pricing copy has always said.
const FREE_EDITS = 4

function featureValue(t: Translator, plan: PlanId, id: (typeof FEATURE_IDS)[number]): string | false {
  switch (id) {
    case "credits":
      return plan === "free"
        ? t("pricing.features.credits.free", {
            count: FREE_SIGNUP_CREDITS,
            credits: t("common.credits", { count: FREE_SIGNUP_CREDITS }),
          })
        : t("pricing.features.credits.pro", { credits: t("common.credits", { count: PRO_MONTHLY_CREDITS }) })
    case "build":
      return plan === "free"
        ? t("pricing.features.build.free", {
            apps: Math.floor((FREE_SIGNUP_CREDITS - FREE_EDITS * EDIT_CREDITS) / SMALL_APP_CREDITS),
            edits: FREE_EDITS,
          })
        : t("pricing.features.build.pro", {
            apps: PRO_MONTHLY_CREDITS / SMALL_APP_CREDITS,
            edits: PRO_MONTHLY_CREDITS / EDIT_CREDITS,
          })
    case "projects":
      return PLANS[plan].maxProjects === null
        ? t("pricing.features.projects.unlimited")
        : t("pricing.features.projects.free", { count: PLANS[plan].maxProjects })
    case "screens":
      return t("pricing.features.screens", { count: PLANS[plan].maxScreens })
    case "web":
      return t("pricing.features.web")
    case "stores":
      return PLANS[plan].nativePublish && t("pricing.features.stores.pro")
  }
}

/** `checkout` is how the browser's trip to Stripe went, when it has just come back. */
export function PricingPlans({ checkout }: { checkout: boolean }) {
  const { user, isPending, refresh } = useAuth()
  const { redirect, pending, error: redirectError } = useBillingRedirect()
  const { openSignIn } = useSignInDialog()
  const t = useTranslations()
  const format = useFormatter()
  const timeZone = useBrowserTimeZone()
  const [waitingForPayment, setWaitingForPayment] = React.useState(checkout)
  const [changing, setChanging] = React.useState(false)
  const [changeError, setChangeError] = React.useState<string | null>(null)
  const [confirmDowngrade, setConfirmDowngrade] = React.useState(false)

  const isPro = user?.plan === "pro"

  // Stripe tells the server by webhook, which can land a moment after the browser is back.
  React.useEffect(() => {
    if (!waitingForPayment) return
    if (isPro) return setWaitingForPayment(false)
    const timer = setInterval(() => void refresh(), 2000)
    const giveUp = setTimeout(() => setWaitingForPayment(false), 30_000)
    return () => {
      clearInterval(timer)
      clearTimeout(giveUp)
    }
  }, [isPro, refresh, waitingForPayment])

  async function change(action: "downgrade" | "keep-pro") {
    setChanging(true)
    setChangeError(null)
    const response = await fetch("/api/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null)
    if (response?.ok) {
      await refresh()
    } else {
      const body = await response?.json().catch(() => null)
      setChangeError(body?.error ?? t("billing.errors.network"))
    }
    setChanging(false)
    setConfirmDowngrade(false)
  }

  const endsOn = user?.currentPeriodEnd ? format.dateTime(new Date(user.currentPeriodEnd), "monthDayYear", { timeZone }) : null
  const error = redirectError ?? changeError

  return (
    <div className="space-y-6">
      {checkout && (waitingForPayment || isPro) && (
        <p role="status" className="mx-auto flex w-fit items-center gap-2 rounded-full bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-800">
          {isPro ? <CheckIcon className="size-4" /> : <Loader2Icon className="size-4 animate-spin" />}
          {isPro ? t("pricing.status.welcome") : t("pricing.status.confirming")}
        </p>
      )}
      {checkout && !waitingForPayment && !isPro && !isPending && (
        <p role="status" className="mx-auto w-fit rounded-full bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-800">
          {t("pricing.status.stillConfirming")}
        </p>
      )}
      {error && (
        <p role="alert" dir="auto" className="mx-auto w-fit rounded-full bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mx-auto grid max-w-4xl items-stretch gap-5 md:grid-cols-2">
        <PlanCard
          plan="free"
          current={!isPending && !!user && !isPro}
          tagline={t("pricing.plans.free.tagline")}
          price={t("pricing.plans.free.price")}
          period={t("pricing.plans.free.period")}
          action={
            isPending ? (
              <Skeleton className="h-11 rounded-full" />
            ) : !user ? (
              <Button variant="outline" className="h-11 w-full rounded-full" onClick={() => openSignIn("sign-up")}>
                {t("pricing.actions.getStarted")}
              </Button>
            ) : !isPro ? (
              <Button variant="outline" className="h-11 w-full rounded-full" render={<Link href="/" />} nativeButton={false}>
                {t("pricing.actions.buildApp")}
              </Button>
            ) : user.cancelAtPeriodEnd ? (
              <p className="flex h-11 items-center justify-center text-center text-sm text-muted-foreground">{t("pricing.actions.movesToFree", { date: endsOn ?? "" })}</p>
            ) : (
              <Button variant="outline" className="h-11 w-full rounded-full" disabled={changing} onClick={() => setConfirmDowngrade(true)}>
                {t("pricing.actions.downgrade")}
              </Button>
            )
          }
        />

        <PlanCard
          plan="pro"
          featured
          current={isPro}
          tagline={t("pricing.plans.pro.tagline")}
          price={PRO_PRICE_LABEL}
          period={t("pricing.plans.pro.period")}
          action={
            isPending ? (
              <Skeleton className="h-11 rounded-full" />
            ) : !user ? (
              <Button className="h-11 w-full rounded-full bg-white text-violet-700 hover:bg-white/90" onClick={() => openSignIn("sign-up")}>
                <SparklesIcon />
                {t("pricing.actions.signUpPro")}
              </Button>
            ) : !isPro ? (
              <Button className="h-11 w-full rounded-full bg-white text-violet-700 hover:bg-white/90" disabled={pending} onClick={() => void redirect("upgrade")}>
                {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                {t("header.upgradePro")}
              </Button>
            ) : (
              <div className="space-y-2">
                {user.cancelAtPeriodEnd ? (
                  <Button className="h-11 w-full rounded-full bg-white text-violet-700 hover:bg-white/90" disabled={changing} onClick={() => void change("keep-pro")}>
                    {changing && <Loader2Icon className="animate-spin" />}
                    {t("pricing.actions.keepPro")}
                  </Button>
                ) : (
                  <Button className="h-11 w-full rounded-full bg-white text-violet-700 hover:bg-white/90" disabled={pending} onClick={() => void redirect("manage")}>
                    {pending && <Loader2Icon className="animate-spin" />}
                    {t("pricing.actions.manageBilling")}
                  </Button>
                )}
                {endsOn && (
                  <p className="text-center text-xs text-white/80">
                    {user.cancelAtPeriodEnd ? t("pricing.actions.proEnds", { date: endsOn }) : t("pricing.actions.renews", { date: endsOn })}
                  </p>
                )}
              </div>
            )
          }
        />
      </div>

      <AlertDialog open={confirmDowngrade} onOpenChange={setConfirmDowngrade}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pricing.downgrade.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pricing.downgrade.description", {
                date: endsOn ?? t("pricing.downgrade.periodEnd"),
                max: PLANS.free.maxProjects ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("pricing.actions.keepPro")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={changing}
              onClick={(event) => {
                event.preventDefault()
                void change("downgrade")
              }}
            >
              {changing && <Loader2Icon className="animate-spin" />}
              {t("pricing.downgrade.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PlanCard({
  plan,
  featured = false,
  current,
  tagline,
  price,
  period,
  action,
}: {
  plan: PlanId
  featured?: boolean
  current: boolean
  tagline: string
  price: string
  period: string
  action: React.ReactNode
}) {
  const t = useTranslations()

  return (
    <section
      aria-label={t("plans.label", { plan: t(`plans.${plan}.name`) })}
      className={cn(
        "relative flex flex-col gap-6 rounded-[2rem] p-7",
        featured
          ? "bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-xl shadow-violet-500/30"
          : "border border-border/60 bg-white/70 shadow-[0_8px_32px_-12px_rgba(76,29,149,0.15)] backdrop-blur-xl"
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{t(`plans.${plan}.name`)}</h2>
          {current && (
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", featured ? "bg-white/20" : "bg-violet-500/10 text-violet-700")}>{t("plans.current")}</span>
          )}
        </div>
        <p className={cn("mt-1 text-sm", featured ? "text-white/85" : "text-muted-foreground")}>{tagline}</p>
        <p className="mt-5 flex items-baseline gap-1.5">
          <span dir="ltr" className="text-5xl font-semibold tracking-tight">
            {price}
          </span>
          <span className={cn("text-sm", featured ? "text-white/80" : "text-muted-foreground")}>{period}</span>
        </p>
      </div>

      {action}

      <ul className="space-y-3">
        {FEATURE_IDS.map((id) => {
          const value = featureValue(t, plan, id)
          return (
            <li key={id} className={cn("flex gap-2.5 text-sm", !value && "text-muted-foreground")}>
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                  featured ? "bg-white/20" : value ? "bg-violet-500/10 text-violet-700" : "bg-muted"
                )}
              >
                {value ? <CheckIcon className="size-3" /> : <MinusIcon className="size-3" />}
              </span>
              {value || t("pricing.features.stores.free")}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
