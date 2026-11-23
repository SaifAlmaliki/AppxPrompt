import type { Agent, RunErrorHandlers } from "@openai/agents"

/**
 * Running out of turns ends the run quietly instead of throwing, so the text already streamed
 * and anything the agent proposed in its tools are kept and the caller's usual fallback applies.
 */
export const endRunAtMaxTurns: RunErrorHandlers<any, Agent<any, any>> = {
  maxTurns: () => ({ finalOutput: "", includeInHistory: false }),
}