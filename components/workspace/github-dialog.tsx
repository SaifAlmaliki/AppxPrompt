"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GitBranchIcon,
  GithubIcon,
  GitPullRequestIcon,
  Loader2Icon,
  LockIcon,
  RotateCwIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react"

import type {
  GitHubConnectResult,
  GitHubErrorCode,
  GitHubLinkedRepository,
  GitHubPushEvent,
  GitHubPushResult,
  GitHubRepositoryOption,
  GitHubStatus,
} from "@/lib/github-protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"

const CONNECT_RESULT_KEYS = ["denied", "error"] as const
const isConnectResultKey = (result: GitHubConnectResult): result is (typeof CONNECT_RESULT_KEYS)[number] =>
  (CONNECT_RESULT_KEYS as readonly string[]).includes(result)

type View =
  | { name: "loading" }
  | { name: "picker"; notice?: string }
  | { name: "confirm"; notice?: string }
  | { name: "pushing"; label: string; percent: number }
  | { name: "done"; result: GitHubPushResult }
  | { name: "failed"; message: string }

/** Reads the push's progress to its end. Returns whether it finished, rather than the connection dropping. */
async function readPush(body: NonNullable<Response["body"]>, onEvent: (event: GitHubPushEvent) => void) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  let finished = false
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return finished
    buffer += value
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as GitHubPushEvent
      if (event.type !== "progress") finished = true
      onEvent(event)
    }
  }
}

export function GitHubDialog({
  projectId,
  projectName,
  defaultRepoName,
  open,
  onOpenChange,
  connectResult,
  beforeExport,
}: {
  projectId: string
  projectName: string
  defaultRepoName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** How the browser's trip to GitHub went, when it has just come back. */
  connectResult: GitHubConnectResult | null
  /** Saves edits still on their way, so the push has them. */
  beforeExport: () => Promise<boolean>
}) {
  const t = useTranslations("github")
  const tw = useTranslations("workspace.errors")
  const [status, setStatus] = React.useState<GitHubStatus | null>(null)
  const [view, setView] = React.useState<View>({ name: "loading" })

  const push = React.useCallback(async () => {
    setView({ name: "pushing", label: t("progress.saving"), percent: 1 })
    if (!(await beforeExport())) {
      return setView({ name: "failed", message: t("errors.notSaved") })
    }
    const response = await fetch(`/api/projects/${projectId}/github`, { method: "POST" }).catch(() => null)
    if (!response?.ok || !response.body) {
      const body = await response?.json().catch(() => null)
      return setView({ name: "failed", message: body?.error ?? tw("network") })
    }

    let failure: { message: string; code?: GitHubErrorCode } | null = null
    const finished = await readPush(response.body, (event) => {
      if (event.type === "progress") setView({ name: "pushing", label: event.label, percent: event.percent })
      else if (event.type === "done") {
        setView({ name: "done", result: event.result })
        setStatus((current) =>
          current?.repository && event.result.outcome === "pushed"
            ? { ...current, repository: { ...current.repository, lastBranch: event.result.branch, lastPushedAt: new Date().toISOString() } }
            : current
        )
      } else failure = { message: event.message, code: event.code }
    }).catch(() => false)

    if (!finished) {
      return setView({ name: "failed", message: t("errors.connectionLost") })
    }
    if (failure) {
      const { message, code } = failure as { message: string; code?: GitHubErrorCode }
      if (code === "reauth") setStatus((current) => current && { ...current, account: null })
      if (code === "repository") {
        setStatus((current) => current && { ...current, repository: null })
        return setView({ name: "picker", notice: message })
      }
      setView(code === "reauth" ? { name: "picker", notice: message } : { name: "failed", message })
    }
  }, [beforeExport, projectId, t, tw])

  const pushRef = React.useRef(push)
  React.useEffect(() => {
    pushRef.current = push
  })

  // Opening this is the request: a project that's been pushed before goes straight to a new branch.
  const load = React.useCallback(
    async (allowAutoPush: boolean) => {
      setView({ name: "loading" })
      const response = await fetch(`/api/projects/${projectId}/github`).catch(() => null)
      const body = await response?.json().catch(() => null)
      if (!response?.ok) {
        return setView({ name: "failed", message: body?.error ?? t("errors.loadFailed") })
      }
      const next = body as GitHubStatus
      setStatus(next)
      if (next.account && next.repository?.lastPushedAt && allowAutoPush) return void pushRef.current()
      setView(next.repository ? { name: "confirm" } : { name: "picker" })
    },
    [projectId, t]
  )

  React.useEffect(() => {
    // Coming back from GitHub only finishes connecting. Pushing waits for the person to ask.
    if (open) void load(connectResult === null)
  }, [connectResult, load, open])

  const pushing = view.name === "pushing"
  const showConnect = status && status.available && !status.account && view.name !== "failed" && view.name !== "loading"
  const account = status?.account

  async function disconnect() {
    const response = await fetch("/api/github/connection", { method: "DELETE" }).catch(() => null)
    if (!response?.ok) return setView({ name: "failed", message: t("errors.disconnectFailed") })
    setStatus((current) => current && { ...current, account: null })
    setView({ name: "picker" })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing during a push would hide how it ended.
        if (!pushing || next) onOpenChange(next)
      }}
    >
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md" showCloseButton={!pushing}>
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <GithubIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">{t("title")}</DialogTitle>
            <DialogDescription>
              {account ? (
                <>
                  {t.rich("connectedAs", {
                    login: account.login,
                    account: (chunks) => (
                      <span className="font-medium text-foreground">
                        <bdi dir="ltr">{chunks}</bdi>
                      </span>
                    ),
                  })}
                  {!pushing && (
                    <>
                      {" · "}
                      <button type="button" onClick={() => void disconnect()} className="hover:text-foreground hover:underline">
                        {t("disconnect")}
                      </button>
                    </>
                  )}
                </>
              ) : (
                t("tagline")
              )}
            </DialogDescription>
          </div>
        </DialogHeader>

        {view.name === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t("checking")}
          </p>
        ) : status && !status.available ? (
          <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("notAvailable")}
          </p>
        ) : showConnect ? (
          <ConnectView
            projectId={projectId}
            notice={("notice" in view ? view.notice : null) ?? (connectResult && isConnectResultKey(connectResult) ? t(`connectResult.${connectResult}`) : null)}
          />
        ) : view.name === "picker" ? (
          <RepositoryPicker
            projectId={projectId}
            defaultRepoName={defaultRepoName}
            notice={view.notice}
            onChosen={(next) => {
              setStatus(next)
              setView({ name: "confirm" })
            }}
            onNeedsConnection={(message) => {
              setStatus((current) => current && { ...current, account: null })
              setView({ name: "picker", notice: message })
            }}
          />
        ) : view.name === "confirm" && status?.repository ? (
          <ConfirmView
            repository={status.repository}
            projectName={projectName}
            notice={view.notice}
            onPush={() => void push()}
            onChange={() => setView({ name: "picker" })}
          />
        ) : view.name === "pushing" ? (
          <div role="status" className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2Icon className="size-4 shrink-0 animate-spin text-violet-600" />
              <span className="min-w-0 truncate">{view.label}</span>
            </p>
            <Progress value={view.percent} aria-label={t("progress.label")} />
            <p className="text-xs text-muted-foreground">{t("progress.hint")}</p>
          </div>
        ) : view.name === "done" ? (
          <DoneView result={view.result} onClose={() => onOpenChange(false)} onChange={() => setView({ name: "picker" })} />
        ) : view.name === "failed" ? (
          <>
            <p role="alert" dir="auto" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {view.message}
            </p>
            <Button className="h-10 rounded-full" onClick={() => void load(false)}>
              <RotateCwIcon />
              {t("tryAgain")}
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ConnectView({ projectId, notice }: { projectId: string; notice: string | null }) {
  const t = useTranslations("github")
  const [pending, setPending] = React.useState(false)
  return (
    <>
      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-emerald-600" />
        {t("connect.privacy")}
      </p>
      {notice && (
        <p role="alert" dir="auto" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notice}
        </p>
      )}
      <Button
        className="h-10 rounded-full"
        disabled={pending}
        onClick={() => {
          setPending(true)
          window.location.assign(`/api/projects/${projectId}/github/connect`)
        }}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <GithubIcon />}
        {t("connect.button")}
      </Button>
    </>
  )
}

function RepositoryPicker({
  projectId,
  defaultRepoName,
  notice,
  onChosen,
  onNeedsConnection,
}: {
  projectId: string
  defaultRepoName: string
  notice?: string
  onChosen: (status: GitHubStatus) => void
  onNeedsConnection: (message: string) => void
}) {
  const t = useTranslations("github")
  const tw = useTranslations("workspace.errors")
  const [mode, setMode] = React.useState<"create" | "existing">("create")
  const [name, setName] = React.useState(defaultRepoName)
  const [isPrivate, setIsPrivate] = React.useState(true)
  const [repositories, setRepositories] = React.useState<GitHubRepositoryOption[] | null>(null)
  const [search, setSearch] = React.useState("")
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(notice ?? null)

  React.useEffect(() => {
    if (mode !== "existing" || repositories) return
    let active = true
    void (async () => {
      const response = await fetch("/api/github/repos").catch(() => null)
      const body = await response?.json().catch(() => null)
      if (!active) return
      if (body?.code === "reauth") return onNeedsConnection(body.error)
      if (!response?.ok) return setError(body?.error ?? t("errors.reposFailed"))
      setRepositories(body.repositories)
    })()
    return () => {
      active = false
    }
  }, [mode, onNeedsConnection, repositories, t])

  async function choose(payload: object, key: string) {
    setPending(key)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/github`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setPending(null)
    if (body?.code === "reauth") return onNeedsConnection(body.error)
    if (!response?.ok) return setError(body?.error ?? tw("network"))
    onChosen(body as GitHubStatus)
  }

  const matches = (repositories ?? []).filter((repo) => repo.fullName.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <>
      <div role="tablist" aria-label={t("picker.label")} className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
        {(["create", "existing"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => {
              setMode(id)
              setError(null)
            }}
            className={cn(
              "rounded-full py-1.5 text-sm font-medium transition-colors",
              mode === id ? "bg-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`picker.${id}`)}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" dir="auto" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {mode === "create" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void choose({ create: { name, private: isPrivate } }, "create")
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="github-repo-name" className="text-sm font-medium">
              {t("picker.name")}
            </label>
            <Input id="github-repo-name" dir="ltr" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className="h-10 rounded-full px-4" />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t("picker.private")}</span>
              <span className="block text-xs text-muted-foreground">{t("picker.privateHint")}</span>
            </span>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </label>
          <Button type="submit" className="h-10 w-full rounded-full" disabled={pending !== null || !name.trim()}>
            {pending === "create" && <Loader2Icon className="animate-spin" />}
            {pending === "create" ? t("picker.creating") : t("picker.createButton")}
          </Button>
        </form>
      ) : repositories === null ? (
        !error && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t("picker.loading")}
          </p>
        )
      ) : repositories.length === 0 ? (
        <p className="rounded-2xl bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">{t("picker.none")}</p>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="github-repo-search" className="sr-only">
              {t("picker.search")}
            </label>
            <Input
              id="github-repo-search"
              dir="auto"
              placeholder={t("picker.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 rounded-full pe-4 ps-9"
            />
          </div>
          <ul className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-2xl border border-border/60">
            {matches.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">{t("picker.noMatch")}</li>}
            {matches.map((repo) => (
              <li key={repo.fullName}>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void choose({ repository: repo.fullName }, repo.fullName)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm transition-colors hover:bg-violet-500/10 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <bdi dir="ltr">{repo.fullName}</bdi>
                  </span>
                  {repo.private && <LockIcon aria-label={t("picker.private")} className="size-3.5 shrink-0 text-muted-foreground" />}
                  {pending === repo.fullName && <Loader2Icon className="size-4 shrink-0 animate-spin text-violet-600" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function ConfirmView({
  repository,
  projectName,
  notice,
  onPush,
  onChange,
}: {
  repository: GitHubLinkedRepository
  projectName: string
  notice?: string
  onPush: () => void
  onChange: () => void
}) {
  const t = useTranslations("github")
  const value = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">
      <bdi dir="ltr">{chunks}</bdi>
    </span>
  )

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 px-3 py-2.5">
        <a href={repository.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-sm font-medium hover:underline">
          <GithubIcon className="size-4 shrink-0" />
          <span className="truncate">
            <bdi dir="ltr">{repository.fullName}</bdi>
          </span>
        </a>
        <button type="button" onClick={onChange} className="shrink-0 text-xs font-medium text-violet-700 hover:underline">
          {t("confirm.change")}
        </button>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        {repository.empty === false
          ? t.rich("confirm.hasCode", { projectName, branch: repository.defaultBranch ?? "", value, bdi: (chunks) => <bdi>{chunks}</bdi> })
          : repository.empty
            ? t.rich("confirm.empty", { branch: repository.defaultBranch ?? "", value })
            : t("confirm.unknown")}
      </p>

      {notice && (
        <p role="alert" dir="auto" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notice}
        </p>
      )}

      <Button className="h-10 rounded-full" onClick={onPush}>
        <GithubIcon />
        {t("confirm.push")}
      </Button>
    </>
  )
}

function DoneView({ result, onClose, onChange }: { result: GitHubPushResult; onClose: () => void; onChange: () => void }) {
  const t = useTranslations("github")
  const subject = result.commitMessage?.split("\n")[0]
  return (
    <>
      <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-800">
        <CheckCircle2Icon className="size-4 shrink-0" />
        {result.outcome === "up-to-date" ? t("done.upToDate") : t("done.pushed", { count: result.filesChanged })}
      </p>

      <dl className="space-y-2 rounded-2xl border border-border/60 px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("picker.label")}</dt>
          <GithubIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <dd className="min-w-0 truncate">
            <bdi dir="ltr">{result.repository}</bdi>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("done.branch")}</dt>
          <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <dd className="min-w-0 truncate font-mono text-xs">
            <bdi dir="ltr">{result.branch}</bdi>
          </dd>
        </div>
        {subject && (
          <div>
            <dt className="sr-only">{t("done.commitMessage")}</dt>
            <dd dir="auto" className="text-xs leading-relaxed text-muted-foreground">{subject}</dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="me-auto rounded-full text-muted-foreground" onClick={onChange}>
          {t("done.changeRepository")}
        </Button>
        {result.compareUrl ? (
          <Button className="rounded-full" render={<a href={result.compareUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>
            <GitPullRequestIcon />
            {t("done.openPullRequest")}
          </Button>
        ) : (
          <Button className="rounded-full" render={<a href={result.url} target="_blank" rel="noreferrer" />} nativeButton={false}>
            {t("done.view")}
            <ExternalLinkIcon />
          </Button>
        )}
        <Button variant="outline" className="rounded-full" onClick={onClose}>
          {t("done.done")}
        </Button>
      </div>
    </>
  )
}
