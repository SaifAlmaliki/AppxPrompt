import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ServiceDefinition } from "@/lib/services/protocol"

const state = vi.hoisted(() => ({
  row: null as { definition: unknown } | null,
  updates: [] as { set: Record<string, unknown> }[],
  deletes: 0,
  inserts: 0,
}))

vi.mock("@/db", () => ({
  projectCredentials: {},
  projectServices: { projectId: "projectId", slug: "slug", definition: "definition" },
  db: {
    transaction: async (run: (tx: unknown) => unknown) =>
      run({
        select: () => ({ from: () => ({ where: () => ({ for: async () => (state.row ? [state.row] : []) }) }) }),
        update: () => ({
          set: (set: Record<string, unknown>) => {
            state.updates.push({ set })
            return { where: async () => {} }
          },
        }),
        delete: () => {
          state.deletes++
          return { where: async () => {} }
        },
        insert: () => {
          state.inserts++
          return { values: () => ({ onConflictDoUpdate: async () => {} }) }
        },
      }),
  },
}))

import { addLesson, LESSONS_HEADING, MAX_LESSON_LENGTH, MAX_NOTES_LENGTH } from "@/lib/services/lessons"
import { addServiceLesson } from "@/lib/services/store"

const definition: ServiceDefinition = {
  slug: "apify",
  name: "Apify",
  purpose: "Scraping",
  docsUrl: "https://docs.apify.com",
  authKind: "api_key",
  fields: [{ name: "APIFY_TOKEN", label: "Token", kind: "secret", help: "" }],
  allowedHosts: ["api.apify.com"],
  oauth: null,
  check: null,
  setupSteps: "1. Get a token",
  notes: "Runs: POST /acts/{id}/runs",
}

describe("addLesson", () => {
  it("creates the heading and appends under it", () => {
    expect(addLesson("Runs: POST /runs", "Runs take over a minute.")).toEqual({
      notes: "Runs: POST /runs\n\nLessons:\n- Runs take over a minute.",
      added: true,
    })
    expect(addLesson("", "Runs are slow")).toEqual({ notes: "Lessons:\n- Runs are slow", added: true })
  })

  it("adds to the end of the existing lessons and keeps what follows", () => {
    const result = addLesson("Intro\n\nLessons:\n- One\n- Two\n\nMore notes", "Three")
    expect(result).toEqual({ notes: "Intro\n\nLessons:\n- One\n- Two\n- Three\n\nMore notes", added: true })
  })

  it("collapses whitespace and a leading dash into one line", () => {
    expect(addLesson("", "  - the   field\nis often\tmissing ")).toEqual({ notes: "Lessons:\n- the field is often missing", added: true })
  })

  it("skips an exact duplicate", () => {
    const notes = "Lessons:\n- Runs are slow"
    expect(addLesson(notes, "Runs are slow")).toEqual({ notes, added: false })
  })

  it("refuses an empty, long or credential-bearing lesson", () => {
    expect(addLesson("x", "   ")).toHaveProperty("refused")
    expect(addLesson("x", "a".repeat(MAX_LESSON_LENGTH + 1))).toHaveProperty("refused")
    expect(addLesson("x", "a".repeat(MAX_LESSON_LENGTH))).toHaveProperty("added", true)
    expect(addLesson("x", "the key is sk-abcdefghijklmnopqrstuvwxyz123456")).toHaveProperty("refused")
  })

  it("drops the oldest lessons first to stay within the notes limit", () => {
    const old = Array.from({ length: 66 }, (_, i) => `- lesson ${String(i).padStart(3, "0")} ${"x".repeat(270)}`)
    const notes = `${"n".repeat(1200)}\n\n${LESSONS_HEADING}\n${old.join("\n")}`
    expect(notes.length).toBeLessThanOrEqual(MAX_NOTES_LENGTH)
    const result = addLesson(notes, "y".repeat(250))
    if ("refused" in result) throw new Error(result.refused)
    expect(result.notes.length).toBeLessThanOrEqual(MAX_NOTES_LENGTH)
    expect(result.notes).not.toContain("lesson 000")
    expect(result.notes).toContain("lesson 065")
    expect(result.notes.endsWith(`- ${"y".repeat(250)}`)).toBe(true)
    expect(result.notes.startsWith("n".repeat(100))).toBe(true)
  })

  it("refuses when the notes are full and there are no lessons to drop", () => {
    expect(addLesson("n".repeat(MAX_NOTES_LENGTH - 10), "Runs are slow")).toHaveProperty("refused")
  })
})

describe("addServiceLesson", () => {
  beforeEach(() => {
    state.row = { definition }
    state.updates = []
    state.deletes = 0
    state.inserts = 0
  })

  it("changes the notes and nothing else of the definition", async () => {
    expect(await addServiceLesson("p1", "apify", "Runs take over a minute.")).toEqual({ ok: true, added: true })
    expect(state.updates).toHaveLength(1)
    const saved = state.updates[0].set.definition as ServiceDefinition
    expect(saved).toEqual({ ...definition, notes: "Runs: POST /acts/{id}/runs\n\nLessons:\n- Runs take over a minute." })
    expect(saved.fields).toBe(definition.fields)
    expect(saved.allowedHosts).toBe(definition.allowedHosts)
    expect(Object.keys(state.updates[0].set).sort()).toEqual(["definition", "updatedAt"])
    expect(state.deletes).toBe(0)
    expect(state.inserts).toBe(0)
  })

  it("writes nothing for a duplicate", async () => {
    state.row = { definition: { ...definition, notes: "Lessons:\n- Runs are slow" } }
    expect(await addServiceLesson("p1", "apify", "Runs are slow")).toEqual({ ok: true, added: false })
    expect(state.updates).toHaveLength(0)
  })

  it("refuses a service that isn't registered, and the hidden system one", async () => {
    state.row = null
    expect(await addServiceLesson("p1", "nope", "x")).toEqual({ ok: false, reason: 'No service "nope" is registered.' })
    state.row = { definition }
    expect(await addServiceLesson("p1", "appxprompt", "x")).toMatchObject({ ok: false })
    expect(state.updates).toHaveLength(0)
  })

  it("passes on why a lesson was refused", async () => {
    expect(await addServiceLesson("p1", "apify", "")).toEqual({ ok: false, reason: "The lesson is empty." })
    expect(state.updates).toHaveLength(0)
  })
})
