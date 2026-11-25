import { describe, expect, it } from "vitest"

import type { AppPlan, ProjectScreen } from "@/lib/agent-protocol"
import { screenProblems } from "@/lib/agent/validate-screen"
import { snackProject } from "@/lib/generated-app/snack-project"
import { fallbackThemePackage } from "@/lib/themes"

const screen = (body: string) => `import { callServer } from "@/lib/server"

export default function Screen() {
  ${body}
  return null
}
`

const routes = ["app/api/booking/slots+api.ts"]

const serverProblems = (code: string, serverRoutes: string[] | null) => screenProblems(code, [], [], false, "", serverRoutes).filter((p) => p.includes("server") || p.includes("/api/"))

describe("screen checks for server calls", () => {
  it("rejects importing @/lib/server when the app has no server functions", () => {
    const problems = screenProblems(screen(`callServer("/api/booking/slots")`), [], [], false, "", null)
    expect(problems.some((p) => p.includes("@/lib/server"))).toBe(true)
  })

  it("allows the import when the app has server functions", () => {
    expect(screenProblems(screen(`void 0`), [], [], false, "", routes)).toEqual([])
  })

  it("flags a call to a path that isn't a planned route", () => {
    const problems = screenProblems(screen(`callServer("/api/booking/book", {})`), [], [], false, "", routes)
    const problem = problems.find((p) => p.includes("/api/booking/book"))
    expect(problem).toContain("/api/booking/slots")
    expect(problem).toContain("isn't one of the app's server functions")
  })

  it("accepts a call to a planned route, with quotes or backticks", () => {
    expect(serverProblems(screen(`callServer("/api/booking/slots", {})`), routes)).toEqual([])
    expect(serverProblems(screen("callServer<string[]>(`/api/booking/slots`)"), routes)).toEqual([])
  })

  it("flags a backtick path that is a literal, and leaves built paths alone", () => {
    expect(screenProblems(screen("callServer(`/api/nope`)"), [], [], false, "", routes).some((p) => p.includes("/api/nope"))).toBe(true)
    expect(serverProblems(screen("callServer(`/api/booking/${slug}`)"), routes)).toEqual([])
  })
})

describe("snackProject with a server", () => {
  const plan: AppPlan = {
    appName: "Booker",
    tagline: "t",
    summary: "s",
    targetUsers: "u",
    navigation: "stack",
    design: { style: "clean", mode: "light", primaryColor: "#0369a1", accentColor: "#0d9488", backgroundColor: "#f4f9fc" },
    screens: [{ id: "home", name: "Home", purpose: "p", keyElements: [], layout: "home", navigatesTo: [] }],
    themePackage: fallbackThemePackage({ mode: "light", primaryColor: "#0369a1", accentColor: "#0d9488", backgroundColor: "#f4f9fc" }),
    collections: [],
    components: [],
    serverRoutes: [{ id: "slots", path: "app/api/booking/slots+api.ts", purpose: "p", kind: "function", services: [], access: "public" }],
  }
  const screens: ProjectScreen[] = [
    { id: "s1", slug: "home", name: "Home", position: 0, status: "done", filePath: "app/index.tsx", layout: "home", code: screen(`void 0`) },
  ]

  it("carries the sandbox token and imports the config relatively", () => {
    const project = snackProject(plan, screens, { kind: "sandbox", projectId: "p1", token: "tok" })!
    expect(project.files["lib/server/config.ts"].contents).toContain("tok")
    expect(project.files["lib/server/index.ts"].contents).toContain(`from "./config"`)
    expect(project.files["app/index.tsx"].contents).toContain(`from "../lib/server"`)
  })
})
