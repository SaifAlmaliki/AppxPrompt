"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClockIcon,
  ActivityIcon,
  Code2Icon,
  ExternalLinkIcon,
  FileCodeIcon,
  FileJsonIcon,
  FolderIcon,
  FolderOpenIcon,
  GlobeIcon,
  Loader2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  SmartphoneIcon,
  SparklesIcon,
} from "lucide-react"

import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import type { WebPublishState } from "@/hooks/use-web-publish"
import type { AppPlan, ProjectScreen, SelfTestStatus } from "@/lib/agent-protocol"
import type { ServerTarget } from "@/lib/generated-app/server-files"
import type { ElementEdits, PreviewFile, PreviewProject } from "@/lib/preview-protocol"
import { resetPreviewStorage } from "@/lib/preview-storage"
import { isWebPublishActive } from "@/lib/publish-protocol"
import { selfTestReasonKey } from "@/lib/server-routes/self-test-protocol"
import { activeTheme } from "@/lib/themes"
import { buildFileTree, languageForPath, type FileNode } from "@/lib/workspace-data"
import { cn } from "@/lib/utils"
import { ActivityPanel } from "@/components/workspace/activity-panel"
import { AppFrame } from "@/components/workspace/app-frame"
import { CopyLinkButton, ExpoQrPopover } from "@/components/workspace/expo-qr-popover"
import { Button } from "@/components/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** How the one try of each server function went, by file path. Only the owner gets any. */
export type ServerTests = Record<string, { status: SelfTestStatus | null; detail: string | null }>

export function PreviewPanel({
  projectId,
  plan,
  screens,
  app,
  appFiles,
  serverFiles,
  serverTests,
  snackServer,
  sandboxToken,
  onServiceNeeded,
  syncing,
  edits,
  webPublish,
  onOpenPublish,
  showActivity,
}: {
  projectId: string
  plan: AppPlan | null
  screens: ProjectScreen[]
  /** The app as built so far. */
  app: PreviewProject
  /** The generated files besides the screens. */
  appFiles: PreviewFile[]
  /** The app's server code, listed after the other files. Only the owner gets any. */
  serverFiles: PreviewFile[]
  serverTests: ServerTests
  /** Where the phone's copy of the app reaches its server functions. */
  snackServer: ServerTarget
  /** The owner's pass to the app's server functions in the preview. Empty for anyone else. */
  sandboxToken: string
  /** A server function answered that this service isn't connected yet. */
  onServiceNeeded: (slug: string) => void
  /** True while the agent is working on the screens. */
  syncing: boolean
  /** Edits made by hand, shown on top of the running code. */
  edits: ElementEdits
  webPublish: WebPublishState
  onOpenPublish: () => void
  /** The owner's Activity tab. Anyone else only looks at the app. */
  showActivity: boolean
}) {
  const t = useTranslations("preview")
  const [reloadSignal, setReloadSignal] = React.useState(0)
  const hasApp = screens.some((s) => s.status === "done")

  return (
    <Tabs defaultValue="preview" className="@container flex h-full min-h-0 gap-0 bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <TabsList className="h-8 rounded-full bg-muted/70 p-0.5">
          <TabsTrigger value="preview" className="rounded-full px-3 data-active:text-violet-700">
            <SmartphoneIcon />
            {t("tabs.preview")}
          </TabsTrigger>
          <TabsTrigger value="code" className="rounded-full px-3 data-active:text-violet-700">
            <Code2Icon />
            {t("tabs.code")}
          </TabsTrigger>
          {showActivity && (
            <TabsTrigger value="activity" className="rounded-full px-3 data-active:text-violet-700">
              <ActivityIcon />
              {t("tabs.activity")}
            </TabsTrigger>
          )}
        </TabsList>
        {hasApp && (
          <div className="flex items-center gap-1">
            <ExpoQrPopover plan={plan} screens={screens} snackServer={snackServer} />
            <PreviewAction label={t("resetData")} onClick={() => resetPreviewStorage(projectId)}>
              <RotateCcwIcon />
            </PreviewAction>
            <PreviewAction label={t("reload")} onClick={() => setReloadSignal((n) => n + 1)}>
              <RotateCwIcon />
            </PreviewAction>
          </div>
        )}
      </div>

      {/* Stays mounted, so looking at the code doesn't lose your place in the app. */}
      <TabsContent value="preview" keepMounted className="min-h-0 data-hidden:hidden">
        <AppPreview
          projectId={projectId}
          app={hasApp ? app : null}
          plan={plan}
          syncing={syncing}
          reloadSignal={reloadSignal}
          edits={edits}
          sandboxToken={sandboxToken}
          onServiceNeeded={onServiceNeeded}
          webPublish={webPublish}
          onOpenPublish={onOpenPublish}
        />
      </TabsContent>
      <TabsContent value="code" className="min-h-0">
        <CodeView screens={screens} appFiles={appFiles} serverFiles={serverFiles} serverTests={serverTests} />
      </TabsContent>
      {showActivity && (
        <TabsContent value="activity" className="min-h-0">
          <ActivityPanel projectId={projectId} />
        </TabsContent>
      )}
    </Tabs>
  )
}

function PreviewAction({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className="rounded-full text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
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

function AppPreview({
  projectId,
  app,
  plan,
  syncing,
  reloadSignal,
  edits,
  sandboxToken,
  onServiceNeeded,
  webPublish,
  onOpenPublish,
}: {
  projectId: string
  app: PreviewProject | null
  plan: AppPlan | null
  syncing: boolean
  reloadSignal: number
  edits: ElementEdits
  sandboxToken: string
  onServiceNeeded: (slug: string) => void
  webPublish: WebPublishState
  onOpenPublish: () => void
}) {
  const t = useTranslations("preview")
  return (
    <div className="flex h-full flex-col gap-3 bg-linear-to-b from-violet-50/60 to-white p-4">
      <WebsiteBar webPublish={webPublish} onOpenPublish={onOpenPublish} />
      {/* The phone takes all the room there is, keeping its shape in a tall or a wide panel. */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]">
        <div className="relative aspect-[9/19] w-[min(100cqw,calc(100cqh*9/19))]">
          <div
            aria-hidden
            className="absolute -inset-6 rounded-full bg-linear-to-br from-indigo-300/30 via-fuchsia-300/25 to-violet-300/30 blur-3xl"
          />
          <div dir={app ? "ltr" : undefined} className="relative size-full overflow-hidden rounded-[2.75rem] border-[8px] border-neutral-900 bg-white shadow-[0_32px_64px_-24px_rgba(76,29,149,0.45)]">
            {app ? (
              <AppFrame
                projectId={projectId}
                project={app}
                theme={activeTheme(plan?.themePackage)}
                route="/"
                interactive
                title={t("frameTitle", { name: plan?.appName ?? t("defaultAppName") })}
                syncing={syncing}
                reloadSignal={reloadSignal}
                edits={edits}
                sandboxToken={sandboxToken}
                onServiceNeeded={onServiceNeeded}
              />
            ) : (
              <>
                <div className="absolute top-2 left-1/2 h-5 w-20 -translate-x-1/2 rounded-full bg-neutral-900" />
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
                    <SparklesIcon className="size-5" />
                  </span>
                  <p className="text-sm font-medium">{t("emptyTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("emptyBody")}</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The app's website: where it's live, and how an update is going. Empty until its first publish. */
function WebsiteBar({ webPublish, onOpenPublish }: { webPublish: WebPublishState; onOpenPublish: () => void }) {
  const t = useTranslations("preview.website")
  const tStep = useTranslations("preview.publishStep")
  const { web, starting, active } = webPublish
  if (!web && !starting) return null

  const failed = !active && web?.status === "failed"
  const url = web?.url
  const step = starting || !web || !isWebPublishActive(web.status) ? "uploading" : web.status

  return (
    <div className="relative z-10 flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-border/60 bg-white py-1 pe-1 ps-3 shadow-xs">
      {active ? (
        <Loader2Icon aria-hidden className="size-3.5 shrink-0 animate-spin text-violet-600" />
      ) : failed ? (
        <AlertCircleIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
      ) : (
        <GlobeIcon aria-hidden className="size-3.5 shrink-0 text-emerald-600" />
      )}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          dir="ltr"
          className="min-w-0 flex-1 truncate text-xs font-medium hover:text-violet-700 hover:underline"
        >
          {url.replace(/^https:\/\//, "").replace(/\/$/, "")}
        </a>
      ) : (
        <span role="status" className="min-w-0 flex-1 truncate text-xs font-medium">
          {failed ? t("failed") : t("step", { step: tStep(step) })}
        </span>
      )}
      {url && (active || failed) && (
        <button
          type="button"
          onClick={onOpenPublish}
          className={cn("shrink-0 text-xs hover:underline", failed ? "text-destructive" : "text-muted-foreground")}
        >
          {failed ? t("updateFailed") : t("updating")}
        </button>
      )}
      {!url && failed && (
        <Button variant="ghost" size="sm" className="rounded-full text-xs text-muted-foreground" onClick={onOpenPublish}>
          {t("view")}
        </Button>
      )}
      {url && (
        <>
          <CopyLinkButton url={url} />
          <PreviewAction label={t("open")} render={<a href={url} target="_blank" rel="noreferrer" />} nativeButton={false}>
            <ExternalLinkIcon />
          </PreviewAction>
        </>
      )}
    </div>
  )
}

function CodeView({
  screens,
  appFiles,
  serverFiles,
  serverTests,
}: {
  screens: ProjectScreen[]
  appFiles: PreviewFile[]
  serverFiles: PreviewFile[]
  serverTests: ServerTests
}) {
  const t = useTranslations("preview.code")
  const files = [
    ...screens.filter((s) => s.code !== null),
    ...appFiles.map((file) => ({ filePath: file.path, code: file.code })),
    ...serverFiles.map((file) => ({ filePath: file.path, code: file.code })),
  ]
  const generating = screens.find((s) => s.status === "generating")
  const [chosenPath, setChosenPath] = React.useState<string | null>(null)
  // Show the file the person picked; until they pick one, follow the file being written.
  const activePath =
    (files.some((f) => f.filePath === chosenPath) ? chosenPath : null) ??
    generating?.filePath ??
    files[0]?.filePath
  const active = files.find((f) => f.filePath === activePath)

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
          <Code2Icon className="size-5" />
        </span>
        <p className="text-sm font-medium">{t("emptyTitle")}</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {generating
            ? t.rich("designing", { name: generating.name, bdi: (chunks) => <bdi>{chunks}</bdi> })
            : t("awaitingPlan")}
        </p>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(140px,38%)_1fr]">
      <nav aria-label={t("filesLabel")} className="min-h-0 overflow-y-auto border-e border-border/60 bg-neutral-50/70 py-2">
        <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("files")}
        </p>
        <FileTree
          nodes={buildFileTree(files.map((f) => f.filePath))}
          depth={0}
          activePath={active.filePath}
          writingPath={generating?.filePath}
          serverTests={serverTests}
          onSelect={setChosenPath}
        />
      </nav>
      <div className="flex min-h-0 flex-col">
        <ServerTestBadge test={serverTests[active.filePath]} />
        <div className="min-h-0 flex-1">
          <CodeFile path={active.filePath} code={active.code ?? ""} />
        </div>
      </div>
    </div>
  )
}

const SERVER_TEST_STYLES = {
  passed: { icon: CheckCircle2Icon, tone: "text-emerald-600", badge: "bg-emerald-50 text-emerald-800" },
  failed: { icon: AlertCircleIcon, tone: "text-red-600", badge: "bg-red-50 text-red-800" },
  skipped: { icon: ClockIcon, tone: "text-muted-foreground", badge: "bg-muted text-muted-foreground" },
} as const

/** The words for how a server function's one try went. */
function useServerTestLabel() {
  const t = useTranslations("preview.code.serverTest")
  return (test: ServerTests[string]) => {
    const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>
    if (test.status === "passed") return t("passed")
    if (test.status === "failed") return t.rich("failed", { summary: test.detail ?? "", bdi })
    if (!test.detail) return t("untried")
    const known = selfTestReasonKey(test.detail)
    return t.rich("skipped", { reason: known ? t(`reasons.${known}`) : test.detail, bdi })
  }
}

function serverTestStyle(test: ServerTests[string]) {
  return SERVER_TEST_STYLES[test.status ?? "skipped"]
}

function ServerTestBadge({ test }: { test: ServerTests[string] | undefined }) {
  const label = useServerTestLabel()
  if (!test) return null
  const { icon: Icon, badge } = serverTestStyle(test)
  return (
    <p className={cn("flex items-start gap-1.5 border-b border-border/60 px-3 py-1.5 text-xs", badge)}>
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 wrap-break-word">{label(test)}</span>
    </p>
  )
}

function FileTree({
  nodes,
  depth,
  activePath,
  writingPath,
  serverTests,
  onSelect,
}: {
  nodes: FileNode[]
  depth: number
  activePath: string
  writingPath?: string
  serverTests: ServerTests
  onSelect: (path: string) => void
}) {
  const t = useTranslations("preview.code")
  const testLabel = useServerTestLabel()
  return (
    <ul role={depth === 0 ? "tree" : "group"} dir="ltr">
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FolderItem
            key={node.name}
            node={node}
            depth={depth}
            activePath={activePath}
            writingPath={writingPath}
            serverTests={serverTests}
            onSelect={onSelect}
          />
        ) : (
          <li key={node.path} role="treeitem" aria-selected={node.path === activePath}>
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              style={{ paddingInlineStart: 12 + depth * 12 + 16 }}
              className={cn(
                "flex w-full items-center gap-1.5 py-1 pe-2 text-start text-xs transition-colors",
                node.path === activePath
                  ? "bg-violet-500/10 font-medium text-violet-700"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {node.name.endsWith(".json") ? (
                <FileJsonIcon className="size-3.5 shrink-0 text-amber-500" />
              ) : (
                <FileCodeIcon className="size-3.5 shrink-0 text-sky-500" />
              )}
              <span className="truncate">{node.name}</span>
              {serverTests[node.path] && (
                <span className="ms-auto flex shrink-0 items-center">
                  {React.createElement(serverTestStyle(serverTests[node.path]).icon, {
                    className: cn("size-3.5", serverTestStyle(serverTests[node.path]).tone),
                    "aria-hidden": true,
                  })}
                  <span className="sr-only">{testLabel(serverTests[node.path])}</span>
                </span>
              )}
              {node.path === writingPath && (
                <span aria-label={t("beingWritten")} className="ms-auto size-1.5 shrink-0 animate-pulse rounded-full bg-violet-500" />
              )}
            </button>
          </li>
        )
      )}
    </ul>
  )
}

function FolderItem({
  node,
  depth,
  activePath,
  writingPath,
  serverTests,
  onSelect,
}: {
  node: Extract<FileNode, { type: "folder" }>
  depth: number
  activePath: string
  writingPath?: string
  serverTests: ServerTests
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = React.useState(true)
  const Icon = open ? FolderOpenIcon : FolderIcon

  return (
    <li role="treeitem" aria-expanded={open} aria-selected={false}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ paddingInlineStart: 12 + depth * 12 }}
        className="flex w-full items-center gap-1 py-1 pe-2 text-start text-xs text-foreground/80 transition-colors hover:bg-muted"
      >
        <ChevronRightIcon className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open ? "rotate-90" : "rtl:-scale-x-100")} />
        <Icon className="size-3.5 shrink-0 text-violet-500" />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <FileTree
          nodes={node.children}
          depth={depth + 1}
          activePath={activePath}
          writingPath={writingPath}
          serverTests={serverTests}
          onSelect={onSelect}
        />
      )}
    </li>
  )
}

function CodeFile({ path, code }: { path: string; code: string }) {
  const lines = useHighlightedCode(code, languageForPath(path))

  return (
    <CodeBlock size="sm" dir="ltr" className="h-full min-h-0 rounded-none border-0">
      <CodeBlockHeader className="border-b border-border/60 pb-2">
        <CodeBlockTitle className="font-mono">{path}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers className="flex-1">
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}
