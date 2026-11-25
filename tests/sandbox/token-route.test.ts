import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  user: null as { id: number } | null,
  access: null as { role: string } | null,
}))

vi.mock("@/lib/session", () => ({ getCurrentUser: async () => mocks.user }))
vi.mock("@/lib/project-access", () => ({ getProjectAccess: async () => mocks.access }))
vi.mock("@/lib/i18n/server", () => ({
  errorResponse: async (key: string, status: number) => Response.json({ key }, { status }),
}))

import { POST } from "@/app/api/projects/[projectId]/sandbox-token/route"
import { verifySandboxToken } from "@/lib/sandbox/token"

const PROJECT = "11111111-1111-4111-8111-111111111111"
const run = () => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ projectId: PROJECT }) })

beforeEach(() => {
  vi.stubEnv("CLOUDHIKE_ENCRYPTION_KEY", "test-secret")
  vi.stubEnv("APP_INTEGRATIONS", "1")
  mocks.user = { id: 7 }
  mocks.access = { role: "owner" }
})

afterEach(() => vi.unstubAllEnvs())

describe("POST sandbox-token", () => {
  it("gives the owner a token for this project and its expiry in epoch seconds", async () => {
    const response = await run()
    const { token, expiresAt } = await response.json()
    expect(response.status).toBe(200)
    expect(verifySandboxToken(token, PROJECT)).toBe(true)
    expect(expiresAt).toBeGreaterThan(Date.now() / 1000)
    expect(expiresAt).toBeLessThan(Date.now() / 1000 + 3601)
  })

  it("asks a signed-out visitor to sign in", async () => {
    mocks.user = null
    const response = await run()
    expect(response.status).toBe(401)
    expect((await response.json()).key).toBe("signInRequired")
  })

  it.each([["an editor", { role: "editor" }], ["a stranger", null]])("404s %s", async (_name, access) => {
    mocks.access = access
    const response = await run()
    expect(response.status).toBe(404)
    expect((await response.json()).key).toBe("projectNotFound")
  })

  it("404s when integrations are off", async () => {
    vi.stubEnv("APP_INTEGRATIONS", "")
    expect((await run()).status).toBe(404)
  })
})
