import { describe, expect, it } from "vitest"

import { reducer, type AgentState } from "@/hooks/use-project-agent"
import type { AgentEvent } from "@/lib/agent-protocol"
import type { ServiceSummary } from "@/lib/services/protocol"

function service(slug: string, status: ServiceSummary["status"] = "missing"): ServiceSummary {
  return {
    slug,
    name: slug,
    purpose: "something",
    docsUrl: "https://example.com",
    authKind: "api_key",
    allowedHosts: ["api.example.com"],
    setupSteps: "",
    status,
    checkResult: null,
    checkedAt: null,
    fields: [],
    oauthConnected: false,
  }
}

const start: AgentState = {
  messages: [],
  status: "planning",
  plan: null,
  screens: [],
  backend: { accountConnected: false, state: "disconnected", services: [], error: null } as unknown as AgentState["backend"],
  services: [service("openai")],
  serviceRequest: null,
  busy: false,
  activity: null,
  streamingText: "",
  reasoning: "",
  error: null,
  sessionRestarted: false,
}

describe("services in the agent state", () => {
  it("replaces the list on a services event", () => {
    const next = reducer(start, { type: "event", event: { type: "services", services: [service("resend")] } })
    expect(next.services.map((s) => s.slug)).toEqual(["resend"])
  })

  it("remembers a service request until it is handled", () => {
    const asked = reducer(start, { type: "event", event: { type: "service-request", slug: "openai" } })
    expect(asked.serviceRequest).toBe("openai")
    expect(reducer(asked, { type: "service-request-handled" }).serviceRequest).toBeNull()
  })

  it("ignores an event type it doesn't know, so an old tab keeps working", () => {
    const future = { type: "from-the-future", value: 1 } as unknown as AgentEvent
    expect(reducer(start, { type: "event", event: future })).toBe(start)
  })

  it("upserts and removes a changed service", () => {
    const added = reducer(start, { type: "service-changed", slug: "resend", summary: service("resend") })
    expect(added.services.map((s) => s.slug)).toEqual(["openai", "resend"])
    const updated = reducer(added, { type: "service-changed", slug: "openai", summary: service("openai", "connected") })
    expect(updated.services.map((s) => s.status)).toEqual(["connected", "missing"])
    const removed = reducer(updated, { type: "service-changed", slug: "openai", summary: null })
    expect(removed.services.map((s) => s.slug)).toEqual(["resend"])
  })
})
