"use client"

import { useTranslations } from "next-intl"
import { CloudIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function BackendCard({ appName, onOpen }: { appName: string; onOpen: () => void }) {
  const t = useTranslations("backend")

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600">
        <CloudIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p dir="auto" className="text-sm leading-relaxed">
          {t("card.text", { name: appName })}
        </p>
        <Button size="sm" className="rounded-full" onClick={onOpen}>
          {t("card.open")}
        </Button>
      </div>
    </div>
  )
}
