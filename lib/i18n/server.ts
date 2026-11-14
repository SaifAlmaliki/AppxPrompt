import { createTranslator } from "next-intl"
import { getTranslations } from "next-intl/server"
import { NextResponse } from "next/server"

import type { Locale } from "@/i18n/config"
import { formats } from "@/i18n/formats"
import { requestLocale } from "@/i18n/request"
import ar from "@/messages/ar.json"
import en from "@/messages/en.json"

const MESSAGES: Record<Locale, typeof en> = { en, ar }

export type Namespace = keyof typeof en
export type Translator<N extends Namespace> = Awaited<ReturnType<typeof getTranslations<N>>>
export type ErrorKey = keyof (typeof en)["errors"]
export type ErrorValues = Record<string, string | number>

/**
 * A translator that needs no request: for code that runs without a cookie (CloudHike
 * Jobs), for text the model reads (always English), and for tests.
 */
export function translatorFor<N extends Namespace>(locale: Locale, namespace: N): Translator<N> {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace, formats }) as unknown as Translator<N>
}

/** A translator in the requester's language, or in `locale`. Only for code that runs inside a request. */
export async function serverT<N extends Namespace>(namespace: N, locale?: Locale): Promise<Translator<N>> {
  return getTranslations({ locale: locale ?? (await requestLocale()), namespace }) as Promise<Translator<N>>
}

/** `errors.<key>`, for a key that's only known at run time. */
export function errorText(t: Translator<"errors">, key: ErrorKey, values?: ErrorValues) {
  return (t as unknown as (key: string, values?: ErrorValues) => string)(key, values)
}

let english: Translator<"errors"> | null = null

/**
 * A problem with a message the person can read. `message` is always English, which is
 * what logs and the model see. Whoever answers the browser words it with `translate`.
 */
export class LocalizedError extends Error {
  constructor(
    readonly key: ErrorKey,
    readonly values?: ErrorValues
  ) {
    super(errorText((english ??= translatorFor("en", "errors")), key, values))
  }

  translate(t: Translator<"errors">) {
    return errorText(t, this.key, this.values)
  }
}

/** `{ error }` for a JSON answer, in the requester's language. */
export async function errorResponse(key: ErrorKey, status: number, extra: Record<string, unknown> = {}, values?: ErrorValues) {
  return NextResponse.json({ error: errorText(await serverT("errors"), key, values), ...extra }, { status })
}
