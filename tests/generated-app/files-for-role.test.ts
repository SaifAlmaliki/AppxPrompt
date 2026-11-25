import { describe, expect, it } from "vitest"

import { filesForRole } from "@/lib/generated-app/export-project"

const files = [{ path: "app/api/a+api.ts" }, { path: "server/google.ts" }, { path: "lib/server/index.ts" }, { path: "app/index.tsx" }]

describe("filesForRole", () => {
  it("keeps server code away from viewers", () => {
    expect(filesForRole(files, "viewer")).toEqual([{ path: "lib/server/index.ts" }, { path: "app/index.tsx" }])
  })

  it("gives the owner every file", () => {
    expect(filesForRole(files, "owner")).toEqual(files)
  })
})
