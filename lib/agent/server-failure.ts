import { failurePath, messageWithElement, messageWithFailure, type ElementContext, type ServerFailureContext } from "@/lib/agent-protocol"
import { sanitizeDiagnostic } from "@/lib/sandbox/diagnostic"
import { redactKeys } from "@/lib/services/key-patterns"

/** The failure a client sent, rebuilt from checked parts only: the diagnostic is checked again and any key in its error text is taken out. */
export function readServerFailure(value: unknown): ServerFailureContext | null {
  const failure = value as Partial<ServerFailureContext> | null | undefined
  if (!failure || typeof failure !== "object") return null
  const { path, status } = failure
  if (typeof path !== "string" || !failurePath(path)) return null
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) return null
  const diagnostic = sanitizeDiagnostic(failure.diagnostic)
  if (!diagnostic) return null
  if (diagnostic.thrown) {
    diagnostic.thrown = { name: redactKeys(diagnostic.thrown.name).text, message: redactKeys(diagnostic.thrown.message).text }
  }
  return { path: failurePath(path), status, diagnostic }
}

/** The message as it is saved: with the selected element in front of it, or else the failure the client sent. Never both. */
export function storedUserMessage(content: string, element: ElementContext | null, failure: unknown): string {
  if (element) return messageWithElement(content, element)
  const checked = readServerFailure(failure)
  return checked ? messageWithFailure(content, checked) : content
}
