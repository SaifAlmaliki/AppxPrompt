import type { Metadata } from "next"
import Link from "next/link"
import { getFormatter, getTranslations } from "next-intl/server"
import type * as React from "react"
import { LightbulbIcon } from "lucide-react"

import { Logo } from "@/components/home/logo"
import { SignInDialogProvider } from "@/components/home/sign-in-dialog"
import { SiteHeader } from "@/components/home/site-header"
import { MAX_ASSETS } from "@/lib/projects"
import {
  EDIT_CREDITS,
  FREE_SIGNUP_CREDITS,
  IMAGE_CREDITS,
  PLANS,
  PRO_MONTHLY_CREDITS,
  SCREEN_CREDITS,
} from "@/lib/plans"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.docs")
  return {
    title: t("title"),
    description: t("description"),
  }
}

const SECTION_IDS = [
  "getting-started",
  "writing-prompts",
  "planning",
  "building",
  "editing",
  "themes",
  "phone",
  "backend",
  "export",
  "publish",
  "sharing",
  "credits",
] as const

type SectionId = (typeof SECTION_IDS)[number]

const TAGS = {
  strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
  code: (chunks: React.ReactNode) => <code dir="ltr">{chunks}</code>,
  file: (chunks: React.ReactNode) => <strong dir="ltr">{chunks}</strong>,
  templates: (chunks: React.ReactNode) => <Link href="/#templates">{chunks}</Link>,
  pricing: (chunks: React.ReactNode) => <Link href="/pricing">{chunks}</Link>,
  expoGo: (chunks: React.ReactNode) => (
    <a href="https://expo.dev/go" target="_blank" rel="noreferrer">
      {chunks}
    </a>
  ),
  expoToken: (chunks: React.ReactNode) => (
    <a href="https://expo.dev/settings/access-tokens" target="_blank" rel="noreferrer">
      {chunks}
    </a>
  ),
}

export default async function DocsPage() {
  const t = await getTranslations("docs")
  const tHome = await getTranslations("home")
  const tPlans = await getTranslations("plans")
  const tCommon = await getTranslations("common")
  const tComposer = await getTranslations("composer")
  const tShared = await getTranslations("projects.shared")
  const format = await getFormatter()

  const r = (key: Parameters<typeof t.rich>[0], values: Record<string, React.ReactNode | number> = {}) =>
    t.rich(key, { ...TAGS, ...values })
  const n = (value: number) => format.number(value, "integer")

  const content: Record<SectionId, React.ReactNode> = {
    "getting-started": (
      <>
        <p>{t("getting-started.p1")}</p>
        <Steps>
          <li>{r("getting-started.step1")}</li>
          <li>{t("getting-started.step2")}</li>
          <li>{t("getting-started.step3")}</li>
          <li>{t("getting-started.step4")}</li>
          <li>{t("getting-started.step5")}</li>
        </Steps>
        <p>{t("getting-started.p2")}</p>
      </>
    ),
    "writing-prompts": (
      <>
        <p>{t("writing-prompts.p1")}</p>
        <ul>
          <li>{r("writing-prompts.item1")}</li>
          <li>{r("writing-prompts.item2")}</li>
          <li>{r("writing-prompts.item3")}</li>
        </ul>
        <p>{t("writing-prompts.p2", { count: MAX_ASSETS, attach: tComposer("attach") })}</p>
        <Tip>{t("writing-prompts.tip")}</Tip>
      </>
    ),
    planning: (
      <>
        <p>{t("planning.p1")}</p>
        <p>{t("planning.p2")}</p>
        <Tip>{t("planning.tip")}</Tip>
      </>
    ),
    building: (
      <>
        <p>{t("building.p1")}</p>
        <Steps>
          <li>{r("building.step1")}</li>
          <li>{r("building.step2")}</li>
          <li>{r("building.step3")}</li>
        </Steps>
        <p>{t("building.p2")}</p>
      </>
    ),
    editing: (
      <>
        <h3>{t("editing.h1")}</h3>
        <p>{t("editing.p1")}</p>
        <h3>{t("editing.h2")}</h3>
        <p>{t("editing.p2")}</p>
        <h3>{t("editing.h3")}</h3>
        <p>{t("editing.p3", { credits: tCommon("credits", { count: IMAGE_CREDITS }) })}</p>
        <Tip>{t("editing.tip")}</Tip>
      </>
    ),
    themes: <p>{t("themes.p1")}</p>,
    phone: (
      <>
        <Steps>
          <li>{r("phone.step1")}</li>
          <li>{r("phone.step2", { button: t("buttons.scanQr") })}</li>
          <li>{t("phone.step3")}</li>
        </Steps>
        <p>{t("phone.p1")}</p>
        <Tip>{t("phone.tip")}</Tip>
      </>
    ),
    backend: (
      <>
        <p>{r("backend.p1", { button: t("buttons.connectBackend") })}</p>
        <p>{t("backend.p2")}</p>
      </>
    ),
    export: (
      <>
        <p>{r("export.p1", { button: t("buttons.export") })}</p>
        <ul>
          <li>{r("export.item1", { download: t("buttons.downloadZip") })}</li>
          <li>{r("export.item2", { push: t("buttons.pushGitHub") })}</li>
        </ul>
      </>
    ),
    publish: (
      <>
        <p>{r("publish.p1", { button: t("buttons.publish") })}</p>
        <h3>{t("publish.h1")}</h3>
        <p>{r("publish.p2", { web: t("buttons.publishWeb") })}</p>
        <h3>{t("publish.h2")}</h3>
        <p>{t("publish.p3")}</p>
        <ul>
          <li>{r("publish.item1")}</li>
          <li>{r("publish.item2")}</li>
          <li>{r("publish.item3")}</li>
        </ul>
        <p>{t("publish.p4")}</p>
      </>
    ),
    sharing: (
      <>
        <p>
          {r("sharing.p1", {
            share: t("buttons.shareProject"),
            export: t("buttons.export"),
            shared: tShared("title"),
          })}
        </p>
        <p>{r("sharing.p2", { showcase: t("buttons.showcase") })}</p>
        <p>{t("sharing.p3")}</p>
      </>
    ),
    credits: (
      <>
        <div className="overflow-x-auto rounded-2xl border border-border/60">
          <table className="w-full text-start text-sm">
            <thead className="bg-muted/50 text-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium" />
                <th className="px-4 py-2.5 font-medium">{tPlans("free.name")}</th>
                <th className="px-4 py-2.5 font-medium">{tPlans("pro.name")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              <tr>
                <td className="px-4 py-2.5">{t("credits.table.projects")}</td>
                <td className="px-4 py-2.5">{n(PLANS.free.maxProjects ?? 0)}</td>
                <td className="px-4 py-2.5">{t("credits.table.unlimited")}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">{t("credits.table.screens")}</td>
                <td className="px-4 py-2.5">{n(PLANS.free.maxScreens)}</td>
                <td className="px-4 py-2.5">{n(PLANS.pro.maxScreens)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">{t("credits.table.credits")}</td>
                <td className="px-4 py-2.5">{t("credits.table.freeCredits", { count: FREE_SIGNUP_CREDITS })}</td>
                <td className="px-4 py-2.5">{t("credits.table.proCredits", { count: PRO_MONTHLY_CREDITS })}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">{t("credits.table.publishing")}</td>
                <td className="px-4 py-2.5">{t("credits.table.yes")}</td>
                <td className="px-4 py-2.5">{t("credits.table.yes")}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">{t("credits.table.native")}</td>
                <td className="px-4 py-2.5">{t("credits.table.no")}</td>
                <td className="px-4 py-2.5">{t("credits.table.yes")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          {r("credits.p1", {
            screenCredits: tCommon("credits", { count: SCREEN_CREDITS }),
            editCredits: tCommon("credits", { count: EDIT_CREDITS }),
            imageCredits: tCommon("credits", { count: IMAGE_CREDITS }),
            edit: EDIT_CREDITS,
            image: IMAGE_CREDITS,
          })}
        </p>
      </>
    ),
  }

  return (
    <SignInDialogProvider>
      <div className="relative min-h-screen overflow-x-hidden bg-background">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[600px] overflow-hidden">
          <div className="absolute -top-40 left-1/2 size-[520px] -translate-x-[110%] animate-blob rounded-full bg-indigo-300/40 blur-[100px]" />
          <div className="absolute -top-20 left-1/2 size-[480px] translate-x-[10%] animate-blob rounded-full bg-fuchsia-300/35 blur-[100px] [animation-delay:-6s]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-background" />
        </div>

        <SiteHeader />

        <main className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <section className="mx-auto max-w-2xl pt-14 pb-12 text-center sm:pt-20">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{t("heading")}</h1>
            <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">{t("subtitle")}</p>
          </section>

          <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-12">
            <nav aria-label={t("nav")} className="hidden lg:block">
              <ul className="sticky top-28 space-y-0.5 text-sm">
                {SECTION_IDS.map((id) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="block rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-violet-500/10 hover:text-violet-700"
                    >
                      {t(`${id}.title`)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <article className="min-w-0 max-w-3xl space-y-14">
              {SECTION_IDS.map((id) => (
                <section key={id} id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28">
                  <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight">
                    {t(`${id}.title`)}
                  </h2>
                  <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-violet-700 [&_a]:hover:underline [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-foreground [&_h3]:pt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_ul>li]:ps-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:ps-5">
                    {content[id]}
                  </div>
                </section>
              ))}
            </article>
          </div>
        </main>

        <footer className="relative px-4 pb-4 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 rounded-[2rem] border border-border/60 bg-muted/40 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
            <Logo className="size-7 rounded-xl" />
            <p>{tHome("footer", { year: new Date().getFullYear() })}</p>
          </div>
        </footer>
      </div>
    </SignInDialogProvider>
  )
}

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="space-y-2.5 [counter-reset:step] [&>li]:relative [&>li]:ps-9 [&>li]:[counter-increment:step] [&>li]:before:absolute [&>li]:before:top-0 [&>li]:before:start-0 [&>li]:before:flex [&>li]:before:size-6 [&>li]:before:items-center [&>li]:before:justify-center [&>li]:before:rounded-full [&>li]:before:bg-violet-500/10 [&>li]:before:text-xs [&>li]:before:font-semibold [&>li]:before:text-violet-700 [&>li]:before:content-[counter(step)]">
      {children}
    </ol>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-3 rounded-2xl border border-violet-200/70 bg-violet-50/60 px-4 py-3 text-sm text-violet-900">
      <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-violet-600" />
      <span>{children}</span>
    </p>
  )
}
