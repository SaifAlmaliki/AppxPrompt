"use client"

import Link from "next/link"
import * as React from "react"
import { useTranslations } from "next-intl"
import {
  CopyPlusIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  GlobeIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react"

import { isUpgradeReason, type UpgradeReason } from "@/lib/plans"
import { MAX_PROJECT_NAME_LENGTH, type ProjectSummary } from "@/lib/projects"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { DownloadDialog } from "@/components/workspace/download-dialog"
import { ShareDialog } from "@/components/workspace/share-dialog"

export type ProjectDialogKind = "rename" | "delete" | "share" | "download"

/**
 * Sends a change to the project's API. Answers with what went wrong, if anything:
 * the server's own text when it gave one, else a message in the page's language.
 */
export function useSendChange() {
  const t = useTranslations("projects.errors")

  return React.useCallback(
    async (url: string, method: string, body?: unknown, onUpgrade?: (reason: UpgradeReason) => void) => {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      }).catch(() => null)
      if (!response) return t("network")
      if (response.ok) return null
      const answer = await response.json().catch(() => null)
      if (isUpgradeReason(answer?.code)) onUpgrade?.(answer.code)
      return (answer?.error as string | undefined) ?? t("generic")
    },
    [t]
  )
}

export function ProjectMenu({
  project,
  onDialog,
  onDuplicate,
  onSetPublic,
}: {
  project: ProjectSummary
  onDialog: (kind: ProjectDialogKind) => void
  onDuplicate: () => void
  onSetPublic: (isPublic: boolean) => void
}) {
  const t = useTranslations("projects.menu")
  const href = `/workspace/${project.id}`
  const isOwner = project.role === "owner"
  const working = project.status === "building"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("actions", { name: project.name })}
            className="rounded-full bg-white/85 text-foreground/70 shadow-sm backdrop-blur-md hover:bg-white hover:text-violet-700"
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-2xl">
        <DropdownMenuItem className="rounded-xl py-2" render={<Link href={href} />}>
          <FolderOpenIcon />
          {t("open")}
        </DropdownMenuItem>
        <DropdownMenuItem className="rounded-xl py-2" render={<a href={href} target="_blank" rel="noreferrer" />}>
          <ExternalLinkIcon />
          {t("openNewTab")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isOwner && (
          <>
            <DropdownMenuItem className="rounded-xl py-2" disabled={working} onClick={() => onDialog("rename")}>
              <PencilIcon />
              {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem className="rounded-xl py-2" disabled={working} onClick={onDuplicate}>
              <CopyPlusIcon />
              {t("duplicate")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-xl py-2" onClick={() => onDialog("share")}>
              <Share2Icon />
              {t("share")}
            </DropdownMenuItem>
            {project.isPublic ? (
              <DropdownMenuItem className="rounded-xl py-2" onClick={() => onSetPublic(false)}>
                <LockIcon />
                {t("makePrivate")}
              </DropdownMenuItem>
            ) : (
              // The share dialog says what going public shows, so the choice is made there.
              <DropdownMenuItem className="rounded-xl py-2" disabled={!project.hasPreview} onClick={() => onDialog("share")}>
                <GlobeIcon />
                {t("makePublic")}
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuItem
          className="rounded-xl py-2"
          disabled={working || !project.hasPreview}
          onClick={() => onDialog("download")}
        >
          <DownloadIcon />
          {t("exportZip")}
        </DropdownMenuItem>
        {isOwner && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className="rounded-xl py-2" disabled={working} onClick={() => onDialog("delete")}>
              <Trash2Icon />
              {t("delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const nothingToSave = async () => true

/** The dialogs behind a project's menu. One set serves all the cards in a list. */
export function ProjectDialogs({
  project,
  kind,
  open,
  onOpenChange,
  onRenamed,
  onPublicChange,
  onDeleted,
}: {
  project: ProjectSummary | null
  kind: ProjectDialogKind | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRenamed: (name: string) => void
  onPublicChange: (isPublic: boolean) => void
  onDeleted: () => void
}) {
  if (!project) return null
  return (
    <>
      <RenameDialog
        key={`rename-${project.id}`}
        project={project}
        open={open && kind === "rename"}
        onOpenChange={onOpenChange}
        onRenamed={onRenamed}
      />
      <DeleteDialog project={project} open={open && kind === "delete"} onOpenChange={onOpenChange} onDeleted={onDeleted} />
      <ShareDialog projectId={project.id} open={open && kind === "share"} onOpenChange={onOpenChange} onPublicChange={onPublicChange} />
      <DownloadDialog
        projectId={project.id}
        open={open && kind === "download"}
        onOpenChange={onOpenChange}
        beforeExport={nothingToSave}
      />
    </>
  )
}

function RenameDialog({
  project,
  open,
  onOpenChange,
  onRenamed,
}: {
  project: ProjectSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onRenamed: (name: string) => void
}) {
  const t = useTranslations("projects.rename")
  const sendChange = useSendChange()
  const [name, setName] = React.useState(project.name)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setName(project.name)
    setError(null)
  }, [open, project.name])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const next = name.trim().replace(/\s+/g, " ")
    if (next === project.name) return onOpenChange(false)
    setSaving(true)
    const problem = await sendChange(`/api/projects/${project.id}`, "PATCH", { name: next })
    setSaving(false)
    if (problem) return setError(problem)
    onRenamed(next)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} noValidate className="grid gap-3">
          <label htmlFor="project-name" className="sr-only">
            {t("label")}
          </label>
          <Input
            id="project-name"
            dir="auto"
            autoFocus
            maxLength={MAX_PROJECT_NAME_LENGTH}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            aria-invalid={Boolean(error)}
            className="h-10 rounded-full px-4"
          />
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-10 rounded-full px-4" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="h-10 rounded-full px-4" disabled={saving || !name.trim()}>
              {saving && <Loader2Icon className="animate-spin" />}
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: ProjectSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const t = useTranslations("projects.delete")
  const sendChange = useSendChange()
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) setError(null)
  }, [open])

  async function confirm() {
    setDeleting(true)
    const problem = await sendChange(`/api/projects/${project.id}`, "DELETE")
    setDeleting(false)
    if (problem) return setError(problem)
    onDeleted()
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { name: project.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter className="rounded-b-3xl">
          <AlertDialogCancel className="rounded-full">{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" className="rounded-full" disabled={deleting} onClick={() => void confirm()}>
            {deleting && <Loader2Icon className="animate-spin" />}
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
