"use client"

import * as React from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Loader2Icon } from "lucide-react"

import type { AuthErrorKey } from "@/lib/auth-validation"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/home/logo"

const PROVIDER_ERRORS: Record<string, AuthErrorKey> = {
  access_denied: "cancelled",
  unsupported_provider: "unsupportedProvider",
}

/** A message key, or text the server gave for a problem that has no key. */
type CallbackError = { errorKey: AuthErrorKey; text?: undefined } | { text: string; errorKey?: undefined }

export default function AuthCallbackPage() {
  const t = useTranslations("auth")
  const [error, setError] = React.useState<CallbackError | null>(null)
  const started = React.useRef(false)

  React.useEffect(() => {
    if (started.current) return
    started.current = true

    // The token arrives in the fragment; read it, then wipe it from the address bar.
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const state = new URLSearchParams(window.location.search).get("state") ?? ""
    const token = hash.get("token")
    const providerError = hash.get("error")
    window.history.replaceState(null, "", window.location.pathname)

    if (!token) {
      setError({ errorKey: (providerError && PROVIDER_ERRORS[providerError]) || "incomplete" })
      return
    }

    fetch("/api/auth/social/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, state }),
    })
      .then(async (res) => {
        if (res.ok) {
          window.location.replace("/")
          return
        }
        const data = await res.json().catch(() => null)
        setError(
          typeof data?.errorKey === "string"
            ? { errorKey: data.errorKey as AuthErrorKey }
            : typeof data?.error === "string"
              ? { text: data.error }
              : { errorKey: "failed" }
        )
      })
      .catch(() => setError({ errorKey: "network" }))
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <Logo showText={false} className="size-10" />
      {error ? (
        <>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{t("callback.title")}</h1>
            <p role="alert" className="text-sm text-muted-foreground">
              {error.errorKey ? t(`errors.${error.errorKey}`) : error.text}
            </p>
          </div>
          <Button size="lg" className="h-10" nativeButton={false} render={<Link href="/" />}>
            {t("callback.back")}
          </Button>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {t("callback.signingIn")}
        </p>
      )}
    </main>
  )
}
