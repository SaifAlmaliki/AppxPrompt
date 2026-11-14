"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"

import type { Locale } from "@/i18n/config"
import type { Activity, StatusKey, StatusValues } from "@/lib/agent-protocol"
import { activityText } from "@/lib/i18n/activity"

/** Words what the agent is doing in the interface language. */
export function useActivityText() {
  const t = useTranslations("status") as unknown as (key: StatusKey, values?: StatusValues) => string
  const locale = useLocale() as Locale
  return React.useCallback((activity: Activity) => activityText(t, activity, locale), [t, locale])
}
