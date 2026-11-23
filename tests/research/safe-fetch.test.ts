import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"

vi.mock("node:dns", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:dns")>()), lookup: vi.fn() }))
const dns = await import("node:dns")
const { fetchPublic, isPrivateAddress, isPublicHttpsUrl, readLimited, safeLookup } = await import("@/lib/research/safe-fetch")

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
