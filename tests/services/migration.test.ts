import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { KEY_BOUNDARY, KEY_PATTERN_SOURCES, KEY_REMOVED } from "@/lib/services/key-patterns"

describe("redact_message_keys migration", () => {
  const file = readdirSync("drizzle").find((name) => name.endsWith("_redact_message_keys.sql"))
  it("exists", () => expect(file).toBeDefined())
  it("redacts every pattern the app redacts, with the same marker", () => {
    const sql = readFileSync(`drizzle/${file}`, "utf8")
    for (const source of KEY_PATTERN_SOURCES) expect(sql).toContain(source)
    expect(sql).toContain(KEY_BOUNDARY)
    expect(sql).toContain(KEY_REMOVED)
  })
})
