import { describe, expect, it } from "vitest"

import { plannerInstructions, type PlannerState } from "@/lib/agent/instructions"

function state(overrides: Partial<PlannerState> = {}) {
  return {
    status: "planning",
    platform: "ios",
    plan: null,
    builtScreens: 0,
    rows: [],
    assetNames: [],
    backend: { available: false },
    account: { plan: "free", credits: 10 },
    services: [],
    integrations: true,
    ...overrides,
  } as unknown as PlannerState
}

describe("the interview instructions", () => {
  const text = plannerInstructions(state())

  it("aim for 95% sure, with confidence deciding rather than a count", () => {
    expect(text).toContain("about 95% sure")
    expect(text).toContain("never more than ten")
    expect(text).toContain("After the tenth answer, plan")
    expect(text).not.toContain("Three answers are required before the first plan")
    expect(text).not.toContain("at most five")
  })

  it("settle where the main content comes from and the outside services", () => {
    expect(text).toContain("where the app's main content comes from")
    expect(text).toContain("Where the main content comes from:")
    expect(text).toContain("- Outside services: when a key feature needs one")
  })

  it("ask for an honest confidence and every open decision", () => {
    expect(text).toContain("report your honest `confidence` and every `openDecisions` item")
    expect(text).toContain("until the tenth answer")
  })

  it("keep the unchanged interview rules", () => {
    expect(text).toContain("A detailed first message is not a finished plan")
    expect(text).toContain("Don't ask about the name, colors, visual style, or sign-in")
  })

  it("add the planning rules about made-up content", () => {
    expect(text).toContain("Never fill the app's main content with made-up data")
    expect(text).toContain("sample data until the feed is connected")
    expect(text).toContain("name the content source and each outside service in your bullets")
  })

  it("describe the phase", () => {
    expect(text).toContain("after at most 10")
  })
})
