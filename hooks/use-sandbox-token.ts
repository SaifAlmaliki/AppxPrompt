"use client"

import * as React from "react"

import { sandboxTokenExpiry } from "@/lib/sandbox/token-expiry"

const RENEW_BEFORE_MS = 5 * 60 * 1000
const RETRY_MS = 30 * 1000

/** How long to wait before asking for a new token, given the expiry in epoch seconds. */
export function renewalDelay(expiresAtSeconds: number, nowMs: number) {
  return Math.max(0, expiresAtSeconds * 1000 - RENEW_BEFORE_MS - nowMs)
}

/**
 * The owner's sandbox token, renewed before it runs out and when the tab comes back
 * with little time left. Without a first token (a viewer, or integrations off) it stays null.
 */
export function useSandboxToken(projectId: string, initial: string | null): string | null {
  const [token, setToken] = React.useState(initial)
  const enabled = initial !== null

  React.useEffect(() => {
    if (!enabled) return
    let active = true
    let renewing = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let expiresAt = sandboxTokenExpiry(initial)

    const schedule = (delay: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => void renew(), delay)
    }

    async function renew() {
      if (renewing || !active) return
      renewing = true
      let retry = true
      try {
        const response = await fetch(`/api/projects/${projectId}/sandbox-token`, { method: "POST" })
        // Signed out, or not the owner any more: asking again won't change that.
        if (response.status === 401 || response.status === 404) retry = false
        const body = response.ok ? await response.json().catch(() => null) : null
        const next = typeof body?.token === "string" ? body.token : null
        const expiry = next ? (sandboxTokenExpiry(next) ?? (typeof body?.expiresAt === "number" ? body.expiresAt : null)) : null
        if (active && next && expiry) {
          expiresAt = expiry
          retry = false
          setToken(next)
          schedule(renewalDelay(expiry, Date.now()))
        }
      } catch {
        // Offline for now: try again shortly.
      } finally {
        renewing = false
      }
      if (active && retry) schedule(RETRY_MS)
    }

    if (expiresAt) schedule(renewalDelay(expiresAt, Date.now()))

    function onVisible() {
      if (document.visibilityState !== "visible") return
      if (expiresAt === null || expiresAt * 1000 - Date.now() < RENEW_BEFORE_MS) void renew()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      active = false
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [enabled, initial, projectId])

  return enabled ? token : null
}
