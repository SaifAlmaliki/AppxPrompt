"use client"

import { useTranslations } from "next-intl"
import { KeyRoundIcon } from "lucide-react"

import type { ServiceSummary } from "@/lib/services/protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { serviceStatusKey } from "@/components/workspace/service-dialog"

const STATUS_DOTS = {
  connected: "bg-emerald-500",
  rejected: "bg-red-500",
  untested: "bg-amber-500",
  missing: "bg-amber-500",
} as const

export function ServicesButton({ services, onOpen }: { services: ServiceSummary[]; onOpen: (slug: string) => void }) {
  const t = useTranslations("services")
  const needsAttention = services.some((service) => service.status !== "connected")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" aria-label={t("menu.label")} title={t("menu.label")} className="relative h-8 rounded-full px-3" />}
      >
        <KeyRoundIcon />
        <span className="hidden lg:inline">{t("menu.label")}</span>
        {needsAttention && (
          <span role="img" aria-label={t("menu.needsAttention")} className="absolute end-1.5 top-1.5 size-2 rounded-full bg-amber-500 ring-2 ring-white" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-2xl">
        {services.length === 0 ? (
          <p dir="auto" className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {t("menu.empty")}
          </p>
        ) : (
          services.map((service) => {
            const key = serviceStatusKey(service)
            return (
              <DropdownMenuItem key={service.slug} className="justify-between gap-3 rounded-xl py-2" onClick={() => onOpen(service.slug)}>
                <span dir="auto" className="truncate">
                  {service.name}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOTS[key])} />
                  {t(`status.${key}`)}
                </span>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
