import { describe, expect, it } from "vitest"

import { reducer, type AgentState } from "@/hooks/use-project-agent"
import type { ProjectServerRoute } from "@/lib/agent-protocol"

const route = (path: string, extra: Partial<ProjectServerRoute> = {}): ProjectServerRoute => ({
  path,
  kind: "function",
  purpose: "p",
  status: "pending",
  code: null,
  ...extra,
})

const start = {
  messages: [],
  status: "building",
  plan: null,
  screens: [],
  serverRoutes: [route("app/api/a+api.ts")],
  services: [],
  serviceRequests: [],
  backendRequest: null,
  busy: true,
  activity: null,
  streamingText: "",
  reasoning: "",
  error: null,
  sessionRestarted: false,
} as unknown as AgentState

describe("server route events", () => {
  it("replaces the list on server-routes", () => {
    const next = reducer(start, { type: "event", event: { type: "server-routes", routes: [route("app/api/b+api.ts")] } })
    expect(next.serverRoutes.map((r) => r.path)).toEqual(["app/api/b+api.ts"])
  })

  it("updates a route by path on server-route", () => {
    const done = route("app/api/a+api.ts", { status: "done", code: "x" })
    const next = reducer(start, { type: "event", event: { type: "server-route", route: done } })
    expect(next.serverRoutes).toEqual([done])
  })

  it("adds a route it didn't know", () => {
    const next = reducer(start, { type: "event", event: { type: "server-route", route: route("app/api/b+api.ts") } })
    expect(next.serverRoutes.map((r) => r.path)).toEqual(["app/api/a+api.ts", "app/api/b+api.ts"])
  })
})
