import Link from "next/link"
import { notFound } from "next/navigation"
import { and, asc, eq } from "drizzle-orm"
import { getTranslations } from "next-intl/server"
import { ArrowLeftIcon } from "lucide-react"

import { db, messages, projectAssets, screens } from "@/db"
import { toProjectScreen, toProjectServerRoute } from "@/lib/agent-protocol"
import { BACKEND_CONNECT_RESULTS, type BackendConnectResult } from "@/lib/backend-protocol"
import { getBackendStatus } from "@/lib/cloudhike/backend"
import { GITHUB_CONNECT_RESULTS, type GitHubConnectResult } from "@/lib/github-protocol"
import { serverT } from "@/lib/i18n/server"
import { getProjectAccess } from "@/lib/project-access"
import { createSandboxToken } from "@/lib/sandbox/token"
import { ifIntegrations } from "@/lib/server-routes/gate"
import { listServerRoutes } from "@/lib/server-routes/store"
import { integrationsEnabled } from "@/lib/services/flags"
import { SERVICE_CONNECT_RESULTS, type ServiceConnectResult } from "@/lib/services/protocol"
import { listServiceSummaries } from "@/lib/services/store"
import { getCurrentUser } from "@/lib/session"
import { getObjectUrl } from "@/lib/storage"
import { Logo } from "@/components/home/logo"
import { WorkspaceLayout } from "@/components/workspace/workspace-layout"
import { isImageKitEnabled } from "@/lib/imagekit"

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ backend?: string; github?: string; service?: string; serviceResult?: string }>
}) {
  const { projectId } = await params
  const { backend: connectResult, github: githubResult, service: serviceSlug, serviceResult } = await searchParams
  const user = await getCurrentUser()

  if (!user) {
    const t = await getTranslations("workspace.signedOut")
    return (
      <WorkspaceShell>
        <div className="mx-auto max-w-md rounded-[2rem] border border-border/60 bg-muted/40 p-8 text-center">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("description")}
          </p>
          <Link href="/" className="mt-5 inline-block text-sm font-medium text-violet-700 hover:underline">
            {t("goHome")}
          </Link>
        </div>
      </WorkspaceShell>
    )
  }

  // Someone else's project gets the same 404 as a missing one.
  const access = await getProjectAccess(projectId, user.id)
  if (!access) notFound()
  const { project, role } = access

  const assetRows = await db
    .select()
    .from(projectAssets)
    .where(eq(projectAssets.projectId, project.id))
    .orderBy(asc(projectAssets.createdAt))
  const assets = await Promise.all(
    assetRows.map(async (asset) => ({
      ...asset,
      url: await getObjectUrl(asset.storageKey).catch(() => null),
    }))
  )

  const thread = await db
    .select({ id: messages.id, role: messages.role, content: messages.content, plan: messages.plan })
    .from(messages)
    .where(and(eq(messages.projectId, project.id), eq(messages.archived, false)))
    .orderBy(asc(messages.createdAt))

  // Attachments belong to the first prompt, so they go when a new session archives it.
  const [firstMessage] = await db
    .select({ archived: messages.archived })
    .from(messages)
    .where(eq(messages.projectId, project.id))
    .orderBy(asc(messages.createdAt))
    .limit(1)

  const screenRows = await db
    .select()
    .from(screens)
    .where(eq(screens.projectId, project.id))
    .orderBy(asc(screens.position))

  // It's the owner's account that the backend runs on, whoever is looking.
  const backend = await getBackendStatus(project.id, project.userId, await serverT("errors"))

  // Only the owner sees the services an app uses.
  const isOwner = role === "owner"
  const services = isOwner && integrationsEnabled() ? await listServiceSummaries(project.id) : []
  const serviceConnect =
    serviceSlug &&
    services.some((service) => service.slug === serviceSlug) &&
    SERVICE_CONNECT_RESULTS.includes(serviceResult as ServiceConnectResult)
      ? { slug: serviceSlug, result: serviceResult as ServiceConnectResult }
      : null

  // Server functions and the pass that lets the preview call them are the owner's alone. The pass
  // is made even before the plan has server functions, since this session's build may add them.
  const sandboxToken = isOwner && integrationsEnabled() ? createSandboxToken(project.id, user.id) : null
  const serverRoutes = isOwner ? (await ifIntegrations(() => listServerRoutes(project.id))).map(toProjectServerRoute) : []

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <WorkspaceLayout
        project={{
          id: project.id,
          title: project.title,
          platform: project.platform,
          status: project.status,
          plan: project.plan,
        }}
        credits={user.credits}
        imageTools={isImageKitEnabled()}
        messages={thread}
        screens={screenRows.map(toProjectScreen)}
        serverRoutes={serverRoutes}
        sandboxToken={sandboxToken}
        backend={backend}
        backendConnectResult={
          BACKEND_CONNECT_RESULTS.includes(connectResult as BackendConnectResult) ? (connectResult as BackendConnectResult) : null
        }
        githubConnectResult={
          GITHUB_CONNECT_RESULTS.includes(githubResult as GitHubConnectResult) ? (githubResult as GitHubConnectResult) : null
        }
        services={services}
        integrations={integrationsEnabled()}
        serviceConnect={serviceConnect}
        readOnly={!isOwner}
        assets={firstMessage?.archived ? [] : assets.map(({ id, fileName, contentType, url }) => ({ id, fileName, contentType, url }))}
      />
    </div>
  )
}

async function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("workspace")
  const tHeader = await getTranslations("header")
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" aria-label={tHeader("homeLabel")}>
          <Logo />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4 rtl:-scale-x-100" />
          {t("backHome")}
        </Link>
      </header>
      <main className="px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
