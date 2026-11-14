"use client"

import * as React from "react"
import { formatDistanceToNow } from "date-fns"
import { ar } from "date-fns/locale/ar"
import { useLocale, useTranslations } from "next-intl"
import {
  AppleIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GlobeIcon,
  Loader2Icon,
  RocketIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
} from "lucide-react"

import type { WebPublishState } from "@/hooks/use-web-publish"
import { useAuth } from "@/lib/auth-client"
import { isUpgradeReason, PLANS } from "@/lib/plans"
import type { ProjectPlatform } from "@/lib/projects"
import {
  FORMAT_PLATFORM,
  VERSION_PATTERN,
  isWebPublishActive,
  type AppBuildFormat,
  type AppBuildStatus,
  type AppBuildSummary,
  type IosSetup,
  type PublishResult,
  type PublishStatus,
  type ActiveWebPublishStatus,
} from "@/lib/publish-protocol"
import { cn } from "@/lib/utils"
import { useUpgradeDialog } from "@/components/billing/upgrade-dialog"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { CopyLinkButton } from "@/components/workspace/expo-qr-popover"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const POLL_MS = 5000

const FORMATS: AppBuildFormat[] = ["aab", "apk", "ipa"]

const STATUS_STYLES: Record<AppBuildStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  building: "bg-amber-500/10 text-amber-700",
  ready: "bg-emerald-500/10 text-emerald-700",
  failed: "bg-destructive/10 text-destructive",
}

/** The steps of a website publish, in the order they happen. Waiting for a server is part of building. */
const WEB_STEPS = ["uploading", "building", "deploying"] as const

const isActive = (build: AppBuildSummary) => build.status === "queued" || build.status === "building"

export function PublishDialog({
  projectId,
  platform,
  open,
  onOpenChange,
  beforeExport,
  webPublish,
}: {
  projectId: string
  platform: ProjectPlatform
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Saves edits still on their way, so the build has them. */
  beforeExport: () => Promise<boolean>
  webPublish: WebPublishState
}) {
  const t = useTranslations("publish")
  const tw = useTranslations("workspace.errors")
  const [status, setStatus] = React.useState<PublishStatus | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [iosSetup, setIosSetup] = React.useState<IosSetup | null>(null)
  const [retryingId, setRetryingId] = React.useState<string | null>(null)
  const { user } = useAuth()
  const openUpgrade = useUpgradeDialog()
  const nativePublish = user ? PLANS[user.plan].nativePublish : false

  const load = React.useCallback(async () => {
    setLoadError(null)
    const response = await fetch(`/api/projects/${projectId}/publish`).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (!response?.ok) return setLoadError(body?.error ?? t("errors.loadFailed"))
    setStatus(body as PublishStatus)
  }, [projectId, t])

  React.useEffect(() => {
    if (!open) return
    setError(null)
    void load()
  }, [load, open])

  // The server holds the status, so closing the dialog or the tab loses nothing. This only follows it.
  const following = open && Boolean(status?.builds.some(isActive))
  React.useEffect(() => {
    if (!following) return
    const timer = setInterval(() => {
      void (async () => {
        const response = await fetch(`/api/projects/${projectId}/publish?only=builds`).catch(() => null)
        const body = await response?.json().catch(() => null)
        if (response?.ok) setStatus((current) => current && { ...current, builds: body.builds })
      })()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [following, projectId])

  async function start(format: AppBuildFormat, version: string) {
    setStarting(true)
    setError(null)
    setIosSetup(null)
    try {
      if (!(await beforeExport())) return setError(t("errors.notSaved"))
      const response = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, version }),
      }).catch(() => null)
      const body = await response?.json().catch(() => null)
      if (!response?.ok) {
        // What it asks for has changed under the dialog, such as a token Expo stopped accepting.
        if (isUpgradeReason(body?.code)) openUpgrade(body.code)
        else if (body?.code) void load()
        return setError(body?.error ?? tw("network"))
      }
      const result = body as PublishResult
      if ("iosSetup" in result) return setIosSetup(result.iosSetup)
      // The server has dropped the failed attempts at this file, now that a new build replaces them.
      setStatus(
        (current) =>
          current && {
            ...current,
            lastVersion: version,
            builds: [result.build, ...current.builds.filter((build) => build.format !== format || build.status !== "failed")],
          }
      )
    } finally {
      setStarting(false)
      setRetryingId(null)
    }
  }

  const running = status?.builds.some(isActive) ?? false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The column is fixed to the dialog's width, or one long word in a build error stretches everything in it. */}
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] gap-5 overflow-y-auto rounded-3xl p-6 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <RocketIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </div>
        </DialogHeader>

        {loadError ? (
          <>
            <ErrorDetails summary={t("loadErrorSummary")}>{loadError}</ErrorDetails>
            <Button className="h-10 rounded-full" onClick={() => void load()}>
              <RotateCwIcon />
              {t("tryAgain")}
            </Button>
          </>
        ) : !status ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t("checking")}
          </p>
        ) : !status.available ? (
          <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("notAvailable")}
          </p>
        ) : !status.expo ? (
          <ConnectExpo onConnected={() => void load()} />
        ) : (
          <Tabs defaultValue="web" className="min-w-0 gap-4">
            <TabsList className="h-9 w-full rounded-full bg-muted/70 p-0.5">
              <TabsTrigger value="web" className="rounded-full px-3 data-active:text-violet-700">
                <GlobeIcon />
                {t("tabs.web")}
              </TabsTrigger>
              <TabsTrigger value="stores" className="rounded-full px-3 data-active:text-violet-700">
                <SmartphoneIcon />
                {t("tabs.stores")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="web" className="min-w-0 space-y-4">
              <WebPublishPanel webPublish={webPublish} onBlocked={() => void load()} />
              <ExpoAccount account={status.expo.account} onDisconnected={() => void load()} />
            </TabsContent>

            {/* Stays mounted, so looking at the website doesn't lose the choices made here. */}
            <TabsContent value="stores" keepMounted className="min-w-0 space-y-5 data-hidden:hidden">
              {!nativePublish ? (
                <AppStoresLocked onUpgrade={() => openUpgrade("native-publish")} />
              ) : iosSetup ? (
                <IosSetupView setup={iosSetup} onBack={() => setIosSetup(null)} />
              ) : (
                <ExportForm
                  key={status.lastVersion ?? ""}
                  platform={platform}
                  account={status.expo.account}
                  initialVersion={status.lastVersion ?? "1.0.0"}
                  busy={starting}
                  running={running}
                  error={error}
                  onExport={(format, version) => void start(format, version)}
                  onDisconnected={() => void load()}
                />
              )}

              {status.builds.length > 0 && !iosSetup && (
                <section aria-label={t("builds.title")} className="space-y-2">
                  <h3 className="text-sm font-medium">{t("builds.title")}</h3>
                  <ul className="space-y-2">
                    {status.builds.map((build) => (
                      <BuildRow
                        key={build.id}
                        build={build}
                        retrying={retryingId === build.id}
                        retryDisabled={starting || running}
                        onRetry={() => {
                          setRetryingId(build.id)
                          void start(build.format, build.version)
                        }}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** An error folded down to one line, with the message itself shown only once it's expanded. */
function ErrorDetails({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <Collapsible role="alert">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-start text-xs font-medium text-destructive">
        {summary}
        <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p dir="auto" className="mt-1 max-h-32 overflow-y-auto rounded-lg bg-destructive/10 px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap text-destructive">{children}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AppStoresLocked({ onUpgrade }: { onUpgrade: () => void }) {
  const t = useTranslations("publish.locked")

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-2xl border border-violet-200 bg-violet-500/5 px-3 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700">
          <SmartphoneIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t.rich("description", {
              file: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
            })}
          </p>
        </div>
      </div>
      <Button className="h-10 w-full rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30 hover:opacity-95" onClick={onUpgrade}>
        <SparklesIcon />
        {t("upgrade")}
      </Button>
    </div>
  )
}

function ConnectExpo({ onConnected }: { onConnected: () => void }) {
  const t = useTranslations("publish")
  const tw = useTranslations("workspace.errors")
  const [token, setToken] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const response = await fetch("/api/expo/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setPending(false)
    if (!response?.ok) return setError(body?.error ?? tw("network"))
    setToken("")
    onConnected()
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-emerald-600" />
        {t("connect.privacy")}
      </p>
      <div className="space-y-1.5">
        <label htmlFor="expo-token" className="text-sm font-medium">
          {t("connect.tokenLabel")}
        </label>
        <Input
          id="expo-token"
          type="password"
          dir="ltr"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="h-10 rounded-full px-4"
        />
        <a
          href="https://expo.dev/settings/access-tokens"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline"
        >
          {t("connect.create")}
          <ExternalLinkIcon className="size-3" />
        </a>
      </div>
      {error && <ErrorDetails summary={t("connect.errorSummary")}>{error}</ErrorDetails>}
      <Button type="submit" className="h-10 w-full rounded-full" disabled={pending || !token.trim()}>
        {pending && <Loader2Icon className="animate-spin" />}
        {pending ? t("connect.checking") : t("connect.submit")}
      </Button>
    </form>
  )
}

function ExpoAccount({ account, onDisconnected }: { account: string; onDisconnected: () => void }) {
  const t = useTranslations("publish")
  const [error, setError] = React.useState<string | null>(null)

  async function disconnect() {
    setError(null)
    const response = await fetch("/api/expo/connection", { method: "DELETE" }).catch(() => null)
    if (!response?.ok) return setError(t("errors.disconnectFailed"))
    onDisconnected()
  }

  return (
    <>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t.rich("account.runsOn", {
          account,
          value: (chunks) => (
            <span className="font-medium text-foreground">
              <bdi dir="ltr">{chunks}</bdi>
            </span>
          ),
        })}{" "}
        ·{" "}
        <button type="button" onClick={() => void disconnect()} className="hover:text-foreground hover:underline">
          {t("account.disconnect")}
        </button>
      </p>
      {error && <ErrorDetails summary={t("account.errorSummary")}>{error}</ErrorDetails>}
    </>
  )
}

function WebPublishPanel({ webPublish, onBlocked }: { webPublish: WebPublishState; onBlocked: () => void }) {
  const t = useTranslations("publish")
  const locale = useLocale()
  const { web, starting, active, error, publish } = webPublish
  // A failed update leaves the last version online, which the card above the error says.
  const url = web?.url ?? null
  const failed = !active && web?.status === "failed"

  return (
    <div className="space-y-4">
      {url ? (
        <div className="space-y-1 rounded-2xl border border-border/60 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
            {!active && !failed ? t("web.live") : t("web.liveNow")}
            {web?.publishedAt && (
              <span className="font-normal text-muted-foreground">
                {t("web.updated", {
                  time: formatDistanceToNow(new Date(web.publishedAt), { addSuffix: true, locale: locale === "ar" ? ar : undefined }),
                })}
              </span>
            )}
          </p>
          <div className="flex items-center justify-between gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 text-sm font-medium hover:text-violet-700 hover:underline"
            >
              <span dir="ltr" className="truncate">
                {url.replace(/^https:\/\//, "").replace(/\/$/, "")}
              </span>
              <ExternalLinkIcon className="size-3 shrink-0" />
            </a>
            <CopyLinkButton url={url} />
          </div>
        </div>
      ) : (
        !active && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("web.intro")}
          </p>
        )
      )}

      {active && <WebPublishSteps status={starting || !web || !isWebPublishActive(web.status) ? "uploading" : web.status} />}

      {error ? (
        <ErrorDetails summary={t("web.errorSummary")}>{error}</ErrorDetails>
      ) : (
        failed && (
          <ErrorDetails summary={url ? t("web.updateFailed") : t("web.failed")}>
            {web?.error ?? t("errors.siteFailed")}
          </ErrorDetails>
        )
      )}

      <Button
        className="h-10 w-full rounded-full"
        disabled={active}
        onClick={() => {
          void publish().then((code) => {
            if (code) onBlocked()
          })
        }}
      >
        {active ? <Loader2Icon className="animate-spin" /> : failed ? <RotateCwIcon /> : <GlobeIcon />}
        {active ? t("web.publishing") : failed ? t("tryAgain") : url ? t("web.publishUpdate") : t("web.publishWeb")}
      </Button>
    </div>
  )
}

function WebPublishSteps({ status }: { status: ActiveWebPublishStatus }) {
  const t = useTranslations("preview.publishStep")
  const currentIndex = status === "queued" ? WEB_STEPS.indexOf("building") : WEB_STEPS.indexOf(status)

  return (
    <ol role="status" className="space-y-2 rounded-2xl bg-muted/50 px-3 py-2.5">
      {WEB_STEPS.map((step, index) => (
        <li key={step} className={cn("flex items-center gap-2 text-sm", index > currentIndex && "text-muted-foreground")}>
          {index < currentIndex ? (
            <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
          ) : index === currentIndex ? (
            <Loader2Icon className="size-3.5 shrink-0 animate-spin text-violet-600" />
          ) : (
            <span aria-hidden className="mx-[3px] size-2 shrink-0 rounded-full bg-border" />
          )}
          {index === currentIndex ? t(status) : t(step)}
        </li>
      ))}
    </ol>
  )
}

function ExportForm({
  platform,
  account,
  initialVersion,
  busy,
  running,
  error,
  onExport,
  onDisconnected,
}: {
  platform: ProjectPlatform
  account: string
  initialVersion: string
  busy: boolean
  running: boolean
  error: string | null
  onExport: (format: AppBuildFormat, version: string) => void
  onDisconnected: () => void
}) {
  const t = useTranslations("publish")
  const choices = FORMATS.filter((id) => platform === "ios-android" || FORMAT_PLATFORM[id] === platform)
  const [format, setFormat] = React.useState<AppBuildFormat>(choices[0])
  const [version, setVersion] = React.useState(initialVersion)
  const versionValid = VERSION_PATTERN.test(version.trim())

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (versionValid) onExport(format, version.trim())
      }}
    >
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium">{t("export.fileType")}</legend>
        {choices.map((id) => (
          <label
            key={id}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors",
              format === id ? "border-violet-400 bg-violet-500/5" : "border-border/60 hover:bg-muted/50"
            )}
          >
            <input type="radio" name="publish-format" value={id} checked={format === id} onChange={() => setFormat(id)} className="accent-violet-600" />
            {FORMAT_PLATFORM[id] === "ios" ? <AppleIcon className="size-4 shrink-0 text-muted-foreground" /> : <SmartphoneIcon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t(`formats.${id}.title`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`formats.${id}.detail`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="publish-version" className="text-sm font-medium">
          {t("export.version")}
        </label>
        <Input
          id="publish-version"
          value={version}
          dir="ltr"
          inputMode="decimal"
          placeholder="1.0.0"
          aria-invalid={!versionValid}
          aria-describedby="publish-version-hint"
          onChange={(event) => setVersion(event.target.value)}
          className="h-10 rounded-full px-4"
        />
        <p id="publish-version-hint" className={cn("text-xs", versionValid ? "text-muted-foreground" : "text-destructive")}>
          {versionValid ? t("export.versionHint") : t("export.versionInvalid")}
        </p>
      </div>

      <ExpoAccount account={account} onDisconnected={onDisconnected} />

      {error && <ErrorDetails summary={t("export.errorSummary")}>{error}</ErrorDetails>}

      <Button type="submit" className="h-10 w-full rounded-full" disabled={busy || running || !versionValid}>
        {busy ? <Loader2Icon className="animate-spin" /> : <RocketIcon />}
        {busy ? t("export.starting") : running ? t("export.running") : t("export.submit")}
      </Button>
    </form>
  )
}

function IosSetupView({ setup, onBack }: { setup: IosSetup; onBack: () => void }) {
  const t = useTranslations("publish.iosSetup")
  const tHeader = useTranslations("workspace.header")
  const value = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">
      <bdi dir="ltr">{chunks}</bdi>
    </span>
  )
  const commands = [
    "npm install",
    "npm install --global eas-cli",
    "eas login",
    "eas init",
    "eas credentials --platform ios",
  ].join("\n")

  return (
    <div className="space-y-3">
      <p role="status" className="rounded-2xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800">
        {t("notStarted")}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t.rich("intro", { zip: tHeader("downloadZip"), menu: tHeader("export"), account: setup.account, value })}
      </p>
      <pre dir="ltr" className="overflow-x-auto rounded-2xl bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed">{commands}</pre>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t.rich("profile", {
          bundleId: setup.bundleIdentifier,
          profile: value,
          bundle: (chunks) => (
            <span dir="ltr" className="font-mono text-xs text-foreground">
              {chunks}
            </span>
          ),
        })}
      </p>
      <Button variant="outline" className="h-10 w-full rounded-full" onClick={onBack}>
        {t("back")}
      </Button>
    </div>
  )
}

function BuildRow({ build, retrying, retryDisabled, onRetry }: { build: AppBuildSummary; retrying: boolean; retryDisabled: boolean; onRetry: () => void }) {
  const t = useTranslations("publish")
  const className = retrying ? STATUS_STYLES.queued : STATUS_STYLES[build.status]
  const label = retrying ? t("status.retrying") : t(`status.${build.status}`)
  return (
    <li className="space-y-2 rounded-2xl border border-border/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span dir="ltr" className="min-w-0 truncate text-sm font-medium">
          .{build.format} · {build.version}
        </span>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", className)}>
          {(retrying || isActive(build)) && <Loader2Icon className="size-3 animate-spin" />}
          {label}
        </span>
      </div>
      {build.status === "ready" && build.artifactUrl && (
        <Button className="h-8 w-full rounded-full" render={<a href={build.artifactUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>
          <DownloadIcon />
          <span>{t.rich("builds.download", { format: `.${build.format}`, bdi: (chunks) => <bdi>{chunks}</bdi> })}</span>
        </Button>
      )}
      {build.status === "failed" && !retrying && (
        <>
          <ErrorDetails summary={t("builds.viewError")}>{build.error ?? t("errors.buildFailed")}</ErrorDetails>
          <Button variant="outline" className="h-8 w-full rounded-full" disabled={retryDisabled} onClick={onRetry}>
            <RotateCwIcon />
            {t("builds.retry")}
          </Button>
        </>
      )}
    </li>
  )
}
