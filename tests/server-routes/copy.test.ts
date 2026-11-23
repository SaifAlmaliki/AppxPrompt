import { describe, expect, it } from "vitest"

import { serverRoutes } from "@/db"
import { copyServerRoutes } from "@/lib/server-routes/store"

const rows = [
  { projectId: "p1", path: "app/api/slots+api.ts", kind: "function", purpose: "Lists slots", code: "export {}", status: "done", createdAt: new Date(), updatedAt: new Date() },
  { projectId: "p1", path: "app/api/chat+api.ts", kind: "agent", purpose: "Answers", code: null, status: "failed", createdAt: new Date(), updatedAt: new Date() },
  { projectId: "p1", path: "server/google.ts", kind: "helper", purpose: "Google client", code: "export {}", status: "done", createdAt: new Date(), updatedAt: new Date() },
]

function fakeTx(source: unknown[]) {
  const inserts: { table: unknown; values: unknown }[] = []
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(source) }) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values })
        return Promise.resolve()
      },
    }),
  }
  return { tx: tx as never, inserts }
}

describe("copyServerRoutes", () => {
  it("copies every route and helper to the new project and writes nothing else", async () => {
    const { tx, inserts } = fakeTx(rows)
    await copyServerRoutes(tx, "p1", "p2")
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe(serverRoutes)
    expect(inserts[0].values).toEqual(
      rows.map(({ path, kind, purpose, code, status }) => ({ projectId: "p2", path, kind, purpose, code, status })),
    )
  })

  it("inserts nothing when there are no routes", async () => {
    const { tx, inserts } = fakeTx([])
    await copyServerRoutes(tx, "p1", "p2")
    expect(inserts).toEqual([])
  })
})
