"use client"

import { useTranslations } from "next-intl"

import { ELEMENT_LABELS } from "@/lib/preview-protocol"

const LABEL_KEYS = {
  Container: "container",
  Screen: "screen",
  Gradient: "gradient",
  Text: "text",
  Image: "image",
  Button: "button",
  Input: "input",
  Switch: "switch",
  Icon: "icon",
} as const

type LabelKey = keyof typeof LABEL_KEYS

function isLabel(value: string): value is LabelKey {
  return Object.hasOwn(LABEL_KEYS, value)
}

/**
 * Names the kind of an element for display. It takes either an element's type (`Pressable`) or the
 * English label already sent to the agent (`Button`), and gives back the label in the person's language.
 */
export function useElementLabel() {
  const t = useTranslations("elements")
  return (typeOrLabel: string) => {
    const label = Object.hasOwn(ELEMENT_LABELS, typeOrLabel) ? ELEMENT_LABELS[typeOrLabel] : typeOrLabel
    return isLabel(label) ? t(LABEL_KEYS[label]) : label
  }
}
