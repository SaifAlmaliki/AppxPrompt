import { transform } from "sucrase"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isServerFile, type AppPlan, type PlannedServerRoute, type ProjectScreen } from "@/lib/agent-protocol"
import { validateServerRoute } from "@/lib/agent/validate-server-route"
import { generatedAppFiles, previewProject } from "@/lib/generated-app/project-files"
import { generatedServerFiles, serverClientFiles, type ServerTarget } from "@/lib/generated-app/server-files"
import { snackProject } from "@/lib/generated-app/snack-project"
import { fallbackThemePackage } from "@/lib/themes"

const design = { mode: "light", primaryColor: "#0369a1", accentColor: "#0d9488", backgroundColor: "#f4f9fc" } as const

const route: PlannedServerRoute = { id: "slots", path: "app/api/booking/slots+api.ts", purpose: "Free slots", kind: "function", services: [], access: "public" }

const basePlan: AppPlan = {
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
}

const planWithRoutes: AppPlan = { ...basePlan, serverRoutes: [route] }

const backend = { apiPath: "/api/backend/p1", authUrl: "https://auth.example.com/api/auth", authKey: "ck_test_public_key", services: [] }

const planWithBackend: AppPlan = { ...planWithRoutes, backend }

const screens: ProjectScreen[] = [
  { id: "s1", slug: "home", name: "Home", position: 0, status: "done", filePath: "app/index.tsx", layout: "home", code: "export default function Home() { return null }" },
]

const sandbox: ServerTarget = { kind: "sandbox", projectId: "p1", token: "tok" }

function load(code: string, requires: Record<string, unknown> = {}, env: Record<string, string | undefined> = {}) {
  const compiled = transform(code, { transforms: ["typescript", "imports"] }).code
  const module = { exports: {} as Record<string, any> }
  const require = (name: string) => {
    if (!(name in requires)) throw new Error(`Unexpected require ${name}`)
    return requires[name]
  }
  new Function("require", "module", "exports", "process", compiled)(require, module, module.exports, { env })
  return module.exports
}

function file(files: { path: string; code: string }[], path: string) {
  const found = files.find((f) => f.path === path)
  if (!found) throw new Error(`No ${path}`)
  return found.code
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("which files appear", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://x/")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("adds no server client without server routes", () => {
    expect(generatedAppFiles(basePlan, sandbox).some((f) => f.path.startsWith("lib/server/"))).toBe(false)
    expect(generatedServerFiles(basePlan)).toEqual([])
  })

  it("adds the client with server routes", () => {
    const paths = generatedAppFiles(planWithRoutes, sandbox).map((f) => f.path)
    expect(paths).toContain("lib/server/config.ts")
    expect(paths).toContain("lib/server/index.ts")
  })

  it("exports exactly SERVER_BASE_URL and SERVER_TOKEN from the config", () => {
    const config = load(file(serverClientFiles(sandbox), "lib/server/config.ts"))
    expect(Object.keys(config)).toEqual(["SERVER_BASE_URL", "SERVER_TOKEN"])
    expect(config.SERVER_BASE_URL).toBe("https://x/api/apps/p1/server")
    expect(config.SERVER_TOKEN).toBe("tok")
  })

  it("gives an empty token to a sandbox without one", () => {
    const config = load(file(serverClientFiles({ kind: "sandbox", projectId: "p1", token: null }), "lib/server/config.ts"))
    expect(config.SERVER_TOKEN).toBe("")
    expect(load(file(serverClientFiles(undefined), "lib/server/config.ts")).SERVER_TOKEN).toBe("")
  })

  it("gives a deployed app no token", () => {
    const config = load(file(serverClientFiles({ kind: "deployed", origin: "https://app.expo.app" }), "lib/server/config.ts"))
    expect(config.SERVER_BASE_URL).toBe("https://app.expo.app")
    expect(config.SERVER_TOKEN).toBeNull()
  })

  it("generates exactly the three server helpers", () => {
    expect(generatedServerFiles(planWithRoutes).map((f) => f.path)).toEqual(["server/auth.ts", "server/data.ts", "server/respond.ts"])
  })

  it("generates server/auth.ts for a plan whose only route is an agent", () => {
    const plan = { ...basePlan, serverRoutes: [{ ...route, kind: "agent" as const }] }
    expect(generatedServerFiles(plan).map((f) => f.path)).toContain("server/auth.ts")
  })

  it("never puts a server file in the app, the preview or the Snack", () => {
    const snack = snackProject(planWithBackend, screens, sandbox)
    const paths = [
      ...generatedAppFiles(planWithBackend, sandbox).map((f) => f.path),
      ...previewProject(planWithBackend, screens, sandbox).files.map((f) => f.path),
      ...Object.keys(snack!.files),
    ]
    expect(paths.filter(isServerFile)).toEqual([])
  })

  it("compiles every generated file", () => {
    const files = [...generatedAppFiles(planWithBackend, sandbox), ...generatedServerFiles(planWithBackend)]
    for (const f of files) {
      expect(() => transform(f.code, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic" }), f.path).not.toThrow()
    }
  })

  it("passes the server route rules, except for being system files", () => {
    for (const f of generatedServerFiles(planWithBackend)) {
      const problems = validateServerRoute(f.code, {
        path: f.path.replace("server/", "server/x-"),
        credentialNames: ["APPXPROMPT_SERVER_KEY"],
        allowedHosts: ["auth.example.com", "x"],
        helperPaths: [],
      })
      expect(problems, f.path).toEqual([])
    }
  })
})

describe("callServer", () => {
  let state: { SERVER_BASE_URL: string; SERVER_TOKEN: string | null }
  let stored: Record<string, string>
  let fetchMock: ReturnType<typeof vi.fn>
  let mod: Record<string, any>

  beforeEach(() => {
    state = { SERVER_BASE_URL: "https://x/api/apps/p1/server", SERVER_TOKEN: "tok" }
    stored = {}
    fetchMock = vi.fn(async () => jsonResponse({ slots: [1] }))
    vi.stubGlobal("fetch", fetchMock)
    const config = {
      get SERVER_BASE_URL() {
        return state.SERVER_BASE_URL
      },
      get SERVER_TOKEN() {
        return state.SERVER_TOKEN
      },
    }
    const asyncStorage = { __esModule: true, default: { getItem: async (key: string) => stored[key] ?? null } }
    mod = load(file(serverClientFiles(sandbox), "lib/server/index.ts"), {
      "@react-native-async-storage/async-storage": asyncStorage,
      "@/lib/server/config": config,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("throws preview without fetching when the viewer has no token", async () => {
    state.SERVER_TOKEN = ""
    const error = await mod.callServer("/api/booking/slots").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(mod.ServerError)
    expect(error.code).toBe("preview")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts json with the sandbox token and reads it at call time", async () => {
    expect(await mod.callServer("/api/booking/slots", { day: "mon" })).toEqual({ slots: [1] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://x/api/apps/p1/server/api/booking/slots")
    expect(init.method).toBe("POST")
    expect(init.headers["x-appxprompt-sandbox"]).toBe("tok")
    expect(JSON.parse(init.body)).toEqual({ day: "mon" })

    state.SERVER_TOKEN = "tok2"
    await mod.callServer("/api/booking/slots")
    expect(fetchMock.mock.calls[1][1].headers["x-appxprompt-sandbox"]).toBe("tok2")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({})
  })

  it("posts relatively and without a sandbox header in a published build", async () => {
    state.SERVER_BASE_URL = ""
    state.SERVER_TOKEN = null
    await mod.callServer("/api/booking/slots")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/booking/slots")
    expect(init.headers).not.toHaveProperty("x-appxprompt-sandbox")
  })

  it("sends the stored sign-in token and device id", async () => {
    stored["app:auth:token"] = "t"
    stored["app:backend:device"] = "d"
    await mod.callServer("/api/booking/slots")
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.authorization).toBe("Bearer t")
    expect(headers["x-device-id"]).toBe("d")
  })

  it("turns a not_connected answer into its code and service", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "not_connected", message: "m", service: "google-calendar" } }, 503))
    const error = await mod.callServer("/api/booking/slots").catch((e: unknown) => e)
    expect(error.code).toBe("not_connected")
    expect(error.service).toBe("google-calendar")
  })

  it("turns a preview answer into preview", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "preview" } }, 403))
    expect((await mod.callServer("/api/booking/slots").catch((e: unknown) => e)).code).toBe("preview")
  })

  it("is unavailable when the network fails or the answer isn't ours", async () => {
    fetchMock.mockRejectedValue(new Error("offline"))
    expect((await mod.callServer("/x").catch((e: unknown) => e)).code).toBe("unavailable")
    fetchMock.mockResolvedValue(new Response("<html>Oops</html>", { status: 500 }))
    expect((await mod.callServer("/x").catch((e: unknown) => e)).code).toBe("unavailable")
  })

  it("is sign_in for a bare 401 and null for an empty success", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }))
    expect((await mod.callServer("/x").catch((e: unknown) => e)).code).toBe("sign_in")
    fetchMock.mockResolvedValue(new Response("", { status: 200 }))
    expect(await mod.callServer("/x")).toBeNull()
  })
})

describe("server/respond.ts", () => {
  const respond = load(file(generatedServerFiles(planWithRoutes), "server/respond.ts"))

  it("hides what a handler threw", async () => {
    const secret = "sk-proj-" + "a".repeat(40)
    const response = await respond.withErrors(async () => {
      throw new Error(secret)
    })(new Request("https://x"))
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(text).not.toContain("sk-proj-")
    expect(JSON.parse(text).error.code).toBe("unavailable")
  })

  it("maps ServiceNotConnected to 503 not_connected with its service", async () => {
    const response = await respond.withErrors(async () => {
      throw new respond.ServiceNotConnected("backend")
    })(new Request("https://x"))
    expect(response.status).toBe(503)
    const { error } = await response.json()
    expect(error.code).toBe("not_connected")
    expect(error.service).toBe("backend")
  })

  it("maps SignInRequired to 401 sign_in", async () => {
    const response = await respond.withErrors(async () => {
      throw new respond.SignInRequired()
    })(new Request("https://x"))
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe("sign_in")
  })

  it("answers ok and fail with the right statuses", async () => {
    expect((await respond.ok({ a: 1 }, 201).json()).a).toBe(1)
    expect(respond.ok({}, 201).status).toBe(201)
    expect(respond.fail("bad_request", "m").status).toBe(400)
  })
})

function helpers(plan: AppPlan, env: Record<string, string | undefined> = {}) {
  const files = generatedServerFiles(plan)
  const respond = load(file(files, "server/respond.ts"))
  const requires = { "./respond": respond }
  return {
    respond,
    data: load(file(files, "server/data.ts"), requires, env).data,
    auth: load(file(files, "server/auth.ts"), requires, env),
  }
}

describe("server/data.ts", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://x")
    fetchMock = vi.fn(async () => jsonResponse({ items: [{ id: "1" }] }))
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("isn't connected without a backend", async () => {
    const { data, respond } = helpers(planWithRoutes, { APPXPROMPT_SERVER_KEY: "k" })
    const error = await data.asApp().collection("bookings").list().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(respond.ServiceNotConnected)
    expect(error.service).toBe("backend")
  })

  it("isn't connected without the server key", async () => {
    const { data, respond } = helpers(planWithBackend)
    await expect(data.asApp().collection("bookings").list()).rejects.toBeInstanceOf(respond.ServiceNotConnected)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("lists as the app with the server key", async () => {
    const { data } = helpers(planWithBackend, { APPXPROMPT_SERVER_KEY: "k" })
    expect(await data.asApp().collection("bookings").list()).toEqual([{ id: "1" }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://x/api/backend/p1/collections/bookings")
    expect(init.headers["x-appxprompt-server-key"]).toBe("k")
    expect(init.headers["x-appxprompt-as"]).toBe("app")
  })

  it("forwards the caller's credentials and doesn't act as the app", async () => {
    const { data } = helpers(planWithBackend, { APPXPROMPT_SERVER_KEY: "k" })
    await data.asCaller(new Request("https://x", { headers: { authorization: "Bearer u" } })).collection("bookings").list()
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.authorization).toBe("Bearer u")
    expect(headers["x-appxprompt-server-key"]).toBe("k")
    expect(headers).not.toHaveProperty("x-appxprompt-as")
  })

  it("inserts, updates and removes", async () => {
    const { data } = helpers(planWithBackend, { APPXPROMPT_SERVER_KEY: "k" })
    const bookings = data.asApp().collection("bookings")
    await bookings.insert({ day: "mon" })
    await bookings.update("a b", { day: "tue" })
    await bookings.remove("1")
    expect(fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "POST https://x/api/backend/p1/collections/bookings",
      "PATCH https://x/api/backend/p1/collections/bookings/a%20b",
      "DELETE https://x/api/backend/p1/collections/bookings/1",
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ day: "mon" })
  })

  it("asks for sign-in on 401 and fails on other errors", async () => {
    const { data, respond } = helpers(planWithBackend, { APPXPROMPT_SERVER_KEY: "k" })
    fetchMock.mockResolvedValue(new Response("", { status: 401 }))
    await expect(data.asApp().collection("b").list()).rejects.toBeInstanceOf(respond.SignInRequired)
    fetchMock.mockResolvedValue(new Response("", { status: 500 }))
    const error = await data.asApp().collection("b").list().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(respond.SignInRequired)
    expect(error).not.toBeInstanceOf(respond.ServiceNotConnected)
  })
})

describe("server/auth.ts", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const request = (authorization?: string) => new Request("https://x", { headers: authorization ? { authorization } : {} })
  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ user: { id: "u1", email: "a@b.c", name: "A" } }))
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("is null without an authorization header, and doesn't call out", async () => {
    const { auth } = helpers(planWithBackend)
    expect(await auth.getCaller(request())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("is null when CloudHike Auth rejects the token", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }))
    const { auth } = helpers(planWithBackend)
    expect(await auth.getCaller(request("Bearer t"))).toBeNull()
  })

  it("is the user for a valid token, checked with the app's auth key", async () => {
    const { auth } = helpers(planWithBackend)
    expect(await auth.getCaller(request("Bearer t"))).toEqual({ id: "u1", email: "a@b.c", name: "A" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://auth.example.com/api/auth/get-session")
    expect(init.headers["x-api-key"]).toBe("ck_test_public_key")
    expect(init.headers.authorization).toBe("Bearer t")
  })

  it("rejects when sign-in is down", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }))
    const { auth } = helpers(planWithBackend)
    await expect(auth.getCaller(request("Bearer t"))).rejects.toThrow()
    fetchMock.mockRejectedValue(new Error("offline"))
    await expect(auth.getCaller(request("Bearer t"))).rejects.toThrow()
  })

  it("is null without a backend", async () => {
    const { auth } = helpers(planWithRoutes)
    expect(await auth.getCaller(request("Bearer t"))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("requireCaller throws SignInRequired when nobody is signed in", async () => {
    const { auth, respond } = helpers(planWithBackend)
    await expect(auth.requireCaller(request())).rejects.toBeInstanceOf(respond.SignInRequired)
    expect((await auth.requireCaller(request("Bearer t"))).id).toBe("u1")
  })
})
