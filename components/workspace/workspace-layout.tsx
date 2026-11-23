"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { LayoutGridIcon, MessageSquareIcon, SmartphoneIcon } from "lucide-react"

import { useInlineEditor } from "@/hooks/use-inline-editor"
import { useProjectAgent } from "@/hooks/use-project-agent"
import { useWebPublish } from "@/hooks/use-web-publish"
import { useAuth } from "@/lib/auth-client"
import { projectSlug } from "@/lib/generated-app/export-project"
import { generatedAppFiles, previewProject } from "@/lib/generated-app/project-files"
import { isRunnable, type AppPlan, type ChatMessage, type ProjectScreen } from "@/lib/agent-protocol"
import type { BackendConnectResult, BackendStatus } from "@/lib/backend-protocol"
import type { GitHubConnectResult } from "@/lib/github-protocol"
import type { ProjectPlatform, ProjectStatus } from "@/lib/projects"
import type { ServiceConnectResult, ServiceSummary } from "@/lib/services/protocol"
import { cn } from "@/lib/utils"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { BackendDialog } from "@/components/workspace/backend-dialog"
import { CanvasPanel } from "@/components/workspace/canvas-panel"
import { ChatPanel, type ChatAsset } from "@/components/workspace/chat-panel"
import { DownloadDialog } from "@/components/workspace/download-dialog"
import { GitHubDialog } from "@/components/workspace/github-dialog"
import { PreviewPanel } from "@/components/workspace/preview-panel"
import { PublishDialog } from "@/components/workspace/publish-dialog"
import { ServiceDialog } from "@/components/workspace/service-dialog"
import { ShareDialog } from "@/components/workspace/share-dialog"
import { WorkspaceHeader } from "@/components/workspace/workspace-header"

const DESKTOP_QUERY = "(min-width: 1024px)"

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

const MOBILE_VIEWS = [
  { id: "chat", icon: MessageSquareIcon },
  { id: "canvas", icon: LayoutGridIcon },
  { id: "preview", icon: SmartphoneIcon },
] as const

type MobileView = (typeof MOBILE_VIEWS)[number]["id"]

export function WorkspaceLayout({
  project,
  credits,
  imageTools,
  messages,
  screens,
  backend,
  backendConnectResult,
  githubConnectResult,
  services,
  integrations,
  serviceConnect,
  readOnly,
  assets,
}: {
  project: {
    id: string
    title: string
    platform: ProjectPlatform
    status: ProjectStatus
    plan: AppPlan | null
  }
  credits: number
  messages: ChatMessage[]
  screens: ProjectScreen[]
  backend: BackendStatus
  /** How the browser's trip to CloudHike went, when it has just come back. */
  backendConnectResult: BackendConnectResult | null
  /** How the browser's trip to GitHub went, when it has just come back. */
  githubConnectResult: GitHubConnectResult | null
  /** The services the app uses. Empty for someone the project was shared with. */
  services: ServiceSummary[]
  /** Whether integrations are on for this server. */
  integrations: boolean
  /** How the browser's trip to a service's sign-in went, when it has just come back. */
  serviceConnect: { slug: string; result: ServiceConnectResult } | null
  /** Someone the project was shared with, who can look and download but not change it. */
  readOnly: boolean
  assets: ChatAsset[]
  /** Whether ImageKit is on, for replacing and generating images in edit mode. */
  imageTools: boolean
}) {
  const t = useTranslations("workspace")
  const agent = useProjectAgent(project.id, {
    messages,
    status: project.status,
    plan: project.plan,
    screens,
    backend,
    services,
  }, readOnly)
  const editor = useInlineEditor(project.id, agent, imageTools, readOnly)
  const { user, refresh: refreshAccount } = useAuth()

  // A build is charged when it starts, and what it didn't finish comes back if it fails.
  React.useEffect(() => {
    void refreshAccount()
  }, [agent.busy, agent.status, refreshAccount])

  const [backendDialogOpen, setBackendDialogOpen] = React.useState(backendConnectResult !== null)
  const [connectNotice, setConnectNotice] = React.useState(backendConnectResult)
  const [shareDialogOpen, setShareDialogOpen] = React.useState(false)
  const [downloadDialogOpen, setDownloadDialogOpen] = React.useState(false)
  const [githubDialogOpen, setGithubDialogOpen] = React.useState(githubConnectResult !== null)
  const [githubNotice, setGithubNotice] = React.useState(githubConnectResult)
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false)
  const webPublish = useWebPublish(project.id, !readOnly, editor.retrySave)

  // Pasted keys live here only while the dialog is open, and go when it closes.
  const [serviceDialog, setServiceDialog] = React.useState<{ slug: string | null; pastedKeys: string[] } | null>(
    serviceConnect && !readOnly ? { slug: serviceConnect.slug, pastedKeys: [] } : null
  )
  const [serviceNotice, setServiceNotice] = React.useState(serviceConnect)
  const openService = React.useCallback((slug: string) => {
    setServiceDialog((current) => ({ slug, pastedKeys: current?.pastedKeys ?? [] }))
  }, [])
  const keysRemoved = React.useCallback((keys: string[]) => {
    setServiceDialog((current) => ({
      slug: current?.slug ?? null,
      pastedKeys: [...(current?.pastedKeys ?? []), ...keys.filter((key) => !current?.pastedKeys.includes(key))],
    }))
  }, [])

  // Coming back from a service's sign-in shouldn't reopen the dialog on every reload.
  React.useEffect(() => {
    if (serviceConnect) window.history.replaceState(null, "", window.location.pathname)
  }, [serviceConnect])

  // The agent asked for a service: open its dialog once.
  const { serviceRequest, clearServiceRequest } = agent
  React.useEffect(() => {
    if (!serviceRequest) return
    if (!readOnly) openService(serviceRequest)
    clearServiceRequest()
  }, [serviceRequest, readOnly, openService, clearServiceRequest])

  // Coming back from GitHub shouldn't reopen the dialog on every reload.
  React.useEffect(() => {
    if (githubConnectResult) window.history.replaceState(null, "", window.location.pathname)
  }, [githubConnectResult])

  /** A built app gets its backend now. One still being built gets it when the build finishes. */
  const { send } = agent
  const setUpBackendIfBuilt = React.useCallback(() => {
    if (agent.status === "ready") void send({ action: "message", content: t("setUpBackendMessage") })
  }, [agent.status, send, t])

  // Only once per trip to CloudHike: reloading the page mustn't deploy or ask again.
  const handledConnect = React.useRef(false)
  React.useEffect(() => {
    if (!backendConnectResult || handledConnect.current) return
    handledConnect.current = true
    window.history.replaceState(null, "", window.location.pathname)
    if (backendConnectResult === "connected") setUpBackendIfBuilt()
  }, [backendConnectResult, setUpBackendIfBuilt])

  const header = (
    <WorkspaceHeader
      name={project.title}
      status={agent.status}
      platform={project.platform}
      credits={user?.credits ?? credits}
      backend={agent.backend}
      services={agent.services}
      showServices={integrations || agent.services.length > 0}
      readOnly={readOnly}
      onOpenBackend={() => setBackendDialogOpen(true)}
      onOpenService={openService}
      onShare={() => setShareDialogOpen(true)}
      onDownload={() => setDownloadDialogOpen(true)}
      onPushToGitHub={() => setGithubDialogOpen(true)}
      onPublish={() => setPublishDialogOpen(true)}
    />
  )
  const exportDialogs = (
    <>
      <DownloadDialog
        projectId={project.id}
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        beforeExport={editor.retrySave}
      />
      {!readOnly && (
        <>
          <ShareDialog projectId={project.id} open={shareDialogOpen} onOpenChange={setShareDialogOpen} />
          <GitHubDialog
            projectId={project.id}
            projectName={agent.plan?.appName || project.title}
            defaultRepoName={projectSlug(agent.plan?.appName || project.title)}
            open={githubDialogOpen}
            onOpenChange={(open) => {
              setGithubDialogOpen(open)
              if (!open) setGithubNotice(null)
            }}
            connectResult={githubNotice}
            beforeExport={editor.retrySave}
          />
          <PublishDialog
            projectId={project.id}
            platform={project.platform}
            open={publishDialogOpen}
            onOpenChange={setPublishDialogOpen}
            beforeExport={editor.retrySave}
            webPublish={webPublish}
          />
        </>
      )}
    </>
  )
  const backendDialog = (
    <BackendDialog
      projectId={project.id}
      open={backendDialogOpen}
      onOpenChange={(open) => {
        setBackendDialogOpen(open)
        if (!open) setConnectNotice(null)
      }}
      backend={agent.backend}
      connectResult={connectNotice}
      onLink={async () => {
        const linked = await agent.changeBackend("POST")
        if (linked) setUpBackendIfBuilt()
        return linked
      }}
      onDisconnect={() => agent.changeBackend("DELETE")}
    />
  )
  const serviceDialogElement = !readOnly && (
    <ServiceDialog
      projectId={project.id}
      open={serviceDialog !== null}
      onOpenChange={(open) => {
        if (open) return
        setServiceDialog(null)
        setServiceNotice(null)
      }}
      service={agent.services.find((service) => service.slug === serviceDialog?.slug) ?? null}
      pastedKeys={serviceDialog?.pastedKeys ?? []}
      services={agent.services}
      connectResult={serviceNotice && serviceNotice.slug === serviceDialog?.slug ? serviceNotice.result : null}
      onChanged={agent.serviceChanged}
    />
  )
  const chat = <ChatPanel agent={agent} assets={assets} editor={editor} onKeysRemoved={keysRemoved} onOpenService={openService} />
  // Rebuilt only when what the running app sees changes: not for code still streaming in,
  // or for the active theme, which reaches it on its own so switching never reloads the app.
  // Edits made by hand reach it on their own too, so it runs the code from before them.
  const { runningPlan, runningScreens } = editor
  const runnableKey = JSON.stringify([
    runningPlan?.collections ?? null,
    runningPlan?.backend ?? null,
    runningPlan?.components ?? null,
    runningScreens.map((s) => [s.slug, s.position, s.status, isRunnable(s) ? s.code : null]),
  ])
  const app = React.useMemo(() => previewProject(runningPlan, runningScreens), [runnableKey])
  const appFiles = React.useMemo(() => generatedAppFiles(agent.plan), [agent.plan])
  const syncing = agent.status === "building"

  const canvas = (
    <CanvasPanel
      projectId={project.id}
      plan={agent.plan}
      screens={agent.screens}
      app={app}
      activity={agent.busy ? agent.activity : null}
      syncing={syncing}
      onThemeChange={agent.setTheme}
      editor={editor}
    />
  )
  const preview = (
    <PreviewPanel
      projectId={project.id}
      plan={agent.plan}
      screens={agent.screens}
      app={app}
      appFiles={appFiles}
      syncing={syncing}
      edits={editor.edits}
      webPublish={webPublish}
      onOpenPublish={() => setPublishDialogOpen(true)}
    />
  )

  // Assume desktop on the server; the three-panel layout is the main target.
  const isDesktop = React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true
  )
  const [mobileView, setMobileView] = React.useState<MobileView>("chat")

  if (isDesktop) {
    return (
      <>
        {header}
        {backendDialog}
        {serviceDialogElement}
        {exportDialogs}
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="chat" defaultSize="24%" minSize={280} maxSize="40%">
            {chat}
          </ResizablePanel>
          <ResizableHandle className="hover:bg-violet-300 data-[separator=active]:bg-violet-400" />
          <ResizablePanel id="canvas" defaultSize="46%" minSize={320}>
            {canvas}
          </ResizablePanel>
          <ResizableHandle className="hover:bg-violet-300 data-[separator=active]:bg-violet-400" />
          <ResizablePanel id="preview" defaultSize="30%" minSize={340} maxSize="45%">
            {preview}
          </ResizablePanel>
        </ResizablePanelGroup>
      </>
    )
  }

  return (
    <>
      {header}
      {backendDialog}
      {serviceDialogElement}
      {exportDialogs}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {mobileView === "chat" && chat}
          {mobileView === "canvas" && canvas}
          {mobileView === "preview" && preview}
        </div>
        <nav
          aria-label={t("sections.label")}
          className="grid shrink-0 grid-cols-3 gap-1 border-t border-border/60 bg-white p-1.5"
        >
          {MOBILE_VIEWS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={mobileView === id}
              onClick={() => setMobileView(id)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors",
                mobileView === id
                  ? "bg-violet-500/10 text-violet-700"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {t(`sections.${id}`)}
            </button>
          ))}
        </nav>
      </div>
    </>
  )
}
