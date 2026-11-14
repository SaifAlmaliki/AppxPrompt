"use client"

import { useTranslations } from "next-intl"

import { builtInThemeId, type AppTheme } from "@/lib/themes"

/** Names a theme for display: the built-in ones in the person's language, agent-made ones as they are. */
export function useThemeName() {
  const t = useTranslations("themes")
  return (theme: Pick<AppTheme, "id" | "name">) => {
    const id = builtInThemeId(theme)
    return id ? t(id) : theme.name
  }
}
