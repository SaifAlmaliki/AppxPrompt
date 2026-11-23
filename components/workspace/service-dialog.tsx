"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  CopyIcon,
  KeyRoundIcon,
  Loader2Icon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { oauthRedirectUri, type ServiceConnectResult, type ServiceSummary } from "@/lib/services/protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Outcome = { ok: true; service: ServiceSummary | null } | { ok: false; message: string | null }

/** Sends a change to one service. The response never holds a saved value. */
async function changeService(url: string, init: RequestInit): Promise<Outcome> {
  const response = await fetch(url, init).catch(() => null)
  if (!response) return { ok: false, message: null }
  const body = await response.json().catch(() => null)
  if (!response.ok) return { ok: false, message: typeof body?.error === "string" ? body.error : null }
  return { ok: true, service: (body?.service as ServiceSummary | undefined) ?? null }
}

function putValues(projectId: string, slug: string, values: Record<string, string>) {
  return changeService(`/api/projects/${projectId}/services/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  })
}

/** What a service looks like once its saved values are gone. */
function withoutValues(service: ServiceSummary): ServiceSummary {
  return {
    ...service,
    status: "missing",
    checkResult: null,
    checkedAt: null,
    oauthConnected: false,
    fields: service.fields.map((field) => ({ ...field, set: false, hint: null })),
  }
}

type StatusKey = "connected" | "rejected" | "untested" | "missing"

export function serviceStatusKey(service: ServiceSummary): StatusKey {
  if (service.status === "rejected") return "rejected"
  if (service.status === "connected") return service.checkResult === null ? "untested" : "connected"
  return "missing"
}

const noSubscription = () => () => {}

export function ServiceDialog({
  projectId,
  open,
  onOpenChange,
  service,
  pastedKeys,
  services,
  connectResult,
  onChanged,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  service: ServiceSummary | null
  /** Keys taken out of a chat message. They only live here, and go when the dialog closes. */
  pastedKeys: string[]
  services: ServiceSummary[]
  connectResult: ServiceConnectResult | null
  onChanged: (slug: string, summary: ServiceSummary | null) => void
}) {
  const t = useTranslations("services")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-5 overflow-y-auto rounded-3xl p-6 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <KeyRoundIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle dir="auto" className="text-base font-semibold tracking-tight">
              {service ? t("title", { name: service.name }) : t("titleKeys")}
            </DialogTitle>
            <DialogDescription dir="auto">{service ? service.purpose : t("descriptionKeys")}</DialogDescription>
          </div>
        </DialogHeader>

        {pastedKeys.length > 0 && (
          <PastedKeys projectId={projectId} keys={pastedKeys} services={services} onChanged={onChanged} />
        )}

        {service && (
          <ServiceForm
            key={service.slug}
            projectId={projectId}
            service={service}
            connectResult={connectResult}
            onChanged={onChanged}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ServiceForm({
  projectId,
  service,
  connectResult,
  onChanged,
  onClose,
}: {
  projectId: string
  service: ServiceSummary
  connectResult: ServiceConnectResult | null
  onChanged: (slug: string, summary: ServiceSummary | null) => void
  onClose: () => void
}) {
  const t = useTranslations("services")
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [replacing, setReplacing] = React.useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const redirectUri = React.useSyncExternalStore(
    noSubscription,
    () => oauthRedirectUri(window.location.origin),
    () => ""
  )

  const url = `/api/projects/${projectId}/services/${service.slug}`
  const typed = Object.fromEntries(
    Object.entries(values)
      .map(([name, value]) => [name, value.trim()] as const)
      .filter(([, value]) => value !== "")
  )
  const hasTyped = Object.keys(typed).length > 0
  const hasValues = service.fields.some((field) => field.set) || service.oauthConnected
  const statusKey = serviceStatusKey(service)
  const isOAuth = service.authKind === "oauth2"
  const canConnect = service.fields.every((field) => typed[field.name] !== undefined || (field.set && !replacing.has(field.name)))
  const steps = service.setupSteps.split("\n").map((line) => line.trim()).filter(Boolean)
  const notice = connectResult

  function setValue(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
  }

  function toggleReplace(name: string) {
    setValue(name, "")
    setReplacing((current) => {
      const next = new Set(current)
      if (!next.delete(name)) next.add(name)
      return next
    })
  }

  async function run(action: string, failure: "save" | "retest" | "remove", task: () => Promise<Outcome>) {
    setPending(action)
    setError(null)
    const outcome = await task()
    if (outcome.ok) {
      if (outcome.service) onChanged(service.slug, outcome.service)
      setValues({})
      setReplacing(new Set())
    } else {
      setError(outcome.message ?? t(`errors.${failure}`))
    }
    setPending(null)
    return outcome
  }

  const save = () => run("save", "save", () => putValues(projectId, service.slug, typed))

  const retest = () =>
    run("retest", "retest", () =>
      changeService(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retest" }),
      })
    )

  async function removeValues() {
    const outcome = await run("remove", "remove", () => changeService(`${url}?scope=values`, { method: "DELETE" }))
    if (outcome.ok) onChanged(service.slug, withoutValues(service))
  }

  async function removeFromApp() {
    const outcome = await run("removeApp", "remove", () => changeService(`${url}?scope=service`, { method: "DELETE" }))
    if (!outcome.ok) return
    onChanged(service.slug, null)
    onClose()
  }

  async function connect() {
    if (hasTyped) {
      const saved = await run("connect", "save", () => putValues(projectId, service.slug, typed))
      if (!saved.ok) return
    } else {
      setPending("connect")
    }
    window.location.assign(`${url}/oauth/start`)
  }

  async function copy() {
    await navigator.clipboard.writeText(redirectUri).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const busy = pending !== null
  const docsLink = /^https?:\/\//.test(service.docsUrl)

  return (
    <>
      {notice && (
        <p
          role="status"
          dir="auto"
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            notice === "connected" ? "bg-emerald-500/10 text-emerald-800" : "bg-destructive/10 text-destructive"
          )}
        >
          {t(`connectResult.${notice}`, { name: service.name })}
        </p>
      )}

      {(steps.length > 0 || isOAuth) && (
        <details open={statusKey === "missing"} className="group rounded-2xl border border-border/60 p-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium">
            <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:rotate-90" />
            {t("setup.title")}
          </summary>
          <div className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            {steps.map((line, index) => (
              <p key={index} dir="auto">
                {line}
              </p>
            ))}
            {isOAuth && (
              <div className="space-y-1.5 pt-1">
                <label htmlFor={`service-${service.slug}-redirect`} className="block font-medium text-foreground">
                  {t("setup.redirectLabel")}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={`service-${service.slug}-redirect`}
                    type="text"
                    dir="ltr"
                    readOnly
                    value={redirectUri}
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-border/60 bg-muted/40 px-2 font-mono text-xs text-foreground"
                  />
                  <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={copy}>
                    <CopyIcon />
                    {copied ? t("setup.copied") : t("setup.copy")}
                  </Button>
                </div>
                <p dir="auto">{t("setup.redirectHelp", { name: service.name })}</p>
              </div>
            )}
          </div>
        </details>
      )}

      <div className="space-y-3">
        {service.fields.map((field) => {
          const id = `service-${service.slug}-${field.name}`
          const locked = field.set && !replacing.has(field.name)
          return (
            <div key={field.name} className="space-y-1">
              <label htmlFor={id} dir="auto" className="block text-sm font-medium">
                {field.label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  type={field.kind === "secret" ? "password" : "text"}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={locked || busy}
                  value={locked ? "" : (values[field.name] ?? "")}
                  placeholder={field.set ? (field.hint ?? "") : ""}
                  onChange={(event) => setValue(field.name, event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 font-mono text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-violet-400 disabled:bg-muted/40"
                />
                {field.set && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="rounded-full"
                    onClick={() => toggleReplace(field.name)}
                  >
                    {replacing.has(field.name) ? t("field.keepCurrent") : t("field.replace")}
                  </Button>
                )}
              </div>
              {field.help && (
                <p dir="auto" className="text-xs leading-relaxed text-muted-foreground">
                  {field.help}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {service.allowedHosts.length > 0 && (
        <p dir="auto" className="text-xs leading-relaxed text-muted-foreground">
          {t("hosts", { hosts: service.allowedHosts.join(", ") })}
        </p>
      )}

      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-emerald-600" />
        {t("privacy")}
      </p>

      {!isOAuth && (
        <p dir="auto" className="text-xs leading-relaxed text-muted-foreground">
          {t.rich("budget", {
            name: service.name,
            link: (chunks) =>
              docsLink ? (
                <a href={service.docsUrl} target="_blank" rel="noreferrer" className="font-medium text-violet-700 hover:underline">
                  {chunks}
                </a>
              ) : (
                <span>{chunks}</span>
              ),
          })}
        </p>
      )}

      <StatusLine service={service} statusKey={statusKey} />

      {error && (
        <p role="alert" dir="auto" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isOAuth ? (
          <Button className="h-10 rounded-full" disabled={busy || !canConnect} onClick={connect}>
            {(pending === "connect") && <Loader2Icon className="animate-spin" />}
            {service.oauthConnected ? t("actions.reconnect") : t("actions.connect")}
          </Button>
        ) : (
          <Button className="h-10 rounded-full" disabled={busy || !hasTyped} onClick={save}>
            {pending === "save" && <Loader2Icon className="animate-spin" />}
            {t("actions.save")}
          </Button>
        )}
        {statusKey !== "missing" && (
          <Button variant="outline" className="h-10 rounded-full" disabled={busy} onClick={retest}>
            {pending === "retest" && <Loader2Icon className="animate-spin" />}
            {t("actions.retest")}
          </Button>
        )}
        <Button variant="ghost" className="ms-auto h-10 rounded-full text-muted-foreground" disabled={busy} onClick={onClose}>
          {statusKey === "connected" ? t("actions.close") : t("actions.skip")}
        </Button>
      </div>

      <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3">
        {hasValues && (
          <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" disabled={busy} onClick={removeValues}>
            {pending === "remove" && <Loader2Icon className="animate-spin" />}
            {t("actions.remove")}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="rounded-full text-destructive hover:text-destructive" disabled={busy} onClick={removeFromApp}>
          {pending === "removeApp" && <Loader2Icon className="animate-spin" />}
          {t("actions.removeFromApp")}
        </Button>
      </div>
    </>
  )
}

function StatusLine({ service, statusKey }: { service: ServiceSummary; statusKey: StatusKey }) {
  const t = useTranslations("services")
  const Icon = statusKey === "connected" ? CheckCircle2Icon : statusKey === "missing" ? CircleDashedIcon : TriangleAlertIcon
  return (
    <p
      role="status"
      dir="auto"
      className={cn(
        "flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium",
        statusKey === "connected" && "bg-emerald-500/10 text-emerald-800",
        statusKey === "rejected" && "bg-destructive/10 text-destructive",
        statusKey === "untested" && "bg-amber-500/10 text-amber-800",
        statusKey === "missing" && "bg-muted text-muted-foreground"
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      {t(`statusLine.${statusKey}`, { name: service.name })}
    </p>
  )
}

function PastedKeys({
  projectId,
  keys,
  services,
  onChanged,
}: {
  projectId: string
  keys: string[]
  services: ServiceSummary[]
  onChanged: (slug: string, summary: ServiceSummary | null) => void
}) {
  const t = useTranslations("services")
  const [saved, setSaved] = React.useState<ReadonlySet<number>>(new Set())
  const [choices, setChoices] = React.useState<Record<number, string>>({})
  const [pending, setPending] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const options = services.flatMap((service) =>
    service.fields
      .filter((field) => field.kind === "secret" && !field.set)
      .map((field) => ({ id: `${service.slug}/${field.name}`, service, field }))
  )

  async function save(index: number) {
    const option = options.find((o) => o.id === choices[index])
    if (!option) return
    setPending(index)
    setError(null)
    const outcome = await putValues(projectId, option.service.slug, { [option.field.name]: keys[index] })
    if (outcome.ok) {
      if (outcome.service) onChanged(option.service.slug, outcome.service)
      setSaved((current) => new Set(current).add(index))
    } else {
      setError(outcome.message ?? t("errors.save"))
    }
    setPending(null)
  }

  return (
    <section className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
      <div className="space-y-1">
        <h3 dir="auto" className="text-sm font-semibold">
          {t("pasted.title")}
        </h3>
        <p dir="auto" className="text-xs leading-relaxed text-muted-foreground">
          {options.length > 0 || saved.size > 0 ? t("pasted.intro") : t("pasted.none")}
        </p>
      </div>

      {(options.length > 0 || saved.size > 0) &&
        keys.map((_key, index) => {
          const id = `pasted-key-${index}`
          const done = saved.has(index)
          const current = options.find((o) => o.id === choices[index])?.id ?? ""
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <label htmlFor={id} className="text-xs font-medium">
                {t("pasted.keyLabel", { n: index + 1 })}
              </label>
              {done ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2Icon className="size-3.5" />
                  {t("pasted.saved")}
                </span>
              ) : (
                <>
                  <select
                    id={id}
                    dir="auto"
                    value={current}
                    onChange={(event) => setChoices((current) => ({ ...current, [index]: event.target.value }))}
                    disabled={pending !== null}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-white px-2 text-xs"
                  >
                    <option value="" disabled>
                      {t("pasted.choose")}
                    </option>
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {t("pasted.option", {
                          service: option.service.name,
                          field: option.field.label,
                          hosts: option.service.allowedHosts.join(", "),
                        })}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full"
                    disabled={pending !== null || current === ""}
                    onClick={() => save(index)}
                  >
                    {pending === index && <Loader2Icon className="animate-spin" />}
                    {t("pasted.save")}
                  </Button>
                </>
              )}
            </div>
          )
        })}

      {error && (
        <p role="alert" dir="auto" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
