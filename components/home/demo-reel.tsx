"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const DEMO_SRC = "/media/appxprompt-demo.mp4"
const POSTER_SRC = "/media/appxprompt-demo-poster.jpg"

type StartState = "pending" | "ready" | "blocked"

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const remain = whole % 60
  return `${minutes}:${remain.toString().padStart(2, "0")}`
}

export function DemoReel() {
  const t = useTranslations("home.demo")
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const heardRef = React.useRef(false)
  const resumeRef = React.useRef(false)
  const pausedByUser = React.useRef(false)
  const [start, setStart] = React.useState<StartState>("pending")
  const [playing, setPlaying] = React.useState(false)
  const [muted, setMuted] = React.useState(true)
  const [loop, setLoop] = React.useState(true)
  const [current, setCurrent] = React.useState(0)
  const [duration, setDuration] = React.useState(0)

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (Number.isFinite(video.duration)) setDuration(video.duration)

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      setStart("blocked")
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          if (!video.paused) video.pause()
          return
        }
        if (pausedByUser.current) return
        video.preload = "auto"
        const attempt = video.play()
        if (!attempt) {
          setStart("blocked")
          return
        }
        attempt.then(() => setStart("ready")).catch(() => setStart("blocked"))
      },
      { threshold: 0.35 }
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function onVisibility() {
      if (!video) return
      if (document.hidden) {
        if (!video.paused) {
          resumeRef.current = true
          video.pause()
        }
        return
      }
      if (resumeRef.current) {
        resumeRef.current = false
        void video.play()
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  // Browsers only allow autoplay while muted. The film has a voiceover, so the
  // first unmute restarts the clip and the narration is heard from the start.
  function playFromGesture(withSound: boolean) {
    const video = videoRef.current
    if (!video) return
    resumeRef.current = false
    pausedByUser.current = false
    if (video.ended) video.currentTime = 0

    if (withSound) {
      video.loop = false
      video.muted = false
      setLoop(false)
      setMuted(false)
      if (!heardRef.current) {
        video.currentTime = 0
        heardRef.current = true
      }
    }

    void video.play().then(() => setStart("ready")).catch(() => setStart("blocked"))
  }

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      playFromGesture(false)
      return
    }
    resumeRef.current = false
    pausedByUser.current = true
    video.pause()
  }

  function toggleSound() {
    const video = videoRef.current
    if (!video) return
    if (video.muted) {
      playFromGesture(true)
      return
    }
    video.muted = true
    video.loop = true
    setMuted(true)
    setLoop(true)
  }

  function onSeek(value: number) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = value
    setCurrent(value)
  }

  const showOverlay = !playing && start !== "pending"
  const firstPlay = start === "blocked" && !heardRef.current

  return (
    <figure className="relative mx-auto w-full">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-4 -inset-y-6 -z-10 rounded-[3rem] bg-linear-to-r from-indigo-400/30 via-fuchsia-300/25 to-violet-400/30 blur-3xl"
      />
      <div className="overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/85 p-1.5 shadow-[0_30px_80px_-36px_rgba(76,29,149,0.55)] backdrop-blur-xl sm:rounded-[2rem] sm:p-2">
        <div className="relative aspect-video overflow-hidden rounded-[1.25rem] bg-[#f6f3ff] sm:rounded-[1.45rem]">
          <video
            ref={videoRef}
            className="size-full cursor-pointer object-cover"
            poster={POSTER_SRC}
            src={DEMO_SRC}
            width={1920}
            height={1080}
            muted={muted}
            playsInline
            loop={loop}
            preload="metadata"
            aria-label={t("label")}
            aria-describedby="demo-caption"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              const video = event.currentTarget
              setCurrent(video.currentTime)
              if (Number.isFinite(video.duration)) setDuration(video.duration)
            }}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
            onClick={togglePlay}
          />

          {showOverlay && (
            <button
              type="button"
              onClick={() => (firstPlay ? playFromGesture(true) : togglePlay())}
              aria-label={firstPlay ? undefined : t("play")}
              className="absolute inset-0 flex items-center justify-center bg-linear-to-t from-violet-950/25 via-transparent to-transparent focus-visible:outline-none"
            >
              <span className="flex flex-col items-center gap-3">
                <span className="flex size-16 items-center justify-center rounded-full bg-white text-violet-700 shadow-[0_16px_40px_-12px_rgba(76,29,149,0.65)]">
                  <PlayIcon className="size-7 translate-x-0.5" />
                </span>
                {firstPlay && (
                  <span className="rounded-full bg-white/95 px-3.5 py-1.5 text-sm font-medium text-violet-700 shadow-lg">
                    {t("playWithSound")}
                  </span>
                )}
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 px-1 pt-2 pb-0.5 sm:px-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? t("pause") : t("play")}
            onClick={togglePlay}
            className="rounded-full text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>

          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || 0)}
            disabled={!duration}
            aria-label={t("seek")}
            dir="ltr"
            onChange={(event) => onSeek(Number(event.target.value))}
            className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-violet-100 accent-violet-600 disabled:opacity-40"
          />

          <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
            {formatClock(current)}/{formatClock(duration)}
          </span>

          <Button
            type="button"
            size="sm"
            aria-label={muted ? undefined : t("mute")}
            aria-pressed={!muted}
            onClick={toggleSound}
            className={cn(
              "rounded-full",
              muted
                ? "bg-linear-to-r from-indigo-500 to-fuchsia-500 px-3 text-white shadow-md shadow-violet-500/30 hover:opacity-95"
                : "bg-muted/70 text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
            )}
          >
            {muted ? <Volume2Icon /> : <VolumeXIcon />}
            {muted && <span>{t("soundOn")}</span>}
          </Button>
        </div>
      </div>
    </figure>
  )
}
