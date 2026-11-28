/** What a planner turn may spend. The agent route is killed at 300 seconds, so the turn stops well before. */
export const PLANNER_TURN_BUDGET_MS = 240_000

/** A hard stop for a run still going after the budget, so the reply can be saved before the platform kills the request. */
export const PLANNER_HARD_STOP_MS = PLANNER_TURN_BUDGET_MS + 30_000

/** A tool called with less than this left does nothing. */
export const TOOL_MIN_TIME_MS = 45_000

/** A second run, after the model wrote a tool call out as text, needs at least this much. */
export const RETRY_MIN_TIME_MS = 90_000

/** Model-facing, so English. */
export const OUT_OF_TIME =
  'Out of time for this turn. Don\'t call any more tools. Reply now in one or two sentences with what you\'ve done so far and what\'s left, and say they can reply "continue".'

export type TurnClock = { turnStartedAt?: number }

/** Milliseconds left of the turn's budget. A context with no start time has no budget. */
export function turnTimeLeft(ctx: TurnClock, now = Date.now()): number {
  if (ctx.turnStartedAt === undefined) return Number.POSITIVE_INFINITY
  return PLANNER_TURN_BUDGET_MS - (now - ctx.turnStartedAt)
}

/** True when a tool should do nothing and tell the model to wrap up. */
export function outOfTime(ctx: TurnClock, now = Date.now()): boolean {
  return turnTimeLeft(ctx, now) < TOOL_MIN_TIME_MS
}

export function canRetry(ctx: TurnClock, now = Date.now()): boolean {
  return turnTimeLeft(ctx, now) >= RETRY_MIN_TIME_MS
}

/** What is saved when the run was stopped: the text streamed so far, or the fallback when there was none. */
export function stoppedReply(streamed: string, fallback: string): string {
  return streamed.trim() || fallback
}

type TurnOutcome = {
  stopped: boolean
  text: string
  failedCall: boolean
  confirmed: boolean
  changes: boolean
  proposedPlan: boolean
}

type TurnWords = Record<"turnStopped" | "noReply" | "planStarting" | "changesStarting" | "planProposed", string>

/**
 * What the turn's assistant message says. A stopped turn that already confirmed the plan or queued
 * changes still starts that work, so it says so rather than asking the person to continue.
 */
export function turnReply({ stopped, text, failedCall, confirmed, changes, proposedPlan }: TurnOutcome, words: TurnWords): string {
  const started = confirmed ? words.planStarting : changes ? words.changesStarting : null
  if (stopped) return started ? text.trim() || started : stoppedReply(text, words.turnStopped)
  const reply = failedCall ? [text.trim(), words.noReply].filter(Boolean).join("\n\n") : text.trim()
  return reply || started || (proposedPlan ? words.planProposed : words.noReply)
}
