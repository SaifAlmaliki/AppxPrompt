import type { Metadata } from "next"
import Link from "next/link"
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

export const metadata: Metadata = {
  title: "Docs — AppxPrompt",
  description:
    "Learn how to plan, build, edit, test, and publish a mobile app with AppxPrompt, from your first prompt to the app stores.",
}

const SECTIONS: { id: string; title: string; content: React.ReactNode }[] = [
  {
    id: "getting-started",
    title: "Getting started",
    content: (
      <>
        <p>
          AppxPrompt turns a description into a working Expo (React Native) app for iOS and Android. The whole journey takes a few
          minutes:
        </p>
        <Steps>
          <li>Describe your app in the box on the home page, or start from a <Link href="/#templates">template</Link>.</li>
          <li>Answer a few questions from the agent, then confirm the screen plan it proposes.</li>
          <li>Watch the screens being built, and tap through the running app in the preview.</li>
          <li>Change anything by chatting, or click an element to edit it directly.</li>
          <li>Try it on your phone, download the code, or publish it.</li>
        </Steps>
        <p>
          You need a free account to create a project. If you write a prompt first, it's kept while you sign up, and your project
          starts as soon as you're in.
        </p>
      </>
    ),
  },
  {
    id: "writing-prompts",
    title: "Write a good prompt",
    content: (
      <>
        <p>The agent asks about anything you leave out, but a clear prompt gets you to a good first version faster. Mention:</p>
        <ul>
          <li><strong>What the app is for</strong> and who uses it: "A booking app for a hair salon's clients."</li>
          <li><strong>The main screens</strong> and what each one shows: "a list of services with prices, and a calendar to pick a time."</li>
          <li><strong>The look</strong> you want: "elegant, soft rose and charcoal, rounded cards."</li>
        </ul>
        <p>
          You can attach up to {MAX_ASSETS} files to a prompt: screenshots of apps you like, sketches, a logo, or a PDF or text file
          with your requirements. Pick the platform from the menu next to Attach.
        </p>
        <Tip>Start small. A focused app with three or four screens is quicker to get right, and you can add more screens any time.</Tip>
      </>
    ),
  },
  {
    id: "planning",
    title: "Plan with the agent",
    content: (
      <>
        <p>
          When your workspace opens, the agent reads your prompt and asks a few short questions about what matters most. Questions
          often come with numbered choices, so you can answer with just a number, or type your own answer.
        </p>
        <p>
          Then it proposes a plan: the screens it will build, what each does, and the tabs the app will have. Ask for changes in the
          chat ("add a settings screen", "drop the map") until it's right, then confirm with the button on the plan or by saying so.
          Nothing is built, and no credits are used, until you confirm.
        </p>
        <Tip>Unless you ask for more, a first plan has a few main screens plus a sign-in screen, so you see results quickly.</Tip>
      </>
    ),
  },
  {
    id: "building",
    title: "How a build works",
    content: (
      <>
        <p>Once you confirm, the agent builds your app in this order:</p>
        <Steps>
          <li><strong>Themes and data.</strong> The colors, fonts, and sample content your screens share.</li>
          <li><strong>Shared components.</strong> Buttons, cards, and other pieces reused across screens, so one change updates the whole app.</li>
          <li><strong>Screens</strong>, one at a time, each appearing in the preview as soon as it's ready.</li>
        </Steps>
        <p>
          Builds run in the background, so you can leave the page and come back to follow along. Credits are taken when a build
          starts, and if it fails you get back the credits for whatever it didn't finish.
        </p>
      </>
    ),
  },
  {
    id: "editing",
    title: "Edit your app",
    content: (
      <>
        <h3>By chat</h3>
        <p>
          Ask for any change in the chat: new screens, a different layout, extra fields, renamed tabs. Only the screens and
          components affected are rebuilt, and each one keeps working until its new version is ready.
        </p>
        <h3>Inline editing</h3>
        <p>
          Click the Edit icon on a screen in the canvas, then click any element to change its text, colors, or image. Edits show up
          instantly, without reloading the app, and are saved straight into the code. A selected element is also sent with your next
          chat message, so you can say "make this bigger" and the agent knows what you mean.
        </p>
        <h3>AI images</h3>
        <p>
          In edit mode, select an image to replace it with a link, generate a new one from a description, or transform it ("make it
          a watercolor"). Each AI image costs {IMAGE_CREDITS} credit.
        </p>
        <Tip>Colors you pick by hand stay the same when you switch themes. To keep an element in step with the theme, ask the agent instead.</Tip>
      </>
    ),
  },
  {
    id: "themes",
    title: "Themes",
    content: (
      <p>
        Every app comes with five themes: Default, Ocean, Forest, Sunset, and Midnight, which is dark. Switch between them from the
        theme switcher in the workspace. Nothing is rebuilt and it's free, so try them all. Want something else? Ask the agent for a
        new theme in your brand colors.
      </p>
    ),
  },
  {
    id: "phone",
    title: "Test on your phone",
    content: (
      <>
        <Steps>
          <li>Install <a href="https://expo.dev/go" target="_blank" rel="noreferrer">Expo Go</a> on your phone.</li>
          <li>In the workspace, click <strong>Scan QR Code</strong>.</li>
          <li>Scan it with your iPhone's Camera, or from inside Expo Go on Android.</li>
        </Steps>
        <p>
          The app runs on your phone and updates live as you make changes. Keep the browser tab open while you test, because closing
          it takes the app offline.
        </p>
        <Tip>Your app needs Expo Go for SDK 54. If Expo Go says the app is incompatible, it's on a newer SDK.</Tip>
      </>
    ),
  },
  {
    id: "backend",
    title: "Add a backend",
    content: (
      <>
        <p>
          New apps run on sample data stored in your browser, which is perfect for trying ideas. When you're ready for real users,
          click <strong>Connect Backend</strong> in the workspace header and sign in to CloudHike.
        </p>
        <p>
          Your app gets its own CloudHike project with a database, plus sign-in and file storage if its screens use them. Every
          collection in your app becomes a real table, and your screens don't need to change. Later builds keep the backend up to date
          on their own.
        </p>
      </>
    ),
  },
  {
    id: "export",
    title: "Export your code",
    content: (
      <>
        <p>The code is yours. Open the <strong>Export</strong> menu in the workspace header:</p>
        <ul>
          <li>
            <strong>Download as ZIP</strong> gives you a complete Expo project. Run <code>npm install</code> and{" "}
            <code>npx expo start</code>, then scan the QR code with Expo Go. The included README has the details.
          </li>
          <li>
            <strong>Push to GitHub</strong> connects your GitHub account and pushes to a repository you choose. The first push to an
            empty repository goes to its default branch. Every other push goes to a new <code>appxprompt/…</code> branch, so nothing
            already on GitHub is overwritten.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "publish",
    title: "Publish your app",
    content: (
      <>
        <p>
          Click <strong>Publish</strong> in the workspace header. Publishing runs through your own Expo account, so the first time
          you'll paste an{" "}
          <a href="https://expo.dev/settings/access-tokens" target="_blank" rel="noreferrer">Expo access token</a>. AppxPrompt stores it
          encrypted and only uses it to publish your app and follow its progress.
        </p>
        <h3>As a website</h3>
        <p>
          <strong>Publish as Web</strong> puts your app online at its own <code>expo.app</code> address. The address stays the same
          when you publish updates, and if an update fails the previous version stays online. Available on every plan.
        </p>
        <h3>For the app stores</h3>
        <p>On Pro, Expo builds the files for you:</p>
        <ul>
          <li><strong>.aab</strong> to upload to Google Play.</li>
          <li><strong>.apk</strong> to install directly on Android phones.</li>
          <li><strong>.ipa</strong> to upload to the App Store.</li>
        </ul>
        <p>
          Android signing is set up for you. iOS builds need your Apple developer credentials in Expo, and the dialog walks you
          through it if they're missing. Keep the dialog open to follow a build's progress.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Share and showcase",
    content: (
      <>
        <p>
          Projects are private by default. Choose <strong>Share project</strong> from the Export menu to give someone with an
          AppxPrompt account view-only access by email. It shows up under "Shared with you" on their home page.
        </p>
        <p>
          In the same dialog, turn on <strong>Show on the AppxPrompt home page</strong> to let anyone try your app. Visitors only ever
          see sample data, never your backend, and anything they do stays in their own browser.
        </p>
        <p>To try a variation without touching the original, duplicate a project from its menu on the home page.</p>
      </>
    ),
  },
  {
    id: "credits",
    title: "Plans and credits",
    content: (
      <>
        <div className="overflow-x-auto rounded-2xl border border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium" />
                <th className="px-4 py-2.5 font-medium">Free</th>
                <th className="px-4 py-2.5 font-medium">Pro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              <tr>
                <td className="px-4 py-2.5">Projects</td>
                <td className="px-4 py-2.5">{PLANS.free.maxProjects}</td>
                <td className="px-4 py-2.5">Unlimited</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">Screens per project</td>
                <td className="px-4 py-2.5">{PLANS.free.maxScreens}</td>
                <td className="px-4 py-2.5">{PLANS.pro.maxScreens}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">Credits</td>
                <td className="px-4 py-2.5">{FREE_SIGNUP_CREDITS}, never expire</td>
                <td className="px-4 py-2.5">{PRO_MONTHLY_CREDITS.toLocaleString()} a month</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">Web publishing, ZIP, and GitHub</td>
                <td className="px-4 py-2.5">Yes</td>
                <td className="px-4 py-2.5">Yes</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">Android and iOS builds</td>
                <td className="px-4 py-2.5">No</td>
                <td className="px-4 py-2.5">Yes</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          A new screen costs {SCREEN_CREDITS} credits, a round of changes costs {EDIT_CREDITS}, and an AI image costs {IMAGE_CREDITS}.
          Chatting, planning, and switching themes are free, though the agent needs at least {EDIT_CREDITS} credits to reply. Your
          balance is always in the header. See <Link href="/pricing">Pricing</Link> for details.
        </p>
      </>
    ),
  },
]

export default function DocsPage() {
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
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">AppxPrompt docs</h1>
            <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">
              Everything you need to go from an idea to an app on your phone, and from there to the app stores.
            </p>
          </section>

          <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-12">
            <nav aria-label="On this page" className="hidden lg:block">
              <ul className="sticky top-28 space-y-0.5 text-sm">
                {SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-violet-500/10 hover:text-violet-700"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <article className="min-w-0 max-w-3xl space-y-14">
              {SECTIONS.map((section) => (
                <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-28">
                  <h2 id={`${section.id}-title`} className="text-2xl font-semibold tracking-tight">
                    {section.title}
                  </h2>
                  <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-violet-700 [&_a]:hover:underline [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-foreground [&_h3]:pt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_ul>li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                    {section.content}
                  </div>
                </section>
              ))}
            </article>
          </div>
        </main>

        <footer className="relative px-4 pb-4 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 rounded-[2rem] border border-border/60 bg-muted/40 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
            <Logo className="size-7 rounded-xl" />
            <p>© {new Date().getFullYear()} AppxPrompt. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </SignInDialogProvider>
  )
}

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="space-y-2.5 [counter-reset:step] [&>li]:relative [&>li]:pl-9 [&>li]:[counter-increment:step] [&>li]:before:absolute [&>li]:before:top-0 [&>li]:before:left-0 [&>li]:before:flex [&>li]:before:size-6 [&>li]:before:items-center [&>li]:before:justify-center [&>li]:before:rounded-full [&>li]:before:bg-violet-500/10 [&>li]:before:text-xs [&>li]:before:font-semibold [&>li]:before:text-violet-700 [&>li]:before:content-[counter(step)]">
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
