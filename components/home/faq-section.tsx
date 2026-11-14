import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { EDIT_CREDITS, FREE_SIGNUP_CREDITS, PLANS, SCREEN_CREDITS } from "@/lib/plans"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

const QUESTIONS = [
  "builds",
  "coding",
  "ownership",
  "phone",
  "backend",
  "stores",
  "screens",
  "cost",
  "privacy",
] as const

export async function FaqSection() {
  const t = await getTranslations("faq")
  const tPlans = await getTranslations("plans")
  const tQr = await getTranslations("expoQr")
  const tHeader = await getTranslations("workspace.header")

  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-2xl scroll-mt-24">
      <h2 id="faq-title" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("heading")}
      </h2>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        {t.rich("subtitle", {
          docs: (chunks) => (
            <Link href="/docs" className="font-medium text-violet-700 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
      <Accordion className="mt-8 rounded-[2rem] border border-border/60 bg-white/70 px-6 py-2">
        {QUESTIONS.map((id) => (
          <AccordionItem key={id} value={id}>
            <AccordionTrigger className="py-4 text-base">{t(`items.${id}.question`)}</AccordionTrigger>
            <AccordionContent className="pb-4 text-muted-foreground">
              {t.rich(`items.${id}.answer`, {
                free: PLANS.free.maxScreens,
                pro: PLANS.pro.maxScreens,
                freeName: tPlans("free.name"),
                proName: tPlans("pro.name"),
                scanQr: tQr("trigger"),
                connectBackend: tHeader("backend.connect"),
                publish: tHeader("publish"),
                signup: FREE_SIGNUP_CREDITS,
                screen: SCREEN_CREDITS,
                edit: EDIT_CREDITS,
                pricing: (chunks) => <Link href="/pricing">{chunks}</Link>,
              })}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
