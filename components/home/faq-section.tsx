import Link from "next/link"
import type * as React from "react"

import { EDIT_CREDITS, FREE_SIGNUP_CREDITS, PLANS, SCREEN_CREDITS } from "@/lib/plans"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

const QUESTIONS: { question: string; answer: React.ReactNode }[] = [
  {
    question: "What does AppxPrompt build?",
    answer:
      "A real mobile app, written in Expo and React Native, that runs on iOS and Android and on the web. You describe it, the agent plans the screens with you, and then builds them one at a time while you watch.",
  },
  {
    question: "Do I need to know how to code?",
    answer:
      "No. You talk to the agent in plain language, and you can click any element in a screen to change its text, color, or image. If you do code, every file is there to read, and you can download the project.",
  },
  {
    question: "Who owns the code?",
    answer:
      "You do. Download a complete Expo project as a ZIP, or push it to your own GitHub repository, and keep working on it anywhere. Nothing ties it to AppxPrompt.",
  },
  {
    question: "How do I try my app on a phone?",
    answer:
      "Click Scan QR Code in the workspace and scan it with Expo Go. The app opens on your phone, and every change you make shows up there right away while the tab stays open.",
  },
  {
    question: "Can my app have real accounts and data?",
    answer:
      "Yes. Connect Backend gives your app its own CloudHike database, sign-in, and file storage, with no changes to your screens. Until then, apps run on sample data stored in your browser.",
  },
  {
    question: "Can I put my app in the App Store and Google Play?",
    answer: (
      <>
        On Pro, Publish builds the .aab, .apk, and .ipa files through your own Expo account, ready to upload with your Apple and Google
        developer accounts. Any plan can publish the app as a website with its own address.
      </>
    ),
  },
  {
    question: "How many screens can an app have?",
    answer: `Up to ${PLANS.free.maxScreens} on Free and ${PLANS.pro.maxScreens} on Pro. The agent keeps a first plan small so you can see results quickly, and adds more screens whenever you ask.`,
  },
  {
    question: "What does it cost?",
    answer: (
      <>
        Starting is free, with {FREE_SIGNUP_CREDITS} credits that never expire. A new screen costs {SCREEN_CREDITS} credits and a round
        of changes costs {EDIT_CREDITS}, while chatting, planning, and switching themes are free. See <Link href="/pricing">Pricing</Link>{" "}
        for Pro.
      </>
    ),
  },
  {
    question: "Who can see my projects?",
    answer:
      "Only you, unless you choose otherwise. You can share a project with someone by email so they can view it, or show it on the AppxPrompt home page for anyone to try with sample data.",
  },
]

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-2xl scroll-mt-24">
      <h2 id="faq-title" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        Frequently asked questions
      </h2>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Can't find your answer? The <Link href="/docs" className="font-medium text-violet-700 hover:underline">docs</Link> cover
        every feature step by step.
      </p>
      <Accordion className="mt-8 rounded-[2rem] border border-border/60 bg-white/70 px-6 py-2">
        {QUESTIONS.map(({ question, answer }) => (
          <AccordionItem key={question} value={question}>
            <AccordionTrigger className="py-4 text-base">{question}</AccordionTrigger>
            <AccordionContent className="pb-4 text-muted-foreground">{answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
