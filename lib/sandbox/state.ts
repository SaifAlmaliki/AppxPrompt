// The only module that reads or writes the `project_sandboxes` table.

import { and, eq, isNull, lt, or, sql } from "drizzle-orm"

import { db, projectSandboxes } from "@/db"

export type SandboxState = {
  sandboxId: string | null
  domain: string | null
  signature: string | null
  startingUntil: Date | null
  sessionStartedAt: Date | null
  deadlineAt: Date | null
  usageDay: string | null
  usageMs: number
}

export interface SandboxStateStore {
  get(projectId: string): Promise<SandboxState | null>
  /** A conditional upsert: only wins if nobody holds a start claim, or the claim has run out. */
  claimStart(projectId: string, until: Date): Promise<boolean>
  /** Clears `startingUntil`. */
  saveStarted(
    projectId: string,
    s: { sandboxId: string; domain: string; signature: string; sessionStartedAt: Date; deadlineAt: Date },
  ): Promise<void>
  saveDeadline(projectId: string, deadlineAt: Date): Promise<void>
  /** Resets when the day changes. Returns today's total. */
  addUsage(projectId: string, ms: number, day: string): Promise<number>
  clear(projectId: string): Promise<void>
  /** Clears the VM fields (not a start claim) only while sandboxId is still the given one. Returns whether a row changed. */
  clearIfCurrent(projectId: string, sandboxId: string): Promise<boolean>
  /** Keeps `sandboxId` and `domain`, so the next start can stop the old sandbox. */
  clearSignature(projectId: string): Promise<void>
}

const NO_SANDBOX = { sandboxId: null, domain: null, signature: null, startingUntil: null, sessionStartedAt: null, deadlineAt: null }

export const dbSandboxState: SandboxStateStore = {
  async get(projectId) {
    const [row] = await db.select().from(projectSandboxes).where(eq(projectSandboxes.projectId, projectId))
    if (!row) return null
    const { projectId: _projectId, updatedAt: _updatedAt, ...state } = row
    return state
  },

  async claimStart(projectId, until) {
    const rows = await db
      .insert(projectSandboxes)
      .values({ projectId, startingUntil: until })
      .onConflictDoUpdate({
        target: projectSandboxes.projectId,
        set: { startingUntil: until },
        setWhere: or(isNull(projectSandboxes.startingUntil), lt(projectSandboxes.startingUntil, new Date())),
      })
      .returning({ projectId: projectSandboxes.projectId })
    return rows.length > 0
  },

  async saveStarted(projectId, s) {
    const values = { ...s, startingUntil: null }
    await db
      .insert(projectSandboxes)
      .values({ projectId, ...values })
      .onConflictDoUpdate({ target: projectSandboxes.projectId, set: values })
  },

  async saveDeadline(projectId, deadlineAt) {
    await db.update(projectSandboxes).set({ deadlineAt }).where(eq(projectSandboxes.projectId, projectId))
  },

  async addUsage(projectId, ms, day) {
    const [row] = await db
      .insert(projectSandboxes)
      .values({ projectId, usageDay: day, usageMs: Math.max(0, ms) })
      .onConflictDoUpdate({
        target: projectSandboxes.projectId,
        set: {
          usageMs: sql`greatest(0, case when ${projectSandboxes.usageDay} = ${day} then ${projectSandboxes.usageMs} + ${ms} else ${ms} end)`,
          usageDay: day,
        },
      })
      .returning({ usageMs: projectSandboxes.usageMs })
    return row.usageMs
  },

  async clear(projectId) {
    await db.update(projectSandboxes).set(NO_SANDBOX).where(eq(projectSandboxes.projectId, projectId))
  },

  async clearIfCurrent(projectId, sandboxId) {
    const { startingUntil: _startingUntil, ...vm } = NO_SANDBOX
    const rows = await db
      .update(projectSandboxes)
      .set(vm)
      .where(and(eq(projectSandboxes.projectId, projectId), eq(projectSandboxes.sandboxId, sandboxId)))
      .returning({ projectId: projectSandboxes.projectId })
    return rows.length > 0
  },

  async clearSignature(projectId) {
    await db.update(projectSandboxes).set({ signature: null }).where(eq(projectSandboxes.projectId, projectId))
  },
}
