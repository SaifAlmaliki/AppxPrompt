import { describe, expect, it, vi } from "vitest"

import { isolate } from "@/lib/i18n/activity"
import ar from "@/messages/ar.json"

vi.mock("@openai/agents", () => ({ Agent: class {}, assistant: vi.fn(), run: vi.fn(), user: vi.fn() }))
vi.mock("@/db", () => ({ db: {}, messages: {}, projects: {}, screens: {} }))
vi.mock("@/lib/agent/changes", () => ({ mergePlan: vi.fn() }))
vi.mock("@/lib/agent/components", () => ({ generateComponents: vi.fn(), writeComponent: vi.fn() }))
vi.mock("@/lib/agent/config", () => ({ BUILDER_MODEL: "test", configureAgents: vi.fn() }))
vi.mock("@/lib/agent/foundation", () => ({ changeCollections: vi.fn(), generateFoundation: vi.fn() }))
vi.mock("@/lib/agent/instructions", () => ({ BUILDER_INSTRUCTIONS: "", builderPrompt: vi.fn() }))
vi.mock("@/lib/agent/builds", () => ({ BuildLostError: class extends Error {} }))
vi.mock("@/lib/agent/validate-screen", () => ({ fatalScreenProblem: vi.fn(), screenProblems: vi.fn(), visibleCode: vi.fn() }))
vi.mock("@/lib/billing/credits", () => ({ refundUnfinishedBuild: vi.fn() }))
vi.mock("@/lib/cloudhike/backend", () => ({ isBackendLinked: vi.fn(), setUpBackend: vi.fn() }))
vi.mock("@/lib/imagekit", () => ({ fillGeneratedImages: vi.fn(), hasGeneratedImages: vi.fn() }))

const { changesSummary, listNames } = await import("@/lib/agent/builder")

const TAIL = "Have a look in the preview, and tell me if you'd like anything else changed."

describe("listNames", () => {
  it("joins names the way the English message did", () => {
    expect(listNames([], "en")).toBe("")
    expect(listNames(["A"], "en")).toBe("A")
    expect(listNames(["A", "B"], "en")).toBe("A and B")
    expect(listNames(["A", "B", "C"], "en")).toBe("A, B and C")
  })

  it("joins names in Arabic with the Arabic comma and و", () => {
    expect(listNames(["أ", "ب"], "ar")).toBe("أ وب")
    expect(listNames(["أ", "ب", "ج"], "ar")).toBe("أ، ب وج")
  })
})

describe("changesSummary in English", () => {
  it("words each kind of change as before", () => {
    expect(changesSummary({ added: ["A"], updated: ["B"], removed: [] } as never, "en")).toBe(`All done! I added A and updated B. ${TAIL}`)
    expect(changesSummary({ added: ["A", "B", "C"], updated: ["D"], removed: ["E", "F"] } as never, "en")).toBe(
      `All done! I added A, B and C, updated D and removed E and F. ${TAIL}`
    )
  })

  it("says the changes are in when there is nothing to list", () => {
    expect(changesSummary({ added: [], updated: [], removed: [] } as never, "en")).toBe(`All done! Your changes are in. ${TAIL}`)
  })

  it("names what couldn't be changed, in singular and plural", () => {
    expect(changesSummary({ added: [], updated: ["B"], removed: [], failed: ["X"] } as never, "en")).toBe(
      `All done! I updated B. I couldn't change X, so it's still as before. Ask me again if you'd still like that. ${TAIL}`
    )
    expect(changesSummary({ added: ["A"], updated: [], removed: [], failed: ["X", "Y"] } as never, "en")).toBe(
      `All done! I added A. I couldn't change X and Y, so they're still as before. Ask me again if you'd still like that. ${TAIL}`
    )
  })

  it("adds no direction marks", () => {
    const text = changesSummary({ added: ["A"], updated: ["B"], removed: ["C"], failed: ["D"] } as never, "en")
    expect(text).not.toMatch(/[\u2068\u2069]/)
  })
})

describe("changesSummary in Arabic", () => {
  it("uses the Arabic messages and keeps each name in its own direction", () => {
    const text = changesSummary({ added: ["Home"], updated: ["List", "Card"], removed: [], failed: ["Map"] } as never, "ar")
    expect(text).toContain(`أضفتُ ${isolate("Home")}`)
    expect(text).toContain(`حدّثتُ ${isolate("List")} و${isolate("Card")}`)
    expect(text).toContain(`تعذّر عليّ تغيير ${isolate("Map")}`)
    expect(text.startsWith(ar.agentMessages.changesSummary.slice(0, 8))).toBe(true)
    expect(text).not.toMatch(/\b(?:added|updated|removed|All done)\b/)
  })

  it("says the changes are in when there is nothing to list", () => {
    expect(changesSummary({ added: [], updated: [], removed: [] } as never, "ar")).toContain(ar.agentMessages.changesNone)
  })
})
