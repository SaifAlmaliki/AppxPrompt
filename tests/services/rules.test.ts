import { describe, expect, it } from "vitest"
import type { ServiceDefinition, ServiceField } from "@/lib/services/protocol"
import { canCheck, credentialCollision, definitionNames, staleCredentialNames, unapprovedHosts } from "@/lib/services/rules"

const apiKey = {
  slug: "openai",
  authKind: "api_key",
  allowedHosts: ["api.openai.com"],
  check: { method: "GET", url: "https://api.openai.com/v1/models", credential: "OPENAI_API_KEY", placement: { in: "query", name: "k" } },
} as ServiceDefinition

describe("credentialCollision", () => {
  it("allows names nobody else owns", () => {
    expect(credentialCollision("foo", ["FOO_KEY"], [{ name: "BAR_KEY", serviceSlug: "bar" }])).toBeNull()
  })
  it("allows names the same service already owns", () => {
    expect(credentialCollision("foo", ["FOO_KEY"], [{ name: "FOO_KEY", serviceSlug: "foo" }])).toBeNull()
  })
  it("refuses a field another service owns", () => {
    const reason = credentialCollision("foo", ["FOO_BAR_KEY"], [{ name: "FOO_BAR_KEY", serviceSlug: "foo-bar" }])
    expect(reason).toContain("FOO_BAR_KEY")
    expect(reason).toContain("foo-bar")
  })
  it("refuses the refresh token name another service owns", () => {
    expect(
      credentialCollision("foo", ["FOO_ID", "FOO_BAR_REFRESH_TOKEN"], [{ name: "FOO_BAR_REFRESH_TOKEN", serviceSlug: "foo-bar" }]),
    ).toContain("FOO_BAR_REFRESH_TOKEN")
  })
})

describe("unapprovedHosts", () => {
  it("lists hosts the owner hasn't approved", () => {
    expect(unapprovedHosts({ allowedHosts: ["a.com", "b.com"] }, ["a.com"])).toEqual(["b.com"])
    expect(unapprovedHosts({ allowedHosts: ["a.com"] }, ["a.com", "x.com"])).toEqual([])
    expect(unapprovedHosts({ allowedHosts: ["a.com"] }, [])).toEqual(["a.com"])
  })
})

describe("canCheck", () => {
  it("is true when every host is approved and there is something to call", () => {
    expect(canCheck(apiKey, ["api.openai.com"])).toBe(true)
  })
  it("is false when a host was added after approval", () => {
    expect(canCheck({ ...apiKey, allowedHosts: ["api.openai.com", "evil.example.com"] }, ["api.openai.com"])).toBe(false)
    expect(canCheck({ ...apiKey, authKind: "oauth2", check: null, allowedHosts: ["a.com"] }, [])).toBe(false)
  })
  it("is false for an api_key service without a check", () => {
    expect(canCheck({ ...apiKey, check: null }, ["api.openai.com"])).toBe(false)
  })
  it("is true for an approved oauth2 service", () => {
    expect(canCheck({ ...apiKey, authKind: "oauth2", check: null }, ["api.openai.com"])).toBe(true)
  })
})

describe("staleCredentialNames", () => {
  const fields: ServiceField[] = [
    { name: "FOO_ID", label: "", kind: "secret", help: "" },
    { name: "FOO_KEY", label: "", kind: "public", help: "" },
  ]
  it("lists stored values whose kind no longer matches the field", () => {
    expect(
      staleCredentialNames(fields, [
        { name: "FOO_ID", kind: "public" },
        { name: "FOO_KEY", kind: "public" },
      ]),
    ).toEqual(["FOO_ID"])
  })
  it("ignores values with no field, such as the refresh token", () => {
    expect(staleCredentialNames(fields, [{ name: "FOO_REFRESH_TOKEN", kind: "oauth_token" }])).toEqual([])
  })
})

describe("definitionNames", () => {
  it("lists the fields, plus the refresh token for oauth2", () => {
    const fields: ServiceField[] = [{ name: "FOO_BAR_ID", label: "", kind: "public", help: "" }]
    expect(definitionNames({ slug: "foo-bar", authKind: "api_key", fields })).toEqual(["FOO_BAR_ID"])
    expect(definitionNames({ slug: "foo-bar", authKind: "oauth2", fields })).toEqual(["FOO_BAR_ID", "FOO_BAR_REFRESH_TOKEN"])
  })
})