"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { KeyRoundIcon, RotateCcwIcon } from "lucide-react"

import type { ServiceSummary } from "@/lib/services/protocol"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { serviceStatusKey } from "@/components/workspace/service-dialog"

const STATUS_DOTS = {
  connected: "bg-emerald-500",
  rejected: "bg-red-500",
  untested: "bg-amber-500",
  missing: "bg-amber-500",
} as const

type ResetState = "idle" | "working" | "done" | "failed"

export function ServicesButton({
  projectId,
  services,
  hasServer,
  onOpen,
}: {
  projectId: string
  services: ServiceSummary[]
  /** Whether the app has server functions, which are what use the server key. */
  hasServer: boolean
  onOpen: (slug: string) => void
}) {
  const t = useTranslations("services")
  const needsAttention = services.some((service) => service.status !== "connected")
  const [resetOpen, setResetOpen] = React.useState(false)
  const [reset, setReset] = React.useState<ResetState>("idle")

  async function rotateKey() {
    setReset("working")
    const response = await fetch(`/api/projects/${projectId}/server-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rotate" }),
    }).catch(() => null)
    setReset(response?.ok ? "done" : "failed")
  }

  return (
    <>
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
          {hasServer && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 rounded-xl py-2"
                onClick={() => {
                  setReset("idle")
                  setResetOpen(true)
                }}
              >
                <RotateCcwIcon />
                {t("resetServerKey")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {hasServer && (
        <AlertDialog open={resetOpen} onOpenChange={(open) => reset !== "working" && setResetOpen(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("resetServerKey")}</AlertDialogTitle>
              <AlertDialogDescription role={reset === "failed" ? "alert" : undefined}>
                {reset === "done" ? t("resetServerKeyDone") : reset === "failed" ? t("errors.resetServerKey") : t("resetServerKeyConfirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {reset === "done" ? (
                <AlertDialogCancel>{t("resetServerKeyClose")}</AlertDialogCancel>
              ) : (
                <>
                  <AlertDialogCancel disabled={reset === "working"}>{t("resetServerKeyCancel")}</AlertDialogCancel>
                  <AlertDialogAction disabled={reset === "working"} onClick={() => void rotateKey()}>
                    {t("resetServerKeyAction")}
                  </AlertDialogAction>
                </>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
