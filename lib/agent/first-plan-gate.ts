/** Answers required before the first plan, one question per reply. */
export const MIN_INTERVIEW_REPLIES = 3

/** A safety net: how many questions the interview may take before the plan is allowed, even if confidence is low or an earlier attempt this turn was refused. */
export const MAX_INTERVIEW_REPLIES = 10

/** How sure the planner must be, from 0 to 100, before the first plan. */
export const MIN_CONFIDENCE = 95

const MAX_OPEN_DECISIONS = 5
const MAX_OPEN_DECISION_LENGTH = 200

type FirstPlanGate = {
  hasPlan: boolean
  declined: boolean
  replies: number
  blocked?: boolean
  confidence: number
  openDecisions: string[]
}

/** Why the first plan can't be shown yet, or null when it can. Revisions, a person who declined the interview, and an interview that has already reached the reply cap are never held back. */
export function firstPlanGate({ hasPlan, declined, replies, blocked = false, confidence, openDecisions }: FirstPlanGate): string | null {
  if (hasPlan || declined || replies >= MAX_INTERVIEW_REPLIES) return null

  if (replies < MIN_INTERVIEW_REPLIES || blocked) {
    const remaining = MIN_INTERVIEW_REPLIES - replies
    const left = remaining > 0 ? ` ${remaining} more ${remaining === 1 ? "answer is" : "answers are"} required before the first plan.` : ""
    return `Plan not saved. Ask exactly one question now.${left} Don't call propose_plan again in this turn.`
  }

  const open = openDecisions
    .map((decision) => decision.trim().slice(0, MAX_OPEN_DECISION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_OPEN_DECISIONS)
  const sure = Number.isFinite(confidence) && confidence >= MIN_CONFIDENCE
  if (sure && open.length === 0) return null

  return `Plan not saved. You're not sure enough yet. Ask exactly one question about the most important of these: ${open.join("; ") || "what's still unclear"}. Don't call propose_plan again in this turn.`
}
