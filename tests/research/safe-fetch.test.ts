import { EventEmitter } from "node:events"
import https from "node:https"
import net from "node:net"
import { Readable } from "node:stream"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:dns", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:dns")>()), lookup: vi.fn() }))
const dns = await import("node:dns")
const originalRequest = https.request
const { fetchPublic, httpsRequestOnce, isPrivateAddress, isPublicHttpsUrl, pinnedFetch, readLimited, safeLookup } = await import("@/lib/research/safe-fetch")

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "64:ff9b::7f00:1", "2002:7f00:1::", "ff02::1", "not-an-ip"])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true))
  it.each(["8.8.8.8", "172.32.0.1", "142.250.80.46", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false))
})

describe("isPublicHttpsUrl", () => {
  it.each(["https://developers.google.com/calendar/api", "https://api.openai.com:443/v1/models", "https://1.1.1.1/"])("allows %s", (u) =>
    expect(isPublicHttpsUrl(u)).toBe(true))
  it.each(["http://example.com", "https://localhost/", "https://docs.localhost/", "https://127.0.0.1/", "https://[::1]/",
    "https://10.0.0.5/", "https://0x7f000001/", "https://2130706433/", "https://169.254.169.254/latest/meta-data",
    "https://user:pass@example.com/", "https://example.com:8443/", "https://intranet/", "https://printer.local/",
    "https://metadata.google.internal/", "https://router.home.arpa/", "not a url"])("refuses %s", (u) => expect(isPublicHttpsUrl(u)).toBe(false))
})

describe("safeLookup", () => {
  const answer = (addresses: { address: string; family: number }[]) =>
    vi.mocked(dns.lookup).mockImplementation(((_h: string, _o: unknown, cb: Function) => cb(null, addresses)) as never)
  const look = (all: boolean) => new Promise<{ err: any; result: unknown }>((resolve) =>
    safeLookup("docs.example.com", { all } as never, ((err: any, result: unknown) => resolve({ err, result })) as never))

  it("refuses a host whose addresses include a private one", async () => {
    answer([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }])
    expect((await look(true)).err.code).toBe("ERR_PRIVATE_ADDRESS")
  })
  it("passes public addresses through in the shape asked for", async () => {
    answer([{ address: "93.184.216.34", family: 4 }])
    expect((await look(true)).result).toEqual([{ address: "93.184.216.34", family: 4 }])
    expect((await look(false)).result).toBe("93.184.216.34")
  })
  it("passes a resolver error through", async () => {
    vi.mocked(dns.lookup).mockImplementation(((_h: string, _o: unknown, cb: Function) => cb(new Error("ENOTFOUND"))) as never)
    expect((await look(true)).err.message).toBe("ENOTFOUND")
  })
})

describe("readLimited", () => {
  it("cuts at the cap, marks it truncated, and destroys the stream", async () => {
    const stream = Readable.from([Buffer.alloc(600), Buffer.alloc(600), Buffer.alloc(600)])
    const { body, truncated } = await readLimited(stream, 1000)
    expect(body.length).toBe(1000)
    expect(truncated).toBe(true)
    expect(stream.destroyed).toBe(true)
  })
  it("reads a small stream whole", async () => {
    const { body, truncated } = await readLimited(Readable.from([Buffer.alloc(100), Buffer.alloc(100)]), 1000)
    expect(body.length).toBe(200)
    expect(truncated).toBe(false)
  })
})

describe("fetchPublic", () => {
  const ok = (body = "<p>hi</p>") => ({ status: 200, location: null, contentType: "text/html", body: Buffer.from(body), truncated: false })
  const redirect = (location: string) => ({ status: 302, location, contentType: "", body: Buffer.alloc(0), truncated: false })

  it("follows a relative redirect and reports the final url", async () => {
    const requestOnce = vi.fn().mockResolvedValueOnce(redirect("/docs/auth")).mockResolvedValueOnce(ok())
    expect(await fetchPublic("https://x.com/start", requestOnce)).toMatchObject({ url: "https://x.com/docs/auth", contentType: "text/html" })
  })
  it.each(["http://x.com/", "https://127.0.0.1/", "https://169.254.169.254/"])("refuses a redirect to %s without requesting it", async (to) => {
    const requestOnce = vi.fn().mockResolvedValueOnce(redirect(to))
    expect(await fetchPublic("https://x.com/", requestOnce)).toEqual({ error: "Not read: the page redirected to an address that isn't public https." })
    expect(requestOnce).toHaveBeenCalledTimes(1)
  })
  it("refuses a redirect with no location", async () => {
    const requestOnce = vi.fn().mockResolvedValueOnce({ ...redirect(""), location: null })
    expect(await fetchPublic("https://x.com/", requestOnce)).toEqual({ error: "Not read: the page redirected to an address that isn't public https." })
  })
  it("stops after 3 redirects", async () => {
    const requestOnce = vi.fn().mockResolvedValue(redirect("https://x.com/again"))
    expect(await fetchPublic("https://x.com/", requestOnce)).toEqual({ error: "Not read: too many redirects." })
    expect(requestOnce).toHaveBeenCalledTimes(4)
  })
  it("refuses a non-public first url without requesting it", async () => {
    const requestOnce = vi.fn()
    expect(await fetchPublic("https://localhost/", requestOnce)).toEqual({ error: "Not read: only public https pages can be read." })
    expect(requestOnce).not.toHaveBeenCalled()
  })
  it("turns statuses and errors into plain messages", async () => {
    expect(await fetchPublic("https://x.com/", vi.fn().mockResolvedValue({ ...ok(), status: 404 }))).toEqual({ error: "Not read: the page answered 404." })
    expect(await fetchPublic("https://x.com/", vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ERR_PRIVATE_ADDRESS" }))))
      .toEqual({ error: "Not read: that site's address isn't public." })
    expect(await fetchPublic("https://x.com/", vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }))))
      .toEqual({ error: "Not read: the page took too long to load." })
    expect(await fetchPublic("https://x.com/", vi.fn().mockRejectedValue(Object.assign(new Error("a"), { name: "AbortError" }))))
      .toEqual({ error: "Not read: the page took too long to load." })
    expect(await fetchPublic("https://x.com/", vi.fn().mockRejectedValue(new Error("boom"))))
      .toEqual({ error: "Not read: the page couldn't be reached." })
  })
  it("passes one signal to every hop", async () => {
    const requestOnce = vi.fn().mockResolvedValueOnce(redirect("/b")).mockResolvedValueOnce(ok())
    await fetchPublic("https://x.com/a", requestOnce)
    expect(requestOnce.mock.calls[0][1]).toBe(requestOnce.mock.calls[1][1])
  })
})

describe("pinnedFetch", () => {
  function fakeRequest(status: number, headers: Record<string, string>, chunks: Buffer[]) {
    const calls: { url: unknown; options: any; written: string[] }[] = []
    const impl = vi.fn((url: unknown, options: any, onResponse: (res: any) => void) => {
      const call = { url, options, written: [] as string[] }
      calls.push(call)
      return Object.assign(new EventEmitter(), {
        write: (data: string) => {
          call.written.push(data)
          return true
        },
        end: (data?: string) => {
          if (data) call.written.push(data)
          onResponse(Object.assign(Readable.from(chunks), { statusCode: status, headers }))
        },
      })
    })
    return { impl: impl as never, calls }
  }

  it.each(["http://example.com", "https://127.0.0.1/"])("refuses %s without making a request", async (url) => {
    const fake = fakeRequest(200, {}, [])
    await expect(pinnedFetch(url, {}, fake.impl)).rejects.toThrow("This address can't be reached.")
    expect(fake.calls).toHaveLength(0)
  })

  it("connects through safeLookup with the method, headers and body", async () => {
    const fake = fakeRequest(200, { "content-type": "application/json" }, [Buffer.from("{}")])
    const signal = new AbortController().signal
    await pinnedFetch("https://api.example.com/token", { method: "POST", headers: { Authorization: "Bearer k" }, body: "a=b", signal }, fake.impl)
    expect(fake.calls).toHaveLength(1)
    const { options, written } = fake.calls[0]
    expect(options.lookup).toBe(safeLookup)
    expect(options.method).toBe("POST")
    expect(options.agent).toBe(false)
    expect(options.signal).toBe(signal)
    expect(options.headers).toEqual({ Authorization: "Bearer k", "user-agent": "AppxPrompt", accept: "*/*", "accept-encoding": "identity" })
    expect(written.join("")).toBe("a=b")
  })

  it("sends default user-agent and accept headers, which caller headers override", async () => {
    const plain = fakeRequest(200, {}, [])
    await pinnedFetch("https://api.example.com/", {}, plain.impl)
    expect(plain.calls[0].options.headers).toMatchObject({ "user-agent": "AppxPrompt", accept: "*/*", "accept-encoding": "identity" })

    const custom = fakeRequest(200, {}, [])
    await pinnedFetch("https://api.example.com/", { headers: { Accept: "application/json", "Accept-Encoding": "gzip" } }, custom.impl)
    expect(custom.calls[0].options.headers).toEqual({ "user-agent": "AppxPrompt", Accept: "application/json", "accept-encoding": "identity" })
  })

  it("defaults to GET with a timeout signal", async () => {
    const fake = fakeRequest(200, {}, [])
    await pinnedFetch("https://api.example.com/", undefined, fake.impl)
    expect(fake.calls[0].options.method).toBe("GET")
    expect(fake.calls[0].options.signal).toBeInstanceOf(AbortSignal)
  })

  it("returns a redirect as is, without a second request", async () => {
    const fake = fakeRequest(302, { location: "https://elsewhere.example.com/" }, [])
    const response = await pinnedFetch("https://api.example.com/", {}, fake.impl)
    expect(response.status).toBe(302)
    expect(fake.calls).toHaveLength(1)
  })

  it("keeps at most 1,000,000 bytes of the body", async () => {
    const fake = fakeRequest(200, {}, [Buffer.alloc(750_000, "a"), Buffer.alloc(750_000, "a")])
    const response = await pinnedFetch("https://api.example.com/", {}, fake.impl)
    expect((await response.text()).length).toBe(1_000_000)
  })

  it("carries over the status and content-type", async () => {
    const fake = fakeRequest(401, { "content-type": "application/json" }, [Buffer.from('{"e":1}')])
    const response = await pinnedFetch("https://api.example.com/", {}, fake.impl)
    expect(response.status).toBe(401)
    expect(response.headers.get("content-type")).toBe("application/json")
    expect(await response.json()).toEqual({ e: 1 })
  })

  it("rejects without the query, headers or body in the error", async () => {
    const impl = vi.fn(() => {
      const request = Object.assign(new EventEmitter(), {
        write: () => true,
        end: () => {
          request.emit("error", new Error("ECONNRESET"))
        },
      })
      return request
    })
    const error = await pinnedFetch("https://api.example.com/?key=SECRET", { headers: { a: "SECRET" }, body: "SECRET" }, impl as never).catch((e) => e)
    expect(String(error.message)).not.toContain("SECRET")
  })
})

describe("fetchPublic after the shared timeout", () => {
  it("reports a timeout, not an unreachable site, when the signal fired", async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal)
    try {
      const requestOnce = vi.fn(async () => {
        controller.abort()
        throw new Error("socket hang up")
      })
      expect(await fetchPublic("https://x.com/", requestOnce)).toEqual({ error: "Not read: the page took too long to load." })
    } finally {
      timeout.mockRestore()
    }
  })
})

describe("real sockets", () => {
  const publicName = "docs.example.com"
  let server: net.Server
  let port = 0
  let connections = 0

  beforeAll(async () => {
    server = net.createServer((socket) => {
      connections++
      socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    port = (server.address() as net.AddressInfo).port
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
  beforeEach(() => {
    connections = 0
    vi.mocked(dns.lookup).mockImplementation(((_h: string, _o: unknown, cb: Function) => cb(null, [{ address: "127.0.0.1", family: 4 }])) as never)
  })
  afterEach(() => vi.restoreAllMocks())

  const toLocalPort = ((url: string, options: object, callback: never) => originalRequest(url, { ...options, port }, callback)) as typeof https.request

  it("pinnedFetch never connects to a private address behind a public-looking name", async () => {
    const error = await pinnedFetch(`https://${publicName}/`, {}, toLocalPort).catch((e) => e)
    expect(error).toMatchObject({ code: "ERR_PRIVATE_ADDRESS" })
    expect(dns.lookup).toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(connections).toBe(0)
  })

  it("httpsRequestOnce never connects either, and never uses a shared agent", async () => {
    const spy = vi.spyOn(https, "request").mockImplementation(((url: string, options: object, callback: never) =>
      originalRequest(url, { ...options, port }, callback)) as never)
    const error = await httpsRequestOnce(`https://${publicName}/`, AbortSignal.timeout(5000)).catch((e) => e)
    expect(error).toMatchObject({ code: "ERR_PRIVATE_ADDRESS" })
    expect(spy.mock.calls[0][1]).toMatchObject({ agent: false })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(connections).toBe(0)
  })
})