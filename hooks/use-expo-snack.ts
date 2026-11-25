"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import type { Snack, SnackState } from "snack-sdk"

import type { AppPlan, ProjectScreen } from "@/lib/agent-protocol"
import type { ServerTarget } from "@/lib/generated-app/server-files"
import { SNACK_SDK_VERSION, snackProject } from "@/lib/generated-app/snack-project"

/** How long code waits before going to the phone, so several quick edits arrive as one. */
const CODE_CHANGES_DELAY_MS = 500

export type ExpoDevice = { id: string; name: string; platform: string; error: string | null }

export type ExpoSnackStatus =
  | { state: "idle" | "starting" }
  | { state: "ready"; url: string; devices: ExpoDevice[]; problem: string | null }
  | { state: "error"; message: string }

function readStatus(state: SnackState, dependencyFailed: (name: string, message: string) => string): ExpoSnackStatus {
  const problem = Object.entries(state.dependencies).find(([, dependency]) => dependency.error)
  return {
    state: "ready",
    url: state.url,
    devices: Object.entries(state.connectedClients).map(([id, client]) => ({
      id,
      name: client.name,
      platform: client.platform,
      error: client.error?.message ?? null,
    })),
    problem: problem ? dependencyFailed(problem[0], problem[1].error!.message) : null,
  }
}

/**
 * Keeps the app online as a Snack from this browser tab, once `enabled`. Every change to
 * the code goes straight to the phones connected to it, so it stays online until the tab closes.
 */
export function useExpoSnack(plan: AppPlan | null, screens: ProjectScreen[], enabled: boolean, server?: ServerTarget) {
  const [status, setStatus] = React.useState<ExpoSnackStatus>({ state: "idle" })
  const [attempt, setAttempt] = React.useState(0)
  const snackRef = React.useRef<Snack | null>(null)
  const sentFiles = React.useRef<Record<string, string>>({})

  // Read from inside the Snack's long-lived listeners, so a change of language doesn't restart it.
  const t = useTranslations("workspace.errors")
  const tRef = React.useRef(t)
  React.useEffect(() => {
    tRef.current = t
  })

  const project = React.useMemo(() => snackProject(plan, screens, server), [plan, screens, server])
  const hasProject = project !== null
  const latest = React.useRef(project)
  React.useEffect(() => {
    latest.current = project
  })

  React.useEffect(() => {
    if (!enabled || !hasProject) return
    let active = true
    let unsubscribe: (() => void) | undefined
    const dependencyFailed = (name: string, message: string) => tRef.current("dependencyFailed", { name, message })
    setStatus({ state: "starting" })

    void (async () => {
      try {
        const { Snack } = await import("snack-sdk")
        if (!active) return
        const { files, dependencies } = latest.current!
        const snack = new Snack({
          sdkVersion: SNACK_SDK_VERSION,
          name: "AppxPrompt preview",
          files,
          dependencies,
          codeChangesDelay: CODE_CHANGES_DELAY_MS,
        })
        snackRef.current = snack
        sentFiles.current = Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.contents]))
        snack.setOnline(true)

        unsubscribe = snack.addStateListener((state) => {
          // A package can need another that wasn't asked for, such as a peer dependency.
          const missing = Object.entries(state.missingDependencies)
          if (missing.length > 0) {
            snack.updateDependencies(Object.fromEntries(missing.map(([name, { wantedVersion }]) => [name, { version: wantedVersion ?? "*" }])))
          }
          if (state.url) setStatus(readStatus(state, dependencyFailed))
        })
        const state = await snack.getStateAsync()
        if (active) setStatus(readStatus(state, dependencyFailed))
      } catch (error) {
        if (active) setStatus({ state: "error", message: error instanceof Error ? error.message : tRef.current("previewFailed") })
      }
    })()

    return () => {
      active = false
      unsubscribe?.()
      snackRef.current?.setOnline(false)
      snackRef.current = null
    }
  }, [attempt, enabled, hasProject])

  // Sends what changed: inline edits, the agent's work, and theme switches all land here.
  React.useEffect(() => {
    const snack = snackRef.current
    if (!snack || !project) return
    const sent = sentFiles.current
    const removed = Object.keys(sent).filter((path) => !project.files[path])
    // A renewed sandbox token changes only `lib/server/config.ts`, so that is all that goes out.
    const changed = Object.entries(project.files).filter(([path, file]) => sent[path] !== file.contents)
    snack.updateFiles({ ...Object.fromEntries(changed), ...Object.fromEntries(removed.map((path) => [path, null])) })
    snack.updateDependencies(project.dependencies)
    sentFiles.current = Object.fromEntries(Object.entries(project.files).map(([path, file]) => [path, file.contents]))
  }, [project])

  return {
    status,
    hasProject,
    retry: React.useCallback(() => setAttempt((n) => n + 1), []),
  }
}
