"use client"

import { useTranslations } from "next-intl"
import { KeyRoundIcon } from "lucide-react"

import type { ServiceSummary } from "@/lib/services/protocol"
import { Button } from "@/components/ui/button"

export function ServiceCard({ service, onOpen }: { service: ServiceSummary; onOpen: () => void }) {
  const t = useTranslations("services")
  const rejected = service.status === "rejected"
  const values = { name: service.name, purpose: service.purpose }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600">
        <KeyRoundIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p dir="auto" className="text-sm leading-relaxed">
          {rejected ? t("card.rejected", values) : t("card.text", values)}
        </p>
        <Button size="sm" className="rounded-full" onClick={onOpen}>
          {rejected ? t("card.fix") : t("card.open")}
        </Button>
      </div>
    </div>
  )
}
