"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpFromLineIcon,
  ArrowUpIcon,
  BoxIcon,
  CaseSensitiveIcon,
  CheckIcon,
  ImageIcon,
  LayersIcon,
  LayoutGridIcon,
  MousePointerClickIcon,
  MoveIcon,
  PaletteIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SmileIcon,
  SparklesIcon,
  SquareDashedIcon,
  ToggleRightIcon,
  TypeIcon,
  UploadIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { useElementLabel } from "@/hooks/use-element-label"
import type { InlineEditor } from "@/hooks/use-inline-editor"
import { ELEMENT_LABELS, type ElementStyleValue } from "@/lib/preview-protocol"
import { THEME_TOKENS, themeCssVariable, type AppTheme, type ThemeToken } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const ELEMENT_ICONS: Record<string, LucideIcon> = {
  Container: BoxIcon,
  Screen: LayoutGridIcon,
  Gradient: PaletteIcon,
  Text: TypeIcon,
  Image: ImageIcon,
  Button: MousePointerClickIcon,
  Input: TypeIcon,
  Switch: ToggleRightIcon,
  Icon: SmileIcon,
}

type Messages = typeof import("@/messages/en.json")
type FieldId = keyof Messages["elementEditor"]["fields"]
type OptionId = keyof Messages["elementEditor"]["options"]
type CategoryId = keyof Messages["elementEditor"]["categories"]

type Option = { value: string; label: OptionId; icon?: LucideIcon }

type Field =
  | { kind: "number"; id: FieldId; css: string; style: string[]; unit?: string; min?: number; max?: number; step?: number; advanced?: boolean }
  | { kind: "color"; id: FieldId; css: string; style?: string; prop?: string; advanced?: boolean }
  | { kind: "options"; id: FieldId; css: string; style: string; options: Option[]; advanced?: boolean }
  | { kind: "opacity"; id: FieldId; advanced?: boolean }
  | { kind: "shadow"; id: FieldId; advanced?: boolean }
  | { kind: "text"; id: FieldId; advanced?: boolean }
  | { kind: "prop"; id: FieldId; prop: "name" | "placeholder" | "uri"; hint?: "icon"; advanced?: boolean }
  | { kind: "icon-size"; id: FieldId; advanced?: boolean }
  | { kind: "prop-options"; id: FieldId; prop: "resizeMode"; options: Option[]; advanced?: boolean }
  | { kind: "image"; id: FieldId; advanced?: boolean }

type Category = { id: CategoryId; icon: LucideIcon; fields: Field[] }

const number = (id: FieldId, css: string, style: string | string[], extra?: Partial<Extract<Field, { kind: "number" }>>): Field => ({
  kind: "number",
  id,
  css,
  style: Array.isArray(style) ? style : [style],
  min: 0,
  ...extra,
})

const WEIGHTS: Option[] = [
  { value: "400", label: "regular" },
  { value: "500", label: "medium" },
  { value: "600", label: "semibold" },
  { value: "700", label: "bold" },
  { value: "800", label: "heavy" },
]

const JUSTIFY: Option[] = [
  { value: "flex-start", label: "start" },
  { value: "center", label: "center" },
  { value: "flex-end", label: "end" },
  { value: "space-between", label: "between" },
]

const ALIGN: Option[] = [
  { value: "flex-start", label: "start" },
  { value: "center", label: "center" },
  { value: "flex-end", label: "end" },
  { value: "stretch", label: "stretch" },
]

// Each side is set on its own, since on a phone `paddingTop` beats `padding` whatever the order.
const CATEGORIES: Category[] = [
  {
    id: "content",
    icon: TypeIcon,
    fields: [
      { kind: "text", id: "text" },
      { kind: "prop", id: "placeholder", prop: "placeholder" },
      { kind: "prop", id: "icon", prop: "name", hint: "icon" },
      { kind: "icon-size", id: "iconSize" },
      { kind: "image", id: "image" },
      {
        kind: "prop-options",
        id: "resizeMode",
        prop: "resizeMode",
        options: [
          { value: "cover", label: "cover" },
          { value: "contain", label: "contain" },
          { value: "stretch", label: "stretch" },
        ],
      },
    ],
  },
  {
    id: "colors",
    icon: PaletteIcon,
    fields: [
      { kind: "color", id: "color", css: "color", style: "color" },
      { kind: "color", id: "iconColor", css: "color", prop: "color" },
      { kind: "color", id: "background", css: "background-color", style: "backgroundColor" },
    ],
  },
  {
    id: "typography",
    icon: CaseSensitiveIcon,
    fields: [
      number("fontSize", "font-size", "fontSize", { min: 1 }),
      { kind: "options", id: "fontWeight", css: "font-weight", style: "fontWeight", options: WEIGHTS },
      {
        kind: "options",
        id: "textAlign",
        css: "text-align",
        style: "textAlign",
        options: [
          { value: "left", label: "left", icon: AlignLeftIcon },
          { value: "center", label: "center", icon: AlignCenterIcon },
          { value: "right", label: "right", icon: AlignRightIcon },
          { value: "justify", label: "justify", icon: AlignJustifyIcon },
        ],
      },
      number("lineHeight", "line-height", "lineHeight", { min: 1 }),
      number("letterSpacing", "letter-spacing", "letterSpacing", { min: -5, step: 0.1 }),
      {
        kind: "options",
        id: "fontStyle",
        css: "font-style",
        style: "fontStyle",
        advanced: true,
        options: [
          { value: "normal", label: "normal" },
          { value: "italic", label: "italic" },
        ],
      },
      {
        kind: "options",
        id: "textTransform",
        css: "text-transform",
        style: "textTransform",
        advanced: true,
        options: [
          { value: "none", label: "none" },
          { value: "uppercase", label: "upper" },
          { value: "lowercase", label: "lower" },
          { value: "capitalize", label: "capitalize" },
        ],
      },
      {
        kind: "options",
        id: "textDecorationLine",
        css: "text-decoration-line",
        style: "textDecorationLine",
        advanced: true,
        options: [
          { value: "none", label: "none" },
          { value: "underline", label: "underline" },
          { value: "line-through", label: "strike" },
        ],
      },
    ],
  },
  {
    id: "spacing",
    icon: MoveIcon,
    fields: [
      number("paddingX", "padding-left", ["paddingLeft", "paddingRight"]),
      number("paddingY", "padding-top", ["paddingTop", "paddingBottom"]),
      number("marginX", "margin-left", ["marginLeft", "marginRight"], { min: -200 }),
      number("marginY", "margin-top", ["marginTop", "marginBottom"], { min: -200 }),
      number("gap", "row-gap", "gap"),
      number("paddingTop", "padding-top", "paddingTop", { advanced: true }),
      number("paddingRight", "padding-right", "paddingRight", { advanced: true }),
      number("paddingBottom", "padding-bottom", "paddingBottom", { advanced: true }),
      number("paddingLeft", "padding-left", "paddingLeft", { advanced: true }),
      number("marginTop", "margin-top", "marginTop", { min: -200, advanced: true }),
      number("marginRight", "margin-right", "marginRight", { min: -200, advanced: true }),
      number("marginBottom", "margin-bottom", "marginBottom", { min: -200, advanced: true }),
      number("marginLeft", "margin-left", "marginLeft", { min: -200, advanced: true }),
    ],
  },
  {
    id: "layout",
    icon: LayoutGridIcon,
    fields: [
      {
        kind: "options",
        id: "flexDirection",
        css: "flex-direction",
        style: "flexDirection",
        options: [
          { value: "column", label: "column", icon: ArrowDownIcon },
          { value: "row", label: "row", icon: ArrowRightIcon },
        ],
      },
      { kind: "options", id: "justifyContent", css: "justify-content", style: "justifyContent", options: JUSTIFY },
      { kind: "options", id: "alignItems", css: "align-items", style: "alignItems", options: ALIGN },
      number("width", "width", "width"),
      number("height", "height", "height"),
      number("minWidth", "min-width", "minWidth", { advanced: true }),
      number("minHeight", "min-height", "minHeight", { advanced: true }),
      number("maxWidth", "max-width", "maxWidth", { advanced: true }),
      number("maxHeight", "max-height", "maxHeight", { advanced: true }),
      number("flexGrow", "flex-grow", "flexGrow", { advanced: true }),
      { kind: "options", id: "alignSelf", css: "align-self", style: "alignSelf", advanced: true, options: [{ value: "auto", label: "auto" }, ...ALIGN] },
      {
        kind: "options",
        id: "flexWrap",
        css: "flex-wrap",
        style: "flexWrap",
        advanced: true,
        options: [
          { value: "nowrap", label: "noWrap" },
          { value: "wrap", label: "wrap" },
        ],
      },
      {
        kind: "options",
        id: "overflow",
        css: "overflow",
        style: "overflow",
        advanced: true,
        options: [
          { value: "visible", label: "visible" },
          { value: "hidden", label: "hidden" },
        ],
      },
    ],
  },
  {
    id: "border",
    icon: SquareDashedIcon,
    fields: [
      number("borderWidth", "border-top-width", "borderWidth"),
      { kind: "color", id: "borderColor", css: "border-top-color", style: "borderColor" },
      number("borderRadius", "border-top-left-radius", "borderRadius"),
    ],
  },
  {
    id: "effects",
    icon: LayersIcon,
    fields: [
      { kind: "opacity", id: "opacity" },
      { kind: "shadow", id: "shadow" },
    ],
  },
]

/** Which fields make sense for each kind of element. */
const FIELDS_BY_LABEL: Record<string, string[] | "box"> = {
  Text: ["text", "color", "background", "fontSize", "fontWeight", "textAlign", "lineHeight", "letterSpacing", "fontStyle", "textTransform", "textDecorationLine", "paddingX", "paddingY", "marginX", "marginY", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "alignSelf", "maxWidth", "borderWidth", "borderColor", "borderRadius", "opacity"],
  Input: ["placeholder", "color", "background", "fontSize", "fontWeight", "textAlign", "paddingX", "paddingY", "marginX", "marginY", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "width", "height", "minHeight", "borderWidth", "borderColor", "borderRadius", "opacity", "shadow"],
  Icon: ["icon", "iconSize", "iconColor", "background", "paddingX", "paddingY", "marginX", "marginY", "marginTop", "marginRight", "marginBottom", "marginLeft", "borderRadius", "opacity"],
  Image: ["image", "resizeMode", "marginX", "marginY", "marginTop", "marginRight", "marginBottom", "marginLeft", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "alignSelf", "borderWidth", "borderColor", "borderRadius", "opacity", "shadow"],
  Switch: ["marginX", "marginY", "marginTop", "marginRight", "marginBottom", "marginLeft", "alignSelf", "opacity"],
  Gradient: ["paddingX", "paddingY", "marginX", "marginY", "gap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "flexDirection", "justifyContent", "alignItems", "width", "height", "minHeight", "borderRadius", "opacity"],
  Container: "box",
  Button: "box",
  Screen: "box",
}

const BOX_EXCLUDED = new Set(["text", "placeholder", "icon", "iconSize", "image", "resizeMode", "color", "iconColor", "fontSize", "fontWeight", "textAlign", "lineHeight", "letterSpacing", "fontStyle", "textTransform", "textDecorationLine"])

function categoriesFor(label: string, advanced: boolean): Category[] {
  const allowed = FIELDS_BY_LABEL[label] ?? "box"
  const keeps = (field: Field) => (allowed === "box" ? !BOX_EXCLUDED.has(field.id) : allowed.includes(field.id))
  // The advanced view has each side on its own, so it leaves out the fields that set a pair.
  const pair = new Set(["paddingX", "paddingY", "marginX", "marginY"])
  return CATEGORIES.map((category) => ({
    ...category,
    fields: category.fields.filter((field) => keeps(field) && (advanced ? !pair.has(field.id) : !field.advanced)),
  })).filter((category) => category.fields.length > 0)
}

const SHADOWS: { value: string; label: OptionId; radius: number; offset: number; opacity: number; elevation: number }[] = [
  { value: "none", label: "none", radius: 0, offset: 0, opacity: 0, elevation: 0 },
  { value: "soft", label: "soft", radius: 8, offset: 2, opacity: 0.12, elevation: 2 },
  { value: "medium", label: "medium", radius: 16, offset: 6, opacity: 0.18, elevation: 6 },
  { value: "strong", label: "strong", radius: 28, offset: 12, opacity: 0.26, elevation: 12 },
]

function parsePixels(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "")
  return Number.isFinite(parsed) ? parsed : null
}

function toHex(color: string | undefined) {
  if (!color) return null
  if (color.startsWith("#")) return color.toLowerCase().slice(0, 7)
  const match = color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[,/ ]+([\d.]+))?/)
  if (!match) return null
  if (match[4] !== undefined && Number(match[4]) === 0) return null
  return `#${[match[1], match[2], match[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`
}

const SWATCH_TOKENS = THEME_TOKENS.filter((token) => token !== "overlay" && token !== "shadow")

/** The element's fields, in the popover and in the advanced panel. */
function useEditorValues(editor: InlineEditor) {
  const { selection, selectedEdit } = editor
  return React.useMemo(() => {
    const computed = selection?.computed ?? {}
    return {
      styleValue(name: string, css: string): ElementStyleValue | undefined {
        return selectedEdit?.style?.[name] ?? computed[css]
      },
      propValue(name: string) {
        return selectedEdit?.props?.[name]
      },
      computed,
    }
  }, [selection?.computed, selectedEdit])
}

function FieldRow({ label, stacked, children }: { label: string; stacked?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("gap-2", stacked ? "flex flex-col gap-1.5" : "flex min-h-8 items-center justify-between")}>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

const inputClass =
  "h-8 min-w-0 rounded-lg border border-border/70 bg-white px-2 text-xs outline-none transition-colors focus-visible:border-violet-400 focus-visible:ring-2 focus-visible:ring-violet-400/25 disabled:opacity-60"

function NumberField({
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  value: number | null
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const t = useTranslations("elementEditor")
  // What's typed stays as typed, so "1." isn't turned into "1" mid-number.
  const [draft, setDraft] = React.useState<string | null>(null)
  const shown = draft ?? (value === null ? "" : String(Math.round(value * 100) / 100))
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        value={shown}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={t("options.auto")}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.target.value)
          const parsed = Number.parseFloat(event.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
        onBlur={() => setDraft(null)}
        className={cn(inputClass, "w-16 text-end tabular-nums")}
      />
    </div>
  )
}

function OptionsField({
  value,
  options,
  disabled,
  label,
  onChange,
}: {
  value: string
  options: Option[]
  disabled?: boolean
  label: string
  onChange: (value: string) => void
}) {
  const t = useTranslations("elementEditor.options")
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-0.5 rounded-lg bg-muted/70 p-0.5">
      {options.map(({ value: option, label: id, icon: Icon }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={t(id)}
          title={t(id)}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60",
            value === option && "bg-white text-violet-700 shadow-xs"
          )}
        >
          {Icon ? <Icon className="size-3.5" /> : t(id)}
        </button>
      ))}
    </div>
  )
}

function ColorField({
  label,
  value,
  theme,
  disabled,
  onChange,
}: {
  label: string
  /** The current color: a token's CSS variable, a hex value, or a computed color. */
  value: ElementStyleValue | undefined
  theme: AppTheme | null
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const t = useTranslations("elementEditor")
  const [open, setOpen] = React.useState(false)
  const raw = typeof value === "string" ? value : undefined
  const colors = theme?.colors
  const hex = React.useMemo(() => {
    if (!raw) return null
    const variable = SWATCH_TOKENS.find((token) => `var(${themeCssVariable(token)})` === raw)
    return variable && colors ? colors[variable].toLowerCase() : toHex(raw)
  }, [colors, raw])
  const activeToken: ThemeToken | undefined =
    SWATCH_TOKENS.find((token) => `var(${themeCssVariable(token)})` === raw) ??
    SWATCH_TOKENS.find((token) => hex !== null && colors?.[token].toLowerCase() === hex)
  const name = activeToken ? t(`tokens.${activeToken}`) : (hex?.toUpperCase() ?? t("colorPicker.none"))

  return (
    <div className="space-y-2">
      <FieldRow label={label}>
        <button
          type="button"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className={cn(inputClass, "flex items-center gap-1.5 hover:border-violet-300")}
        >
          <span
            className="size-4 shrink-0 rounded-[5px] border border-black/10"
            style={{
              background: hex ?? "repeating-conic-gradient(#e5e5e5 0 25%, #fff 0 50%) 0 0 / 8px 8px",
            }}
          />
          <span className="max-w-24 truncate">{name}</span>
        </button>
      </FieldRow>
      {open && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-neutral-50/70 p-2">
          <p className="text-[11px] font-medium text-muted-foreground">{t("colorPicker.themeColors")}</p>
          <div className="grid grid-cols-8 gap-1">
            {SWATCH_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                title={t(`tokens.${token}`)}
                aria-label={t(`tokens.${token}`)}
                aria-pressed={token === activeToken}
                onClick={() => onChange(`var(${themeCssVariable(token)})`)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-md border border-black/10 transition-transform hover:scale-110",
                  token === activeToken && "ring-2 ring-violet-500 ring-offset-1"
                )}
                style={{ background: colors?.[token] ?? `var(${themeCssVariable(token)})` }}
              >
                {token === activeToken && <CheckIcon className="size-3 text-white mix-blend-difference" />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              aria-label={t("colorPicker.custom", { label: label.toLowerCase() })}
              value={hex ?? "#000000"}
              onChange={(event) => onChange(event.target.value)}
              className="size-8 shrink-0 cursor-pointer rounded-lg border border-border/70 bg-white p-0.5"
            />
            <HexInput key={hex ?? "none"} value={hex ?? ""} onChange={onChange} />
            <button
              type="button"
              onClick={() => onChange("transparent")}
              className={cn(inputClass, "shrink-0 text-muted-foreground hover:border-violet-300 hover:text-violet-700")}
            >
              {t("colorPicker.none")}
            </button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">{t("colorPicker.note")}</p>
        </div>
      )}
    </div>
  )
}

function HexInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("elementEditor.colorPicker")
  const [draft, setDraft] = React.useState(value)
  return (
    <input
      value={draft}
      dir="ltr"
      spellCheck={false}
      placeholder="#000000"
      aria-label={t("hex")}
      onChange={(event) => {
        setDraft(event.target.value)
        if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(event.target.value)
      }}
      className={cn(inputClass, "w-full flex-1 font-mono")}
    />
  )
}

const IMAGE_URL_FIELD: Field = { kind: "prop", id: "uri", prop: "uri" }

type ImageTool = "replace" | "generate" | "transform"

const IMAGE_TOOLS: { id: ImageTool; icon: LucideIcon }[] = [
  { id: "replace", icon: UploadIcon },
  { id: "generate", icon: SparklesIcon },
  { id: "transform", icon: WandSparklesIcon },
]

function ImagePromptForm({
  label,
  placeholder,
  submitLabel,
  busy,
  disabled,
  onSubmit,
}: {
  label: string
  placeholder: string
  submitLabel: string
  busy: boolean
  disabled: boolean
  onSubmit: (prompt: string) => Promise<boolean>
}) {
  const [prompt, setPrompt] = React.useState("")

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const content = prompt.trim()
    if (!content || busy || disabled) return
    if (await onSubmit(content)) setPrompt("")
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        autoFocus
        dir="auto"
        aria-label={label}
        value={prompt}
        rows={3}
        maxLength={500}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        className={cn(inputClass, "h-auto w-full resize-none py-1.5 leading-relaxed")}
      />
      <Button
        type="submit"
        disabled={!prompt.trim() || busy || disabled}
        className="h-8 w-full rounded-full bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-xs text-white shadow-md shadow-violet-500/25 hover:opacity-95 disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
      >
        {busy ? <Spinner className="text-current" /> : <SparklesIcon />}
        {submitLabel}
      </Button>
    </form>
  )
}

/** Replacing an image, or getting a new one from the AI. */
function ImageField({
  editor,
  values,
  theme,
  disabled,
}: {
  editor: InlineEditor
  values: ReturnType<typeof useEditorValues>
  theme: AppTheme | null
  disabled: boolean
}) {
  const t = useTranslations("elementEditor")
  const { selection, selectedImageUri: uri, selectedImageJob: job, selectedImageError: imageError, changeImage } = editor
  const [tool, setTool] = React.useState<ImageTool | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const busy = Boolean(job)

  if (selection?.info && uri === undefined) {
    return (
      <FieldRow label={t("fields.image")} stacked>
        <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-xs leading-snug text-muted-foreground">
          {t("image.fromData")}
        </p>
      </FieldRow>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-border/60 bg-muted/60">
        {/* eslint-disable-next-line @next/next/no-img-element -- Any url can be typed here, so it can't go through next/image. */}
        {uri && <img src={uri} alt={t("image.current")} className="size-full object-cover" />}
        {job && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[2px]">
            <Spinner className="size-5 text-violet-600" />
          </div>
        )}
      </div>
      {job && (
        <p role="status" className="rounded-lg bg-violet-500/8 px-2.5 py-1.5 text-[11px] leading-snug text-violet-800">
          {t(`image.progress.${job}`)}
        </p>
      )}
      {imageError && (
        <p role="alert" dir="auto" className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] leading-snug text-red-800">
          {imageError}
        </p>
      )}
      <div className="space-y-1">
        {IMAGE_TOOLS.map(({ id, icon: Icon }) => (
          <div key={id}>
            <button
              type="button"
              aria-expanded={tool === id}
              disabled={disabled || !selection?.info || (id === "transform" && !uri)}
              onClick={() => setTool((open) => (open === id ? null : id))}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-lg border border-border/70 bg-white px-2.5 text-xs font-medium transition-colors hover:border-violet-300 hover:text-violet-700 disabled:opacity-60",
                tool === id && "border-violet-300 bg-violet-500/5 text-violet-700"
              )}
            >
              <Icon className="size-3.5 shrink-0 text-violet-600" />
              {t(`image.tools.${id}`)}
            </button>
            {tool === id && (
              <div className="mt-1 mb-2 space-y-2 rounded-xl border border-border/60 bg-neutral-50/70 p-2">
                {id === "replace" && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      aria-label={t("image.chooseFile")}
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ""
                        if (file) void changeImage({ action: "upload", file })
                      }}
                    />
                    <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()} className="h-8 w-full rounded-full text-xs">
                      {job === "upload" ? <Spinner /> : <UploadIcon />}
                      {t("image.upload")}
                    </Button>
                    <ElementField field={IMAGE_URL_FIELD} editor={editor} values={values} theme={theme} disabled={disabled || busy} />
                  </>
                )}
                {id === "generate" && (
                  <ImagePromptForm
                    label={t("image.describeGenerate")}
                    placeholder={t("image.generatePlaceholder")}
                    submitLabel={t("image.generate")}
                    busy={busy}
                    disabled={disabled}
                    onSubmit={(prompt) => changeImage({ action: "generate", prompt })}
                  />
                )}
                {id === "transform" && (
                  <ImagePromptForm
                    label={t("image.describeTransform")}
                    placeholder={t("image.transformPlaceholder")}
                    submitLabel={t("image.apply")}
                    busy={busy}
                    disabled={disabled}
                    onSubmit={(prompt) => changeImage({ action: "transform", prompt })}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ElementField({
  field,
  editor,
  values,
  theme,
  disabled,
}: {
  field: Field
  editor: InlineEditor
  values: ReturnType<typeof useEditorValues>
  theme: AppTheme | null
  disabled: boolean
}) {
  const t = useTranslations("elementEditor")
  const { selection, updateSelected, selectedEdit } = editor
  const info = selection?.info
  const label = t(`fields.${field.id}`)

  switch (field.kind) {
    case "image":
      if (!editor.imageTools) return <ElementField field={IMAGE_URL_FIELD} editor={editor} values={values} theme={theme} disabled={disabled} />
      return <ImageField key={selection?.source} editor={editor} values={values} theme={theme} disabled={disabled} />
    case "number": {
      const value = values.styleValue(field.style[0], field.css)
      return (
        <FieldRow label={label}>
          <NumberField
            value={typeof value === "number" ? value : parsePixels(value as string | undefined)}
            min={field.min}
            max={field.max}
            step={field.step}
            disabled={disabled}
            onChange={(next) => updateSelected({ style: Object.fromEntries(field.style.map((name) => [name, next])) })}
          />
        </FieldRow>
      )
    }
    case "color": {
      const edited = field.prop ? (values.propValue(field.prop) as string | undefined) : selectedEdit?.style?.[field.style!]
      return (
        <ColorField
          label={label}
          value={edited ?? values.computed[field.css]}
          theme={theme}
          disabled={disabled}
          onChange={(next) => updateSelected(field.prop ? { props: { [field.prop]: next } } : { style: { [field.style!]: next } })}
        />
      )
    }
    case "options":
      return (
        <FieldRow label={label} stacked={field.options.length > 3}>
          <OptionsField
            label={label}
            value={String(values.styleValue(field.style, field.css) ?? "")}
            options={field.options}
            disabled={disabled}
            onChange={(next) => updateSelected({ style: { [field.style]: next } })}
          />
        </FieldRow>
      )
    case "opacity": {
      const raw = values.styleValue("opacity", "opacity")
      const value = typeof raw === "number" ? raw : (parsePixels(raw as string | undefined) ?? 1)
      return (
        <FieldRow label={label}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              aria-label={label}
              min={0}
              max={1}
              step={0.01}
              value={value}
              disabled={disabled}
              onChange={(event) => updateSelected({ style: { opacity: Number(event.target.value) } })}
              className="h-1.5 w-28 cursor-pointer accent-violet-600"
            />
            <span className="w-8 text-end text-xs tabular-nums text-muted-foreground">{Math.round(value * 100)}%</span>
          </div>
        </FieldRow>
      )
    }
    case "shadow": {
      const opacity = selectedEdit?.style?.shadowOpacity
      const current = SHADOWS.find((shadow) => shadow.opacity === opacity)?.value ?? (values.computed["box-shadow"] === "none" ? "none" : "")
      return (
        <FieldRow label={label} stacked>
          <OptionsField
            label={label}
            value={current}
            options={SHADOWS.map(({ value, label: id }) => ({ value, label: id }))}
            disabled={disabled}
            onChange={(next) => {
              const shadow = SHADOWS.find((s) => s.value === next)!
              updateSelected({
                style: {
                  shadowColor: `var(${themeCssVariable("shadow")})`,
                  shadowOffset: { width: 0, height: shadow.offset },
                  shadowOpacity: shadow.opacity,
                  shadowRadius: shadow.radius,
                  elevation: shadow.elevation,
                },
              })
            }}
          />
        </FieldRow>
      )
    }
    case "text": {
      const text = selectedEdit?.text ?? info?.text
      if (info && text === null) {
        return (
          <FieldRow label={label} stacked>
            <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-xs leading-snug text-muted-foreground">
              {selection?.label
                ? t.rich("text.fromDataNamed", { label: selection.label, bdi: (chunks) => <bdi>{chunks}</bdi> })
                : t("text.fromData")}
            </p>
          </FieldRow>
        )
      }
      return (
        <FieldRow label={label} stacked>
          <textarea
            dir="auto"
            aria-label={label}
            value={text ?? ""}
            rows={Math.min(5, Math.ceil((text ?? "").length / 34) || 1)}
            disabled={disabled || !info}
            onChange={(event) => updateSelected({ text: event.target.value })}
            className={cn(inputClass, "h-auto min-h-8 resize-none py-1.5 leading-relaxed")}
          />
        </FieldRow>
      )
    }
    case "prop": {
      const edited = field.prop === "uri" ? (values.propValue("source") as { uri?: string } | undefined)?.uri : (values.propValue(field.prop) as string | undefined)
      const written = field.prop === "uri" ? info?.imageUri : field.prop === "name" ? info?.iconName : info?.placeholder
      const value = edited ?? written
      const dynamic = info && value === undefined && field.prop !== "placeholder"
      if (dynamic) {
        return (
          <FieldRow label={label} stacked>
            <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-xs leading-snug text-muted-foreground">
              {t("image.fromData")}
            </p>
          </FieldRow>
        )
      }
      return (
        <FieldRow label={label} stacked>
          <input
            dir={field.prop === "uri" ? "ltr" : "auto"}
            aria-label={label}
            value={value ?? ""}
            spellCheck={false}
            placeholder={field.hint ? t(`hints.${field.hint}`) : undefined}
            disabled={disabled || !info}
            onChange={(event) =>
              updateSelected({ props: field.prop === "uri" ? { source: { uri: event.target.value } } : { [field.prop]: event.target.value } })
            }
            className={inputClass}
          />
        </FieldRow>
      )
    }
    case "icon-size": {
      const edited = values.propValue("size") as number | undefined
      return (
        <FieldRow label={label}>
          <NumberField
            value={edited ?? info?.iconSize ?? selection?.rect.width ?? null}
            min={1}
            disabled={disabled}
            onChange={(next) => updateSelected({ props: { size: next } })}
          />
        </FieldRow>
      )
    }
    case "prop-options":
      return (
        <FieldRow label={label}>
          <OptionsField
            label={label}
            value={String(values.propValue(field.prop) ?? info?.resizeMode ?? "cover")}
            options={field.options}
            disabled={disabled}
            onChange={(next) => updateSelected({ props: { [field.prop]: next } })}
          />
        </FieldRow>
      )
  }
}

function HeaderAction({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="rounded-full text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700 aria-pressed:bg-violet-500/10 aria-pressed:text-violet-700"
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function EditorHeader({ editor, screenName }: { editor: InlineEditor; screenName: string }) {
  const t = useTranslations("elementEditor.header")
  const elementLabel = useElementLabel()
  const { selection, selectedEdit, advanced } = editor
  if (!selection) return null
  const Icon = ELEMENT_ICONS[ELEMENT_LABELS[selection.type] ?? selection.type] ?? BoxIcon
  const sharedName = selection.file.startsWith("components/") ? selection.file.replace(/^components\/|\.tsx$/g, "") : null
  return (
    <div className="flex items-center gap-2 border-b border-border/60 py-2 pe-1.5 ps-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-700">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-tight font-semibold">{elementLabel(selection.type)}</p>
        <p dir={sharedName ? "ltr" : "auto"} className="truncate text-[11px] leading-tight text-muted-foreground">{sharedName ?? screenName}</p>
      </div>
      <div className="flex shrink-0 items-center">
        <HeaderAction label={t("selectParent")} disabled={!selection.hasParent} onClick={editor.selectParent}>
          <ArrowUpFromLineIcon />
        </HeaderAction>
        <HeaderAction label={t("undo")} disabled={!selectedEdit} onClick={editor.resetSelected}>
          <RotateCcwIcon />
        </HeaderAction>
        <HeaderAction label={advanced ? t("quickEdit") : t("advancedEdit")} aria-pressed={advanced} onClick={() => editor.setAdvanced(!advanced)}>
          <SlidersHorizontalIcon />
        </HeaderAction>
        <HeaderAction label={t("close")} onClick={editor.clearSelection}>
          <XIcon />
        </HeaderAction>
      </div>
    </div>
  )
}

/** Why edits to this element work the way they do, when that isn't obvious. */
function EditorNotes({ editor }: { editor: InlineEditor }) {
  const t = useTranslations("elementEditor.notes")
  const { selection, saveError } = editor
  if (!selection) return null
  const readOnly = !selection.saveable || selection.info?.editable === false
  const shared = selection.file.startsWith("components/")
  const notes = [
    readOnly && t("readOnly"),
    !readOnly && shared && t("shared"),
    !readOnly && !shared && selection.instances > 1 && t("repeats", { count: selection.instances }),
  ].filter(Boolean)
  if (notes.length === 0 && !saveError) return null
  return (
    <div className="space-y-1.5 px-3 pt-2.5">
      {notes.map((note) => (
        <p key={String(note)} className="rounded-lg bg-violet-500/8 px-2.5 py-1.5 text-[11px] leading-snug text-violet-800">
          {note}
        </p>
      ))}
      {saveError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] leading-snug text-red-800">
          <p dir="auto" className="min-w-0 flex-1">{saveError}</p>
          <button type="button" onClick={() => void editor.retrySave()} className="shrink-0 font-semibold underline underline-offset-2">
            {t("tryAgain")}
          </button>
        </div>
      )}
    </div>
  )
}

function EditWithAi({ editor, label }: { editor: InlineEditor; label: string }) {
  const t = useTranslations("elementEditor.ai")
  const [open, setOpen] = React.useState(false)
  const [prompt, setPrompt] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const content = prompt.trim()
    if (!content || sending) return
    setSending(true)
    const sent = await editor.sendMessage(content, true).catch(() => false)
    setSending(false)
    if (sent) setPrompt("")
  }

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className="h-8 w-full rounded-full bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-xs text-white shadow-md shadow-violet-500/25 hover:opacity-95"
      >
        <SparklesIcon />
        {t("button")}
      </Button>
    )
  }
  return (
    <form onSubmit={submit} className="rounded-full bg-linear-to-br from-indigo-300/80 via-white to-fuchsia-300/80 p-px focus-within:from-indigo-400 focus-within:to-fuchsia-400">
      <div className="flex items-center gap-1 rounded-full bg-white py-0.5 pe-0.5 ps-2.5">
        <SparklesIcon className="size-3.5 shrink-0 text-violet-600" />
        <input
          ref={inputRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation()
              setOpen(false)
            }
          }}
          dir="auto"
          aria-label={t("inputLabel", { element: label.toLowerCase() })}
          placeholder={t("placeholder", { element: label.toLowerCase() })}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={!prompt.trim() || sending}
          aria-label={t("send")}
          className="size-7 rounded-full bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:opacity-100"
        >
          {sending ? <Spinner className="text-current" /> : <ArrowUpIcon />}
        </Button>
      </div>
    </form>
  )
}

/** The quick editor: one category at a time, in a popover next to the element. */
export function ElementPopover({
  editor,
  theme,
  screenName,
  style,
}: {
  editor: InlineEditor
  theme: AppTheme | null
  screenName: string
  style: React.CSSProperties
}) {
  const t = useTranslations("elementEditor")
  const elementLabel = useElementLabel()
  const { selection } = editor
  const values = useEditorValues(editor)
  const [chosenCategory, setChosenCategory] = React.useState<string | null>(null)
  if (!selection) return null

  const label = ELEMENT_LABELS[selection.type] ?? selection.type
  const categories = categoriesFor(label, false)
  const category = categories.find((c) => c.id === chosenCategory) ?? categories[0]
  const disabled = !selection.saveable || selection.info?.editable === false

  return (
    <div
      role="dialog"
      aria-label={t("dialog", { element: elementLabel(label) })}
      style={style}
      className="absolute z-20 flex w-[19rem] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_24px_64px_-20px_rgba(76,29,149,0.45)] ring-1 ring-black/[0.05]"
    >
      <EditorHeader editor={editor} screenName={screenName} />
      <div role="tablist" aria-label={t("categoriesLabel")} className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border/60 px-1.5 py-1.5">
        {categories.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === category?.id}
            onClick={() => setChosenCategory(id)}
            className={cn(
              "flex min-w-11 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-violet-500/5 hover:text-foreground",
              id === category?.id && "bg-violet-500/10 text-violet-700 hover:bg-violet-500/10 hover:text-violet-700"
            )}
          >
            <Icon className="size-3.5" />
            {t(`categories.${id}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorNotes editor={editor} />
        <div role="tabpanel" aria-label={category ? t(`categories.${category.id}`) : undefined} className="space-y-2 p-3">
          {category?.fields.map((field) => (
            <ElementField key={field.id} field={field} editor={editor} values={values} theme={theme} disabled={disabled} />
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t border-border/60 p-2">
        <EditWithAi editor={editor} label={elementLabel(label)} />
      </div>
    </div>
  )
}

/** The advanced editor: every property, by category, in a panel beside the canvas. */
export function ElementAdvancedPanel({
  editor,
  theme,
  screenName,
}: {
  editor: InlineEditor
  theme: AppTheme | null
  screenName: string
}) {
  const t = useTranslations("elementEditor")
  const elementLabel = useElementLabel()
  const { selection } = editor
  const values = useEditorValues(editor)
  if (!selection) return null

  const label = ELEMENT_LABELS[selection.type] ?? selection.type
  const disabled = !selection.saveable || selection.info?.editable === false

  return (
    <aside
      aria-label={t("advancedPanel", { element: elementLabel(label) })}
      className="absolute top-12 end-3 bottom-3 z-20 flex w-[20rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_24px_64px_-20px_rgba(76,29,149,0.45)] ring-1 ring-black/[0.05]"
    >
      <EditorHeader editor={editor} screenName={screenName} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorNotes editor={editor} />
        {categoriesFor(label, true).map(({ id, icon: Icon, fields }) => (
          <section key={id} aria-label={t(`categories.${id}`)} className="border-b border-border/50 p-3 last:border-b-0">
            <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold">
              <Icon className="size-3.5 text-violet-600" />
              {t(`categories.${id}`)}
            </h3>
            <div className="space-y-2">
              {fields.map((field) => (
                <ElementField key={field.id} field={field} editor={editor} values={values} theme={theme} disabled={disabled} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="shrink-0 border-t border-border/60 p-2">
        <EditWithAi editor={editor} label={elementLabel(label)} />
      </div>
    </aside>
  )
}
