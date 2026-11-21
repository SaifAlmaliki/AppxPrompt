import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PricingPlans } from "@/components/billing/pricing-plans"
import { Logo } from "@/components/home/logo"
import { SignInDialogProvider } from "@/components/home/sign-in-dialog"
import { SiteHeader } from "@/components/home/site-header"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { EDIT_CREDITS, IMAGE_CREDITS, PLANS, PRO_MONTHLY_CREDITS, SCREEN_CREDITS, SMALL_APP_CREDITS } from "@/lib/plans"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.pricing")
  return {
    title: t("title"),
    description: t("description"),
  }
}

const CREDIT_COSTS = [
  { id: "smallApp", value: SMALL_APP_CREDITS },
  { id: "edit", value: EDIT_CREDITS },
  { id: "image", value: IMAGE_CREDITS },
  { id: "planning", value: 0 },
] as const

const QUESTIONS = ["used", "rollover", "topup", "downgrade", "publish"] as const

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams
  const t = await getTranslations()

  const answerValues = {
    screenCredits: t("common.credits", { count: SCREEN_CREDITS }),
    editCredits: t("common.credits", { count: EDIT_CREDITS }),
    screen: SCREEN_CREDITS,
    edit: EDIT_CREDITS,
    monthly: PRO_MONTHLY_CREDITS,
    max: PLANS.free.maxProjects ?? 0,
  }

  return (
    <SignInDialogProvider>
      <div className="relative min-h-screen overflow-x-hidden bg-background">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[700px] overflow-hidden">
          <div className="absolute -top-40 left-1/2 size-[520px] -translate-x-[110%] animate-blob rounded-full bg-indigo-300/40 blur-[100px]" />
          <div className="absolute -top-20 left-1/2 size-[480px] translate-x-[10%] animate-blob rounded-full bg-fuchsia-300/35 blur-[100px] [animation-delay:-6s]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-background" />
        </div>

        <SiteHeader />

        <main className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <section className="mx-auto max-w-2xl pt-14 pb-10 text-center sm:pt-20">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{t("pricing.title")}</h1>
            <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">{t("pricing.subtitle")}</p>
          </section>

          <PricingPlans checkout={checkout === "success" ? "pro" : checkout === "topup" ? "topup" : null} />

          <section aria-labelledby="credit-costs" className="mx-auto mt-20 max-w-4xl">
            <h2 id="credit-costs" className="text-center text-2xl font-semibold tracking-tight">
              {t("pricing.costs.heading")}
            </h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CREDIT_COSTS.map(({ id, value }) => (
                <li key={id} className="rounded-3xl border border-border/60 bg-white/70 p-5">
                  <p className="text-3xl font-semibold tracking-tight text-violet-700">
                    {value === 0 ? t("pricing.costs.free") : t("common.credits", { count: value })}
                  </p>
                  <p className="mt-2 text-sm font-medium">{t(`pricing.costs.${id}.label`)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {id === "smallApp"
                      ? t("pricing.costs.smallApp.detail", {
                          screens: SMALL_APP_CREDITS / SCREEN_CREDITS,
                          credits: t("common.credits", { count: SCREEN_CREDITS }),
                        })
                      : t(`pricing.costs.${id}.detail`)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="questions" className="mx-auto mt-20 max-w-2xl">
            <h2 id="questions" className="text-center text-2xl font-semibold tracking-tight">
              {t("pricing.questions.heading")}
            </h2>
            <Accordion className="mt-6">
              {QUESTIONS.map((id) => (
                <AccordionItem key={id} value={id}>
                  <AccordionTrigger>{t(`pricing.questions.${id}.question`)}</AccordionTrigger>
                  <AccordionContent>{t(`pricing.questions.${id}.answer`, answerValues)}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        </main>

        <footer className="relative px-4 pb-4 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 rounded-[2rem] border border-border/60 bg-muted/40 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
            <Logo className="size-7 rounded-xl" />
            <p>{t("home.footer", { year: new Date().getFullYear() })}</p>
          </div>
        </footer>
      </div>
    </SignInDialogProvider>
  )
}
