// Now and then the model writes a tool call out as text ("<update_app><parameter name=…>")
// instead of calling the tool, so nothing happens. This finds that text, so the chat never
// shows it and the planner can ask the model again.

const TOOL_NAMES = ["update_app", "propose_plan", "confirm_plan", "set_theme", "setup_backend", "request_backend", "register_service", "web_search", "read_page", "read_service_notes", "add_service_lesson"]

const LEAK = new RegExp(`<(?:(${TOOL_NAMES.join("|")})\\b|invoke\\s+name="([^"]*)"|function_calls\\b|parameter\\s+name=)`)

/** How far back an unclosed "<" is held, in case it's the start of a call. */
const HOLD = 64

/** The reply up to a call written as text, and the tool it names ("" if it names none). `tool` is null when there's no such call. */
export function findLeakedToolCall(text: string): { visible: string; tool: string | null } {
  const match = LEAK.exec(text)
  if (!match) return { visible: text, tool: null }
  return { visible: text.slice(0, match.index).trimEnd(), tool: match[1] ?? match[2] ?? "" }
}

/**
 * Passes streamed text through, holding back anything that could be the start of a call
 * written as text. Once one shows up, nothing more is let through.
 */
export function createLeakFilter() {
  let pending = ""
  let leaked: string | null = null

  return {
    get leaked() {
      return leaked
    },
    push(delta: string) {
      if (leaked !== null) return ""
      pending += delta
      const match = LEAK.exec(pending)
      if (match) {
        leaked = match[1] ?? match[2] ?? ""
        const shown = pending.slice(0, match.index)
        pending = ""
        return shown
      }
      const open = pending.lastIndexOf("<")
      const holdFrom = open !== -1 && !pending.includes(">", open) && pending.length - open < HOLD ? open : pending.length
      const shown = pending.slice(0, holdFrom)
      pending = pending.slice(holdFrom)
      return shown
    },
    flush() {
      if (leaked !== null) return ""
      const rest = pending
      pending = ""
      return rest
    },
  }
}
