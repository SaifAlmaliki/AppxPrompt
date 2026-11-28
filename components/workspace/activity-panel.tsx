"use client"

import * as React from "react"
import { useFormatter, useTranslations } from "next-intl"
import { ActivityIcon, RefreshCwIcon, WrenchIcon } from "lucide-react"

import type { ServerFailureContext } from "@/lib/agent-protocol"
import type { FetchDiagnostic } from "@/lib/sandbox/diagnostic"
import {
  canFixCall,
  describeFetch,
  failingFetch,
  serverCallResult,
  serverFailureOf,
  type ServerCallEntry,
} from "@/lib/server-routes/activity-protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const REFRESH_MS = 5000

/** Why a call failed, in plain words, and the hosts it reached. Only the owner's Activity tab ever loads this. */
function CallDetail({ call, failed }: { call: ServerCallEntry; failed: boolean }) {
  const t = useTranslations("preview.activity.detail")
  const detail = call.detail
  if (!detail) return null

  const line = (fetch: FetchDiagnostic) => {
    const { key, host, status } = describeFetch(fetch)
    return t(key, { host, status: status ?? 0 })
  }
  const problem = failed ? failingFetch(detail) : null
  const thrown = failed ? detail.thrown : undefined

  return (
    <>
      {problem && <p dir="auto" className="mt-1 break-words text-foreground">{line(problem)}</p>}
      {thrown && (
        <p dir="auto" className="mt-1 break-words text-foreground">
          {t("thrown", { name: thrown.name, message: thrown.message })}
        </p>
      )}
      {detail.fetches.length > 0 && (
        <details className="mt-1 text-muted-foreground">
          <summary className="cursor-pointer">{t("calls", { count: detail.fetches.length })}</summary>
          <ul className="mt-1 space-y-0.5">
            {detail.fetches.map((fetch, index) => (
              <li key={index} dir="auto" className="break-words">
                {t("timed", { line: line(fetch), count: fetch.ms })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

/** The plain reason a call failed, as the row words it: the failing outgoing call, what was thrown, or else the result itself. */
function useFailureReason() {
  const t = useTranslations("preview.activity")
  return (call: ServerCallEntry) => {
    const detail = call.detail
    const line = (fetch: FetchDiagnostic) => {
      const { key, host, status } = describeFetch(fetch)
      return t(`detail.${key}`, { host, status: status ?? 0 })
    }
    const problem = failingFetch(detail)
    const parts = [
      ...(problem ? [line(problem)] : []),
      ...(detail?.thrown ? [t("detail.thrown", { name: detail.thrown.name, message: detail.thrown.message })] : []),
    ]
    return parts.length > 0 ? parts.join("; ") : t(`results.${serverCallResult(call)}`, { status: call.status })
  }
}

/** The owner's view of their app's recent server function calls. Mounted only while its tab is open. */
export function ActivityPanel({
  projectId,
  onFix,
}: {
  projectId: string
  /** Asks the agent to fix a failed call. Left out when the agent can't take a message right now. */
  onFix?: (message: string, failure: ServerFailureContext) => void
}) {
  const t = useTranslations("preview.activity")
  const failureReason = useFailureReason()
  const format = useFormatter()
  const [calls, setCalls] = React.useState<ServerCallEntry[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    const response = await fetch(`/api/projects/${projectId}/activity`, { cache: "no-store" }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (response?.ok && Array.isArray(body?.calls)) {
      setCalls(body.calls)
      setFailed(false)
    } else {
      setFailed(true)
    }
    setLoading(false)
  }, [projectId])

  React.useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t("description")}</p>
        <Button variant="ghost" size="sm" className="shrink-0 rounded-full text-xs" onClick={() => void refresh()} disabled={loading}>
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
          {t("refresh")}
        </Button>
      </div>

      {failed && (
        <p role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">
          {t("loadFailed")}
        </p>
      )}

      {calls && calls.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <ActivityIcon className="size-5" />
          </span>
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="max-w-xs text-xs text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        calls && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t("time")}</TableHead>
                  <TableHead className="text-start">{t("function")}</TableHead>
                  <TableHead className="text-start">{t("result")}</TableHead>
                  <TableHead className="text-end">{t("duration")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => {
                  const result = serverCallResult(call)
                  return (
                    <TableRow key={call.id}>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                        {format.dateTime(new Date(call.createdAt), { timeStyle: "medium" })}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start font-mono text-xs break-all">
                        {call.method} {call.path}
                      </TableCell>
                      <TableCell className={cn("text-xs", result === "ok" ? "text-emerald-700" : "text-destructive")}>
                        {t(`results.${result}`, { status: call.status })}
                        {call.service && (
                          <span className="block text-muted-foreground">{t("service", { service: call.service })}</span>
                        )}
                        <CallDetail call={call} failed={result !== "ok"} />
                        {onFix && canFixCall(call) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-1.5 rounded-full text-xs"
                            onClick={() =>
                              onFix(t("fix.message", { function: call.path, reason: failureReason(call) }), serverFailureOf(call))
                            }
                          >
                            <WrenchIcon />
                            {t("fix.button")}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-end text-xs whitespace-nowrap text-muted-foreground">
                        {t("milliseconds", { count: call.durationMs })}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )
      )}
    </div>
  )
}
