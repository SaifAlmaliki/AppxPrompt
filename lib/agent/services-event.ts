import type { AgentEvent } from "@/lib/agent-protocol"
import type { ServiceSummary } from "@/lib/services/protocol"

/** Tells the workspace which services are left. The changes are saved by now, so a failure here must never stop the build. */
export async function emitServices(
  emit: (event: AgentEvent) => void,
  list: () => Promise<ServiceSummary[]>,
): Promise<void> {
  try {
    emit({ type: "services", services: await list() })
  } catch (cause) {
    console.error(`Listing services after a change failed (${cause instanceof Error ? cause.name : "Error"}).`)
  }
}

