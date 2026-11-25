import { describe, expect, it } from "vitest"

import type { AppPlan, ProjectScreen } from "@/lib/agent-protocol"
import { previewProject } from "@/lib/generated-app/project-files"
import { snackProject } from "@/lib/generated-app/snack-project"
import { fallbackThemePackage } from "@/lib/themes"

const design = { mode: "light", primaryColor: "#0369a1", accentColor: "#0d9488", backgroundColor: "#f4f9fc" } as const

const plan: AppPlan = {
  appName: "Booker",
  tagline: "t",
  summary: "s",
  targetUsers: "u",
  navigation: "stack",
  design: { style: "clean", ...design },
  screens: [{ id: "home", name: "Home", purpose: "p", keyElements: [], layout: "home", navigatesTo: [] }],
  themePackage: fallbackThemePackage(design),
  collections: [],
  components: [],
  serverRoutes: [{ id: "slots", path: "app/api/booking/slots+api.ts", purpose: "p", kind: "function", services: [], access: "public" }],
}

const screens: ProjectScreen[] = [
  { id: "s1", slug: "home", name: "Home", position: 0, status: "done", filePath: "app/index.tsx", layout: "home", code: "export default function Home() { return null }" },
]

describe("the sandbox token in generated files", () => {
  it("never reaches the preview's files, whatever the owner's token is", () => {
    const preview = previewProject(plan, screens, { kind: "sandbox", projectId: "p1", token: null })
    expect(preview.files.find((f) => f.path === "lib/server/config.ts")!.code).toContain(`SERVER_TOKEN: string | null = ""`)
  })

  it("changes only lib/server/config.ts in the Snack when the token is renewed", () => {
    const first = snackProject(plan, screens, { kind: "sandbox", projectId: "p1", token: "one" })!
    const second = snackProject(plan, screens, { kind: "sandbox", projectId: "p1", token: "two" })!
    const changed = Object.keys(second.files).filter((path) => first.files[path]?.contents !== second.files[path].contents)
    expect(changed).toEqual(["lib/server/config.ts"])
  })
})
