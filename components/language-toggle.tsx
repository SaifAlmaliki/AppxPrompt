"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"

import { LOCALE_COOKIE, LOCALES, isLocale, type Locale } from "@/i18n/config"
import { cn } from "@/lib/utils"

const SEGMENT_LABELS: Record<Locale, string> = { en: "EN", ar: "ع" }

export function LanguageToggle({ className }: { className?: string }) {
  const t = useTranslations()
  const router = useRouter()
  const current = useLocale()
  const [isPending, startTransition] = React.useTransition()
  const [target, setTarget] = React.useState<Locale | null>(null)
  const refs = React.useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({})

  const locale: Locale = isLocale(current) ? current : "en"
  const active = isPending && target ? target : locale

  function select(next: Locale) {
    if (next === locale) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    setTarget(next)
    startTransition(() => {
      router.refresh()
    })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const next = LOCALES.find((candidate) => candidate !== active)
    if (!next) return
    select(next)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("languageToggle.label")}
      aria-busy={isPending}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex h-8 shrink-0 items-center rounded-full bg-violet-500/10 p-0.5",
        className
      )}
    >
      {LOCALES.map((option) => {
        const checked = option === active
        return (
          <button
            key={option}
            ref={(node) => {
              refs.current[option] = node
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(`languageToggle.${option}`)}
            lang={option}
            tabIndex={checked ? 0 : -1}
            onClick={() => select(option)}
            className={cn(
              "inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              checked
                ? "bg-white text-violet-700 shadow-sm"
                : "text-muted-foreground hover:text-violet-700"
            )}
          >
            <span aria-hidden>{SEGMENT_LABELS[option]}</span>
          </button>
        )
      })}
    </div>
  )
}
