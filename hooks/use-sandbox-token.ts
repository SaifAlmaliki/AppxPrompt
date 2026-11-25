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
 * The token to hold when the page hands over a new one. A page that renders again mints a fresh
 * token, which replaces the one held unless the one held (renewed meanwhile) outlasts it.
 */
export function heldToken(held: string | null, fromPage: string | null): string | null {
  if (fromPage === null) return null
  if (held === null) return fromPage
  const heldExpiry = sandboxTokenExpiry(held)
  const pageExpiry = sandboxTokenExpiry(fromPage)
  return heldExpiry !== null && (pageExpiry === null || heldExpiry > pageExpiry) ? held : fromPage
}

/** When to renew the held token: after this many ms, or null when it can't be read or there's none. */
export function renewalIn(held: string | null, nowMs: number) {
  const expiry = held === null ? null : sandboxTokenExpiry(held)
  return expiry === null ? null : renewalDelay(expiry, nowMs)
}

/**
 * The owner's sandbox token, renewed before it runs out and when the tab comes back
 * with little time left. Without a first token (a viewer, or integrations off) it stays null.
 */
export function useSandboxToken(projectId: string, initial: string | null): string | null {
  const [held, setHeld] = React.useState(initial)
  const token = heldToken(held, initial)

  // A newer token from the page replaces the held one, so renewal follows the token in use.
  React.useEffect(() => {
    setHeld((current) => heldToken(current, initial))
  }, [initial])

  const enabled = token !== null
  React.useEffect(() => {
    if (!enabled) return
    let active = true
    let renewing = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiresAt = sandboxTokenExpiry(token!)

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
        if (active && next && sandboxTokenExpiry(next) !== null) {
          retry = false
          // The held token changes, so this effect runs again and schedules from the new expiry.
          setHeld(next)
        }
      } catch {
        // Offline for now: try again shortly.
      } finally {
        renewing = false
      }
      if (active && retry) schedule(RETRY_MS)
    }

    const delay = renewalIn(token, Date.now())
    if (delay !== null) schedule(delay)

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
  }, [enabled, token, projectId])

  return token
}
