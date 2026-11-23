import { describe, expect, it } from "vitest"

import { reducer, type AgentState } from "@/hooks/use-project-agent"
import { activityOf, statusEvent, type AgentEvent, type StatusKey } from "@/lib/agent-protocol"
import { activityText, isolate } from "@/lib/i18n/activity"
import { translatorFor } from "@/lib/i18n/server"
import ar from "@/messages/ar.json"
import en from "@/messages/en.json"

import { strictTranslator } from "./strict-translator"

const idle: AgentState = {
  messages: [],
  status: "building",
  plan: null,
  screens: [],
  backend: { accountConnected: false, state: "disconnected", services: [], error: null } as unknown as AgentState["backend"],
  services: [],
  serviceRequest: null,
  busy: true,
  activity: "Reading your request…",
  streamingText: "",
  reasoning: "",
  error: null,
  sessionRestarted: false,
}

const apply = (event: AgentEvent, state = idle) => reducer(state, { type: "event", event })

describe("the status event in the agent state", () => {
  it("keeps an old saved label as it is", () => {
    expect(apply({ type: "status", label: "Designing Home…" }).activity).toBe("Designing Home…")
  })

  it("keeps a key with its values", () => {
    expect(apply({ type: "status", key: "designingScreen", values: { name: "Home" } }).activity).toEqual({
      key: "designingScreen",
      values: { name: "Home" },
    })
  })

  it("keeps a key that has no values", () => {
    expect(apply(statusEvent("thinking")).activity).toEqual({ key: "thinking" })
  })

  it("clears the activity when there is neither label nor key", () => {
    expect(apply({ type: "status", label: null }).activity).toBeNull()
    expect(apply({ type: "status" }).activity).toBeNull()
  })

  it("prefers the key when an event has both", () => {
    expect(activityOf({ key: "thinking", label: "Thinking…" })).toEqual({ key: "thinking" })
  })
})

describe("status messages", () => {
  const keys = Object.keys(en.status) as StatusKey[]
  const values = { name: "Home", position: 2, total: 5, count: 3 }

  it("have the same keys in both languages", () => {
    expect(Object.keys(ar.status).sort()).toEqual([...keys].sort())
  })

  it.each(["en", "ar"] as const)("every key renders in %s", (locale) => {
    const t = strictTranslator(locale, "status")
    for (const key of keys) {
      const text = t(key, values)
      expect(text, key).not.toBe(`status.${key}`)
      expect(text, key).toBeTruthy()
      expect(text, key).not.toMatch(/[{}]/)
    }
  })

  it("words a key in English as the code did", () => {
    const t = translatorFor("en", "status") as unknown as (key: StatusKey, values?: object) => string
    const words = (key: StatusKey, v?: Record<string, string | number>) => activityText(t, v ? { key, values: v } : { key }, "en")
    expect(words("thinking")).toBe("Thinking…")
    expect(words("draftingPlan")).toBe("Drafting the screen plan…")
    expect(words("preparingBuild", { count: 6 })).toBe("Preparing to build 6 screens…")
    expect(words("settingUpBackend")).toBe("Setting up your backend…")
    expect(words("creatingBackendProject")).toBe("Creating your CloudHike project…")
  })

  it("adds no direction marks to English text", () => {
    const t = translatorFor("en", "status") as unknown as (key: StatusKey, values?: object) => string
    const text = activityText(t, { key: "designingScreen", values: { name: "Home", position: 1, total: 4 } }, "en")
    expect(text).toContain("Home")
    expect(text).not.toMatch(/[\u2068\u2069]/)
  })

  it("keeps a screen name in its own direction in Arabic", () => {
    const t = translatorFor("ar", "status") as unknown as (key: StatusKey, values?: object) => string
    const text = activityText(t, { key: "designingScreen", values: { name: "Home", position: 1, total: 4 } }, "ar")
    expect(text).toContain(isolate("Home"))
    expect(text).toMatch(/\p{Script=Arabic}/u)
  })

  it("shows an old saved label as it is", () => {
    const t = translatorFor("ar", "status") as unknown as (key: StatusKey) => string
    expect(activityText(t, "Designing Home (1 of 4)…", "ar")).toBe("Designing Home (1 of 4)…")
  })
})

describe("agent messages", () => {
  const keys = Object.keys(en.agentMessages)

  it("have the same keys in both languages", () => {
    expect(Object.keys(ar.agentMessages).sort()).toEqual([...keys].sort())
  })

  it("start with the same text as the message the client shows while confirming", () => {
    expect(en.agentMessages.confirm).toBe(en.chat.confirmMessage)
    expect(ar.agentMessages.confirm).toBe(ar.chat.confirmMessage)
  })

  it("keep the English words of the fixed messages", () => {
    const t = translatorFor("en", "agentMessages")
    expect(t("onIt", { count: 3, name: "Home" })).toBe("On it! I'll build the 3 screens one at a time, starting with Home.")
    expect(t("planStarting")).toBe("Starting the build now.")
    expect(t("noReply")).toBe("Sorry, I couldn't come up with a reply. Could you say that again?")
    expect(t("refund", { credits: 12 })).toBe("I returned the 12 credits for what didn't finish.")
    expect(t("buildStopped")).toBe('The build stopped before it finished. Say "try again" and I\'ll pick up where it left off.')
    expect(t("buildStartFailed")).toBe("Couldn't start the build. Please try again.")
    expect(t("changesSummary", { what: "I added A.", missed: "" })).toBe(
      "All done! I added A. Have a look in the preview, and tell me if you'd like anything else changed."
    )
    expect(t("ready", { appName: "Zest", count: 2, names: "Home, List", backendNote: " Saved." })).toBe(
      "Zest is ready! I built all 2 screens: Home, List.\n\nTap through the app in the preview, and try other looks from the Theme menu at the top of the canvas. Saved."
    )
  })

  it.each(["en", "ar"] as const)("every message renders in %s", (locale) => {
    const t = strictTranslator(locale, "agentMessages")
    const values = { count: 3, name: "Home", appName: "Zest", names: "A, B", backendNote: "", message: "x", credits: 5, refundNote: "", built: 1, total: 3, rest: "A", last: "B", parts: "x", what: "x", missed: "" }
    for (const key of keys) {
      const text = t(key, values)
      expect(text, key).not.toBe(`agentMessages.${key}`)
      expect(text, key).toBeTruthy()
      expect(text, key).not.toMatch(/\{[a-zA-Z]/)
    }
  })

  it("answers in Arabic with its plural forms", () => {
    const t = translatorFor("ar", "agentMessages")
    expect(t("onIt", { count: 2, name: "Home" })).toContain("شاشتين")
    expect(t("onIt", { count: 7, name: "Home" })).toContain("7 شاشات")
    expect(t("refund", { credits: 1 })).toContain("نقطة واحدة")
  })
})
