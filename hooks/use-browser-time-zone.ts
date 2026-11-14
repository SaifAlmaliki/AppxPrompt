"use client"

import * as React from "react"

const subscribe = () => () => {}

export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * The browser's time zone, for dates from data loaded in the browser. It is `undefined` on the
 * server and during hydration, so nothing rendered there depends on the server's zone.
 */
export function useBrowserTimeZone(): string | undefined {
  return React.useSyncExternalStore(subscribe, browserTimeZone, () => undefined)
}
