import { z } from "zod"

import { findKeys } from "@/lib/services/key-patterns"
import { MAX_NOTES_LENGTH } from "@/lib/services/lessons"
import { envPrefix, SYSTEM_SERVICE_SLUG, type ServiceCheck, type ServiceDefinition, type ServiceField } from "@/lib/services/protocol"

const SLUG = /^[a-z][a-z0-9-]{1,39}$/
const FIELD_NAME = /^[A-Z][A-Z0-9_]{1,63}$/
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/
const QUERY_NAME = /^[A-Za-z0-9_.-]{1,64}$/
const RESERVED_AUTH_PARAMS = [
  "client_id",
  "redirect_uri",
  "state",
  "response_type",
  "scope",
  "code_challenge",
  "code_challenge_method",
]
const MAX_VALUE_LENGTH = 4096

export const serviceDefinitionSchema = z.object({
  slug: z.string().describe("Lowercase id with letters, digits and dashes, e.g. openai or google-calendar"),
  name: z.string().describe("Name shown to the person, e.g. OpenAI"),
  purpose: z.string().describe("One sentence on what the app uses this service for"),
  docsUrl: z.string().describe("https link to the service's API documentation"),
  authKind: z.enum(["api_key", "oauth2"]).describe("api_key for a pasted key, oauth2 for a sign-in connection"),
  fields: z
    .array(
      z.object({
        name: z
          .string()
          .describe("Env var name in capitals, starting with the slug in capitals, e.g. OPENAI_API_KEY"),
        label: z.string().describe("Short label shown to the person"),
        kind: z.enum(["secret", "public"]).describe("secret for keys and tokens, public for ids that are safe to show"),
        help: z.string().describe("Where the person finds this value"),
      }),
    )
    .describe("The values the person has to provide"),
  allowedHosts: z.array(z.string()).describe("Hostnames the service's API lives on, e.g. api.openai.com"),
  oauth: z
    .object({
      authUrl: z.string().describe("https URL the person is sent to in order to approve access"),
      tokenUrl: z.string().describe("https URL that exchanges the approval for tokens. Its host must be in allowedHosts"),
      scopes: z.array(z.string()).describe("Scopes to request"),
      params: z
        .array(z.object({ key: z.string(), value: z.string() }))
        .describe("Extra authorization URL params, e.g. key access_type with value offline. Use an empty array for none"),
      clientIdField: z.string().describe("Name of the public field holding the client id"),
      clientSecretField: z.string().describe("Name of the secret field holding the client secret"),
      rotatesRefreshToken: z.boolean().describe("True if the service issues a new refresh token on every refresh"),
    })
    .nullable()
    .describe("Sign-in settings for oauth2, or null for api_key"),
  check: z
    .object({
      method: z.enum(["GET", "POST"]),
      url: z.string().describe("https URL of a cheap request that fails when the credential is wrong"),
      credential: z.string().describe("Name of the field whose value is sent"),
      placement: z.object({
        in: z.enum(["header", "query"]),
        name: z.string().describe("Header or query parameter name"),
        format: z
          .string()
          .nullable()
          .describe("For a header, the value with {value} where the credential goes, e.g. Bearer {value}. Null for query"),
      }),
    })
    .nullable()
    .describe("A request to test an api_key credential, or null when there is no cheap one"),
  setupSteps: z.string().describe("Plain steps for getting the credentials, as markdown"),
  notes: z.string().describe("Facts the code needs: endpoints, request shapes, limits. No credentials"),
})

function isHttps(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

/** An https URL on the default port without userinfo, the only kind the server will call or send the owner to. */
function isPlainHttps(value: string): URL | null {
  const url = isHttps(value)
  return url && url.port === "" && url.username === "" && url.password === "" ? url : null
}

function checkReason(
  check: NonNullable<z.infer<typeof serviceDefinitionSchema>["check"]>,
  hosts: string[],
  fields: ServiceField[],
): ServiceCheck | string {
  const url = isPlainHttps(check.url)
  if (!url) return `The check url must be an https URL without a port or login, not "${check.url}".`
  if (!hosts.includes(url.hostname.toLowerCase())) {
    return `The check url host ${url.hostname} isn't in allowedHosts.`
  }
  if (!fields.some((field) => field.name === check.credential)) {
    return `The check credential ${check.credential} isn't one of the fields.`
  }
  const { placement } = check
  if (placement.in === "header") {
    if (!HEADER_NAME.test(placement.name)) return `"${placement.name}" isn't a valid header name.`
    if (!placement.format || !placement.format.includes("{value}")) {
      return "The check header format must contain {value}, e.g. Bearer {value}."
    }
    return {
      method: check.method,
      url: check.url,
      credential: check.credential,
      placement: { in: "header", name: placement.name, format: placement.format },
    }
  }
  if (!QUERY_NAME.test(placement.name)) return `"${placement.name}" isn't a valid query parameter name.`
  return {
    method: check.method,
    url: check.url,
    credential: check.credential,
    placement: { in: "query", name: placement.name },
  }
}

/** Tidies a proposed service, or returns why it can't be used. */
export function normalizeService(input: z.infer<typeof serviceDefinitionSchema>): ServiceDefinition | string {
  if (!SLUG.test(input.slug)) {
    return `The slug "${input.slug}" must be lowercase letters, digits and dashes, starting with a letter, 2 to 40 characters.`
  }
  if (input.slug === SYSTEM_SERVICE_SLUG) return `The slug ${SYSTEM_SERVICE_SLUG} is reserved.`
  if (input.name.length < 1 || input.name.length > 60) return "The name must be 1 to 60 characters."
  if (input.purpose.length > 300) return "The purpose must be at most 300 characters."
  if (input.setupSteps.length > 4000) return "The setup steps must be at most 4000 characters."
  if (input.notes.length > MAX_NOTES_LENGTH) return `The notes must be at most ${MAX_NOTES_LENGTH} characters.`
  if (!isHttps(input.docsUrl)) return `The docs url must be an https URL, not "${input.docsUrl}".`

  if (input.fields.length < 1 || input.fields.length > 10) {
    return `The service has ${input.fields.length} fields. Use between 1 and 10.`
  }
  const prefix = `${envPrefix(input.slug)}_`
  const seen = new Set<string>()
  for (const field of input.fields) {
    if (!FIELD_NAME.test(field.name)) {
      return `The field name ${field.name} must be capitals, digits and underscores, starting with a letter.`
    }
    if (!field.name.startsWith(prefix)) return `The field name ${field.name} must start with ${prefix}.`
    if (seen.has(field.name)) return `The field name ${field.name} is used twice.`
    seen.add(field.name)
    if (field.name.endsWith("_REFRESH_TOKEN")) {
      return `The field name ${field.name} can't end with _REFRESH_TOKEN, because that name is kept for the stored refresh token.`
    }
    if (field.name.startsWith("APPXPROMPT_")) return `The field name ${field.name} can't start with APPXPROMPT_.`
    if (field.label.length > 60) return `The label for ${field.name} must be at most 60 characters.`
    if (field.help.length > 300) return `The help for ${field.name} must be at most 300 characters.`
  }

  if (input.allowedHosts.length < 1 || input.allowedHosts.length > 10) {
    return `The service has ${input.allowedHosts.length} allowed hosts. Use between 1 and 10.`
  }
  const allowedHosts = [...new Set(input.allowedHosts.map((host) => host.trim().toLowerCase()))]
  for (const host of allowedHosts) {
    if (!HOSTNAME.test(host)) return `"${host}" isn't a hostname. Use names like api.example.com, not IP addresses or localhost.`
  }

  const fields: ServiceField[] = input.fields.map((field) => ({
    name: field.name,
    label: field.label,
    kind: field.kind,
    help: field.help,
  }))

  let check: ServiceCheck | null = null
  let oauth: ServiceDefinition["oauth"] = null

  if (input.authKind === "api_key") {
    if (input.oauth !== null) return "An api_key service must have oauth set to null."
    if (input.check) {
      const result = checkReason(input.check, allowedHosts, fields)
      if (typeof result === "string") return result
      check = result
    }
  } else {
    const config = input.oauth
    if (!config) return "An oauth2 service needs oauth settings."
    if (input.check !== null) return "An oauth2 service must have check set to null."
    if (!isPlainHttps(config.authUrl)) {
      return `The authUrl must be an https URL without a port or login, not "${config.authUrl}".`
    }
    const tokenUrl = isPlainHttps(config.tokenUrl)
    if (!tokenUrl) return `The tokenUrl must be an https URL without a port or login, not "${config.tokenUrl}".`
    if (!allowedHosts.includes(tokenUrl.hostname.toLowerCase())) {
      return `The tokenUrl host ${tokenUrl.hostname} isn't in allowedHosts.`
    }
    if (config.scopes.length < 1 || config.scopes.length > 20) {
      return `The service has ${config.scopes.length} scopes. Use between 1 and 20.`
    }
    if (fields.find((field) => field.name === config.clientIdField)?.kind !== "public") {
      return `clientIdField ${config.clientIdField} must name a public field.`
    }
    if (fields.find((field) => field.name === config.clientSecretField)?.kind !== "secret") {
      return `clientSecretField ${config.clientSecretField} must name a secret field.`
    }
    if (config.rotatesRefreshToken) {
      return `${input.name} issues a new refresh token on every refresh, which isn't supported yet.`
    }
    const params: Record<string, string> = {}
    for (const { key, value } of config.params) {
      if (RESERVED_AUTH_PARAMS.includes(key)) return `The authorization param ${key} is set for you. Remove it from params.`
      params[key] = value
    }
    oauth = {
      authUrl: config.authUrl,
      tokenUrl: config.tokenUrl,
      scopes: config.scopes,
      params,
      clientIdField: config.clientIdField,
      clientSecretField: config.clientSecretField,
    }
  }

  const text = [input.notes, input.setupSteps, input.purpose, ...fields.map((field) => field.help)]
  if (text.some((value) => findKeys(value).length > 0)) return "Service text can't contain credentials."

  return {
    slug: input.slug,
    name: input.name,
    purpose: input.purpose,
    docsUrl: input.docsUrl,
    authKind: input.authKind,
    fields,
    allowedHosts,
    oauth,
    check,
    setupSteps: input.setupSteps,
    notes: input.notes,
  }
}

/** Checks the values a person typed for a service, or returns why they can't be used. */
export function validateValues(definition: ServiceDefinition, values: unknown): Record<string, string> | string {
  if (typeof values !== "object" || values === null || Array.isArray(values)) return "Values must be an object."
  const names = new Set(definition.fields.map((field) => field.name))
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!names.has(key)) return `Unknown field ${key}.`
    if (typeof value !== "string") return `${key} must be text.`
    const trimmed = value.trim()
    if (trimmed.length > MAX_VALUE_LENGTH) return `${key} is too long. The limit is ${MAX_VALUE_LENGTH} characters.`
    if (trimmed) result[key] = trimmed
  }
  return result
}

/** Hosts in next that weren't in previous. */
export function addedHosts(previous: string[], next: string[]): string[] {
  return next.filter((host) => !previous.includes(host))
}
