import { describe, expect, it } from "vitest"

import { servicesDescription } from "@/lib/agent/instructions"
import { plannerServices } from "@/lib/services/status"
import type { ServiceSummary } from "@/lib/services/protocol"

function google(): ServiceSummary {
  return {
    slug: "google-calendar",
    name: "Google Calendar",
    purpose: "Read events",
    docsUrl: "https://developers.google.com/calendar",
    authKind: "oauth2",
    allowedHosts: ["www.googleapis.com"],
    setupSteps: "",
    status: "missing",
    checkResult: null,
    checkedAt: null,
    fields: [
      { name: "GOOGLE_CALENDAR_CLIENT_ID", label: "Client ID", kind: "public", help: "", set: true, hint: "abc" },
      { name: "GOOGLE_CALENDAR_CLIENT_SECRET", label: "Client secret", kind: "secret", help: "", set: false, hint: null },
    ],
    oauthConnected: false,
  }
}

describe("servicesDescription", () => {
  it("says when no services are set up", () => {
    expect(servicesDescription([])).toBe("No outside services are set up.")
  })

  it("lists each service with its status and which fields are set", () => {
    expect(servicesDescription(plannerServices([google()]))).toBe(
      "- Google Calendar (google-calendar): missing. Fields: GOOGLE_CALENDAR_CLIENT_ID set, GOOGLE_CALENDAR_CLIENT_SECRET not set.",
    )
  })
})
