import { describe, expect, it } from "vitest"

import { storedError, translatorFor } from "@/lib/i18n/server"
import { applicationFailure, failureText, storeFailure } from "@/lib/publish/errors"

const en = translatorFor("en", "errors")
const ar = translatorFor("ar", "errors")

describe("persisted publish errors", () => {
  it("translates the same stored application failure for each reader", () => {
    for (const key of ["buildNoFile", "buildCancelled", "buildErrored", "buildNeverReached", "buildExpoDisconnected", "buildTokenRejected", "buildStartFailed", "publishCancelled", "publishFailed", "publishNeverReached", "publishExpoDisconnected", "publishTokenRejected", "publishStartFailed"] as const) {
      const stored = storeFailure(applicationFailure(key))
      expect(stored).not.toContain(en(key))
      expect(failureText(stored, en)).toBe(en(key))
      expect(failureText(stored, ar)).toBe(ar(key))
      expect(failureText(stored, ar)).not.toBe(en(key))
    }
  })

  it("keeps interpolation values until the response is translated", () => {
    const stored = storeFailure(applicationFailure("expoAnswered", { status: 503 }))
    expect(failureText(stored, ar)).toBe(ar("expoAnswered", { status: 503 }))
  })

  it("preserves provider details even when they look like application keys or envelopes", () => {
    for (const detail of ["buildCancelled", "errors.buildCancelled", storeFailure(applicationFailure("buildCancelled")), "Provider could not sign the app"]) {
      const stored = storeFailure({ source: "provider", detail })
      expect(failureText(stored, en)).toBe(detail)
      expect(failureText(stored, ar)).toBe(detail)
    }
  })

  it("reads application errors written by the remote branch", () => {
    const stored = storedError("expoAnswered", { status: 503 })
    expect(failureText(stored, en)).toBe(en("expoAnswered", { status: 503 }))
    expect(failureText(stored, ar)).toBe(ar("expoAnswered", { status: 503 }))
    const provider = storeFailure({ source: "provider", detail: stored })
    expect(failureText(provider, ar)).toBe(stored)
  })

  it("preserves legacy text and null errors", () => {
    expect(failureText("The build was cancelled.", ar)).toBe("The build was cancelled.")
    expect(failureText(null, ar)).toBeNull()
    expect(failureText("appxprompt:publish-error:v1:broken", ar)).toBe("appxprompt:publish-error:v1:broken")
  })
})
