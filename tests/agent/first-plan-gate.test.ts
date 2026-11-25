import { describe, expect, it } from "vitest"

import { firstPlanGate, MAX_INTERVIEW_REPLIES } from "@/lib/agent/first-plan-gate"

const ask = { hasPlan: false, declined: false, replies: 3, confidence: 100, openDecisions: [] as string[] }

describe("firstPlanGate", () => {
  it("refuses a first plan that isn't sure enough and names what is open", () => {
    const result = firstPlanGate({ ...ask, confidence: 80, openDecisions: ["Where trends come from"] })
    expect(result).toBe(
      "Plan not saved. You're not sure enough yet. Ask exactly one question about the most important of these: Where trends come from. Don't call propose_plan again in this turn."
    )
  })

  it("refuses when confident but a decision is still open", () => {
    expect(firstPlanGate({ ...ask, openDecisions: ["Which video model"] })).toContain("Which video model")
  })

  it("falls back to a general line when low confidence names nothing", () => {
    expect(firstPlanGate({ ...ask, confidence: 70 })).toContain("what's still unclear")
  })

  it("allows a plan at 95 or more with nothing open", () => {
    expect(firstPlanGate({ ...ask, confidence: 96 })).toBeNull()
    expect(firstPlanGate({ ...ask, confidence: 95 })).toBeNull()
  })

  it("treats a confidence that isn't a number as unsure", () => {
    expect(firstPlanGate({ ...ask, confidence: Number.NaN })).toContain("not sure enough")
  })

  it("keeps asking until the tenth answer, then allows the plan even if the interview is blocked", () => {
    expect(MAX_INTERVIEW_REPLIES).toBe(10)
    expect(firstPlanGate({ ...ask, replies: 9, confidence: 80 })).toContain("not sure enough")
    expect(firstPlanGate({ ...ask, replies: 9, blocked: true, confidence: 100 })).toContain("Ask exactly one question now")
    expect(firstPlanGate({ ...ask, replies: 10, confidence: 60, openDecisions: ["x"] })).toBeNull()
    expect(firstPlanGate({ ...ask, replies: 10, blocked: true, confidence: 60, openDecisions: ["x"] })).toBeNull()
  })

  it("still requires the first three answers, and stays blocked once refused", () => {
    expect(firstPlanGate({ ...ask, replies: 1 })).toContain("2 more answers are required")
    expect(firstPlanGate({ ...ask, replies: 2 })).toContain("1 more answer is required")
    expect(firstPlanGate({ ...ask, replies: 4, blocked: true })).toBe("Plan not saved. Ask exactly one question now. Don't call propose_plan again in this turn.")
  })

  it("never holds back a revision or a person who told it to decide", () => {
    expect(firstPlanGate({ ...ask, hasPlan: true, replies: 0, confidence: 10, openDecisions: ["x"] })).toBeNull()
    expect(firstPlanGate({ ...ask, declined: true, replies: 0, confidence: 10, openDecisions: ["x"] })).toBeNull()
  })

  it("caps and trims the open decisions it names", () => {
    const many = Array.from({ length: 8 }, (_, n) => `d${n}`)
    const result = firstPlanGate({ ...ask, openDecisions: [" a ", "", ...many, "z".repeat(300)] })!
    expect(result).toContain("a; d0; d1; d2; d3.")
    expect(result).not.toContain("d4")
  })
})
