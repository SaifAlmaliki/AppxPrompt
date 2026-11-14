"use client"

import { ArrowUpRightIcon } from "lucide-react"

import { TEMPLATES, USE_PROMPT_EVENT } from "@/lib/home-data"

export function TemplatesSection() {
  function applyTemplate(prompt: string) {
    window.dispatchEvent(new CustomEvent(USE_PROMPT_EVENT, { detail: prompt }))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <section id="templates" className="scroll-mt-24">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Start from a template</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each one is a detailed prompt. Pick one, change anything you like, and send it.
        </p>
      </div>

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TEMPLATES.map((template) => (
          <li key={template.name}>
            <button
              type="button"
              onClick={() => applyTemplate(template.prompt)}
              className="group flex h-full w-full flex-col rounded-[2rem] border border-border/60 bg-white/70 p-5 text-left shadow-[0_4px_20px_-12px_rgba(76,29,149,0.25)] transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:bg-white hover:shadow-[0_12px_32px_-12px_rgba(124,58,237,0.35)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  aria-hidden
                  className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-2xl"
                >
                  {template.emoji}
                </span>
                <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-700">
                  {template.category}
                </span>
              </div>

              <h3 className="mt-4 font-semibold tracking-tight">{template.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>

              <ul aria-label="Screens" className="mt-4 flex flex-wrap gap-1.5">
                {template.screens.map((screen) => (
                  <li key={screen} className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {screen}
                  </li>
                ))}
              </ul>

              <span className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-medium text-violet-700">
                Use this template
                <ArrowUpRightIcon className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
