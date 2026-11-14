"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  CheckCircle2Icon,
  CloudIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FolderIcon,
  KeyRoundIcon,
  Loader2Icon,
  MailIcon,
  ShieldCheckIcon,
  TimerIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  isBackendConnected,
  type BackendConnectResult,
  type BackendStatus,
} from "@/lib/backend-protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const FEATURES = [
  { icon: DatabaseIcon, service: "postgres" },
  { icon: KeyRoundIcon, service: "auth" },
  { icon: FolderIcon, service: "storage" },
  { icon: MailIcon, service: "email" },
  { icon: TimerIcon, service: "jobs" },
] as const

const SERVICE_STATUSES = ["ready", "failed", "provisioning", "pending", "queued"] as const
const isServiceStatus = (status: string): status is (typeof SERVICE_STATUSES)[number] => (SERVICE_STATUSES as readonly string[]).includes(status)

const RESULT_KEYS = ["denied", "error"] as const
const isResultKey = (result: BackendConnectResult): result is (typeof RESULT_KEYS)[number] => (RESULT_KEYS as readonly string[]).includes(result)

export function BackendDialog({
  projectId,
  open,
  onOpenChange,
  backend,
  connectResult,
  onLink,
  onDisconnect,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  backend: BackendStatus
  connectResult: BackendConnectResult | null
  onLink: () => Promise<boolean>
  onDisconnect: () => Promise<boolean>
}) {
  const t = useTranslations("backend")
  const connected = isBackendConnected(backend)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <CloudIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">
              {connected ? t("titleConnected") : t("title")}
            </DialogTitle>
            <DialogDescription>
              {connected ? t("descriptionConnected") : t("description")}
            </DialogDescription>
          </div>
        </DialogHeader>

        {connected ? (
          <ConnectedView projectId={projectId} backend={backend} onDisconnect={onDisconnect} onClose={() => onOpenChange(false)} />
        ) : (
          <ConnectView
            projectId={projectId}
            backend={backend}
            notice={connectResult && isResultKey(connectResult) ? t(`connectResult.${connectResult}`) : null}
            onLink={onLink}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConnectView({
  projectId,
  backend,
  notice,
  onLink,
}: {
  projectId: string
  backend: BackendStatus
  notice: string | null
  onLink: () => Promise<boolean>
}) {
  const t = useTranslations("backend")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const needsReconnect = backend.state !== "disconnected"
  const shownError = error ?? (needsReconnect ? backend.error : null) ?? notice

  async function link() {
    setPending(true)
    setError(null)
    if (!(await onLink())) setError(t("connect.linkFailed"))
    setPending(false)
  }

  return (
    <>
      <section className="rounded-2xl border border-border/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">CloudHike</h3>
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700">{t("connect.provider")}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("connect.intro")}
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {FEATURES.map(({ icon: Icon, service }) => (
            <li key={service} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
              <Icon className="size-3" />
              {t(`services.${service}`)}
            </li>
          ))}
        </ul>
      </section>

      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-emerald-600" />
        {t("connect.privacy")}
      </p>

      {shownError && (
        <p role="alert" dir="auto" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {shownError}
        </p>
      )}

      {!backend.available ? (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t("connect.notAvailable")}
        </p>
      ) : backend.accountConnected ? (
        <Button className="h-10 rounded-full" disabled={pending} onClick={link}>
          {pending && <Loader2Icon className="animate-spin" />}
          {t("connect.useAccount")}
        </Button>
      ) : (
        <Button
          className="h-10 rounded-full"
          disabled={pending}
          onClick={() => {
            setPending(true)
            window.location.assign(`/api/projects/${projectId}/backend/connect`)
          }}
        >
          {pending && <Loader2Icon className="animate-spin" />}
          {needsReconnect ? t("connect.reconnect") : t("connect.connect")}
        </Button>
      )}
    </>
  )
}

function ConnectedView({
  projectId,
  backend,
  onDisconnect,
  onClose,
}: {
  projectId: string
  backend: BackendStatus
  onDisconnect: () => Promise<boolean>
  onClose: () => void
}) {
  const t = useTranslations("backend")
  const [confirming, setConfirming] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function disconnect() {
    setPending(true)
    setError(null)
    if (await onDisconnect()) {
      setConfirming(false)
      onClose()
    } else {
      setError(t("connected.disconnectFailed"))
    }
    setPending(false)
  }

  return (
    <>
      <p className={cn(
        "flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium",
        backend.state === "failed" ? "bg-amber-500/10 text-amber-800" : "bg-emerald-500/10 text-emerald-800"
      )}>
        {backend.state === "provisioning" ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
        ) : backend.state === "failed" ? (
          <TriangleAlertIcon className="size-4 shrink-0" />
        ) : (
          <CheckCircle2Icon className="size-4 shrink-0" />
        )}
        {backend.state === "ready"
          ? t("connected.ready")
          : backend.state === "provisioning"
            ? t("connected.provisioning")
            : backend.state === "failed"
              ? t("connected.failed")
              : t("connected.linked")}
      </p>

      {backend.error && <p role="alert" dir="auto" className="-mt-2 text-xs text-muted-foreground">{backend.error}</p>}

      {!backend.accountConnected && (
        <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("connected.accountLost")}{" "}
          <a href={`/api/projects/${projectId}/backend/connect`} className="font-medium text-violet-700 hover:underline">
            {t("connect.reconnect")}
          </a>
        </p>
      )}

      {backend.services.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
          {backend.services.map((service) => (
            <li key={service.type} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              {t(`services.${service.type}`)}
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground capitalize">
                <span aria-hidden className={cn("size-1.5 rounded-full", service.status === "ready" ? "bg-emerald-500" : service.status === "failed" ? "bg-red-500" : "bg-amber-500")} />
                {isServiceStatus(service.status) ? t(`serviceStatus.${service.status}`) : service.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" dir="auto" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="rounded-2xl border border-border/60 p-3">
          <p className="text-sm font-medium">{t("connected.confirmTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("connected.confirmBody")}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" className="rounded-full" disabled={pending} onClick={() => setConfirming(false)}>
              {t("connected.keep")}
            </Button>
            <Button variant="destructive" className="rounded-full" disabled={pending} onClick={disconnect}>
              {pending && <Loader2Icon className="animate-spin" />}
              {t("connected.disconnect")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" className="rounded-full text-muted-foreground" disabled={backend.state === "provisioning"} onClick={() => setConfirming(true)}>
            {t("connected.disconnect")}
          </Button>
          {backend.dashboardUrl && (
            <Button
              variant="outline"
              className="rounded-full"
              render={<a href={backend.dashboardUrl} target="_blank" rel="noreferrer" />}
              nativeButton={false}
            >
              {t("connected.open")}
              <ExternalLinkIcon />
            </Button>
          )}
        </div>
      )}
    </>
  )
}
