"use client"

import Link from "next/link"
import * as React from "react"
import { useFormatter, useTranslations } from "next-intl"
import {
  CoinsIcon,
  FolderIcon,
  GaugeIcon,
  Loader2Icon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react"

import { useAuth, type SessionUser } from "@/lib/auth-client"
import type { PlanId } from "@/lib/plans"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { LanguageToggle } from "@/components/language-toggle"
import { Logo } from "@/components/home/logo"
import { useSignInDialog } from "@/components/home/sign-in-dialog"

const NAV_LINKS = [
  { id: "templates", href: "/#templates" },
  { id: "pricing", href: "/pricing" },
  { id: "docs", href: "/docs" },
] as const

export function SiteHeader() {
  const { user, isPending } = useAuth()
  const { openSignIn } = useSignInDialog()
  const t = useTranslations()

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 rounded-full border border-white/60 bg-white/65 pe-2 ps-3 shadow-[0_8px_32px_-12px_rgba(76,29,149,0.25)] ring-1 ring-black/[0.03] backdrop-blur-xl sm:ps-4">
        <div className="flex items-center gap-8">
          <Link href="/" aria-label={t("header.homeLabel")}>
            <Logo className="size-8 rounded-full" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {user && (
              <Link
                href="/#projects"
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-violet-500/10 hover:text-violet-700"
              >
                {t("header.myProjects")}
              </Link>
            )}
            {NAV_LINKS.map((link) => (
              <Link
                key={link.id}
                href={link.href}
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-violet-500/10 hover:text-violet-700"
              >
                {t(`header.nav.${link.id}`)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <LanguageToggle className="hidden md:inline-flex" />
          {isPending ? (
            <Skeleton className="size-10 rounded-full" />
          ) : user ? (
            <>
              <CreditsBadge credits={user.credits} plan={user.plan} />
              <UserMenu user={user} />
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="lg"
                className="hidden h-10 rounded-full px-4 sm:inline-flex"
                onClick={() => openSignIn("sign-in")}
              >
                {t("header.signIn")}
              </Button>
              <Button
                size="lg"
                className="h-10 rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-5 text-white shadow-md shadow-violet-500/30 transition-transform hover:scale-[1.03] hover:opacity-95"
                onClick={() => openSignIn("sign-up")}
              >
                {t("header.getStarted")}
              </Button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full md:hidden"
                  aria-label={t("header.openMenu")}
                />
              }
            >
              <MenuIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-2xl">
              {user && (
                <DropdownMenuItem className="py-2" render={<Link href="/#projects" />}>
                  {t("header.myProjects")}
                </DropdownMenuItem>
              )}
              {NAV_LINKS.map((link) => (
                <DropdownMenuItem
                  key={link.id}
                  render={<Link href={link.href} />}
                  className="py-2"
                >
                  {t(`header.nav.${link.id}`)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="text-sm text-muted-foreground">
                  {t("languageToggle.label")}
                </span>
                <LanguageToggle />
              </div>
              {!user && !isPending && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="py-2"
                    onClick={() => openSignIn("sign-in")}
                  >
                    {t("header.signIn")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

function CreditsBadge({ credits, plan }: { credits: number; plan: PlanId }) {
  const t = useTranslations()
  const format = useFormatter()

  return (
    <Link
      href="/pricing"
      title={t("header.creditsTitle", {
        credits: t("common.credits", { count: credits }),
        plan: t(`plans.${plan}.name`),
      })}
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-500/10 px-3 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-500/15"
    >
      <CoinsIcon className="size-4" />
      {format.number(credits, "integer")}
      <span className="sr-only sm:not-sr-only">{t("header.creditsUnit", { count: credits })}</span>
    </Link>
  )
}

function UserMenu({ user }: { user: SessionUser }) {
  const t = useTranslations("header")
  const { signOut } = useAuth()
  const [signingOut, setSigningOut] = React.useState(false)
  const { name, email, image, plan } = user
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={t("accountMenu")}
      >
        <Avatar size="lg" className="size-10 ring-2 ring-white">
          {image && <AvatarImage src={image} alt={name} />}
          <AvatarFallback className="bg-linear-to-br from-indigo-100 to-violet-100 font-medium text-violet-700">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-2xl">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">
              {name}
            </p>
            <p className="truncate text-xs font-normal">{email}</p>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="py-2" render={<Link href="/pricing" />}>
          <SparklesIcon />
          {plan === "pro" ? t("managePro") : t("upgradePro")}
        </DropdownMenuItem>
        <DropdownMenuItem className="py-2" render={<Link href="/billing" />}>
          <GaugeIcon />
          {t("usageBilling")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="py-2"
          render={<Link href="/#projects" />}
        >
          <FolderIcon />
          {t("myProjects")}
        </DropdownMenuItem>
        <DropdownMenuItem className="py-2">
          <SettingsIcon />
          {t("settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="py-2"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true)
            await signOut()
            setSigningOut(false)
          }}
        >
          {signingOut ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
