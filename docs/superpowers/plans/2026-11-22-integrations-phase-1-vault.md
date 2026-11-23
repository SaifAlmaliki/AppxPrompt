# Integrations Phase 1: Credentials Vault, Service Dialog, and Paste Protection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AppxPrompt agent register an outside service a generated app needs. The owner then gives that service's credentials to the project: an API key, or the owner's own OAuth client plus a one-click connect. Credentials are kept encrypted and never reach the chat, the model, or the browser after saving.

**Architecture:**
- **Pure modules** in `lib/services/` hold every rule and are unit-tested: definitions, key patterns, status, hints, check requests, and OAuth helpers.
- **The database:** two Drizzle tables store service definitions and sealed credentials, and `lib/services/store.ts` is the only code that touches them.
- **Routes:** owner-only routes serve the workspace, and a single `/api/oauth/callback` completes OAuth with the owner's client.
- **The planner** gets a `register_service` tool behind the `APP_INTEGRATIONS=1` flag. It emits `services` and `service-request` events that open the new dialog.
- **Key redaction** runs in the browser, on the server, in a one-time migration, and in Sentry, whatever the flag says.

**Tech Stack:** Next.js 16 route handlers, Drizzle ORM / Postgres, zod 4, the OpenAI Agents SDK `tool()`, next-intl, vitest (node environment, `tests/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-11-22-app-integrations-design.md`. This plan covers its build order phase 1: sections 1, 2, the parts of 3 that need no web tools, and 8.

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing any route handler. This Next.js has breaking changes (`AGENTS.md`).
- **Encryption:** use `seal()` / `unseal()` from `lib/cloudhike/crypto.ts`. Secrets and OAuth tokens are always sealed. Public values are stored plain.
- **Where values may go:** a credential value never appears in API responses, events, planner context, chat messages, logs, or Sentry. The only exceptions are `public` values and hints.
- **Who may see or change credentials:** only the project owner (`getProjectAccess(...).role === "owner"`). Everyone else gets `errorResponse("projectNotFound", 404)`.
- **Interface text:** every string goes in `messages/en.json` **and** `messages/ar.json` under the same keys. No literal JSX text (`tests/i18n/no-literal-text.test.ts`). Every text `<input>` needs `dir`. Use only logical Tailwind classes (`ms-`, `pe-`, `text-start`; see `tests/i18n/logical-classes.test.ts`).
- **The removal marker** inserted in place of a removed key is exactly `[key removed and moved to the keys dialog]`.
- **The feature flag:** `APP_INTEGRATIONS === "1"` turns on the planner tool, its instructions, and the header button. Paste protection, the migration and Sentry scrubbing are always on.
- **The OAuth callback** path is `/api/oauth/callback`. The redirect URI is `${NEXT_PUBLIC_APP_URL || origin}/api/oauth/callback`.
- **Tests:** run with `npx vitest run --configLoader runner <file>`. Typecheck with `npx tsc --noEmit`. Lint with `npm run lint`.

## Review Focus

1. **A key in an unusual spot.** That could be wrapped in quotes or backticks, glued to punctuation (`key:sk-proj-…,`), split across lines in a code block, or several keys in one message. Every match must be removed, and the text around it kept. *(Task 1 tests.)*
2. **Re-registering a service from the agent.** An agent that registers the same service again with an extra host must not keep it "connected". It must drop to `missing` until the owner saves again. If the agent drops a field, that field's stored value must be deleted, not left orphaned. *(Tasks 3 and 5 tests.)*
3. **Coming back from OAuth with nothing usable.** That covers a denied consent, an expired or missing state cookie, a different user being signed in, or Google returning no `refresh_token`. Each one must redirect to the workspace with a clear result, and never save a half-connected service. *(Task 4 tests and the Task 7 manual check.)*
4. **Saving the form with a field left blank.** Leaving a field empty on Save means "keep the stored value", not "erase it". Unknown field names and over-long values are refused. *(Task 2 tests.)*
5. **Check calls the server makes.** They must only go to an allowed `https` host, must not follow redirects, and must time out. A provider that's down must give `unreachable`, never `rejected`. *(Task 4 tests.)*

---

### Task 1: Key patterns, redaction, and Sentry scrubbing

**Files:**
- Create: `lib/services/key-patterns.ts`
- Modify: `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation-client.ts`
- Test: `tests/services/key-patterns.test.ts`

**Interfaces:**
- Produces:
  - `KEY_PATTERN_SOURCES: readonly string[]`. These are regex sources that must be valid in both JavaScript and Postgres ARE, so no `\b`, no lookbehind, and no named groups.
  - `KEY_REMOVED = "[key removed and moved to the keys dialog]"`.
  - `findKeys(text: string): string[]`, which returns matches in order with no duplicates.
  - `redactKeys(text: string): { text: string; keys: string[] }`.
  - `scrubSecrets<T>(value: T): T`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest"
import { KEY_PATTERN_SOURCES, KEY_REMOVED, findKeys, redactKeys, scrubSecrets } from "@/lib/services/key-patterns"

const openai = "sk-proj-" + "a".repeat(40)
const zernio = "sk_" + "0123456789abcdef".repeat(4)
const googleSecret = "GOCSPX-" + "b".repeat(28)
const googleKey = "AIza" + "c".repeat(35)

describe("findKeys", () => {
  it("finds common provider keys", () => {
    expect(findKeys(`a ${openai} b ${zernio} c ${googleSecret} d ${googleKey}`)).toEqual([openai, zernio, googleSecret, googleKey])
  })
  it("finds keys glued to punctuation and quotes", () => {
    expect(findKeys(`key:"${openai}",`)).toEqual([openai])
    expect(findKeys("`" + zernio + "`")).toEqual([zernio])
  })
  it("ignores ordinary text and short sk- words", () => {
    expect(findKeys("sk-short and a skin-care app")).toEqual([])
  })
  it("returns each key once", () => {
    expect(findKeys(`${openai} ${openai}`)).toEqual([openai])
  })
})

describe("redactKeys", () => {
  it("replaces every key and keeps the rest", () => {
    expect(redactKeys(`use ${openai}\nand ${zernio}.`)).toEqual({
      text: `use ${KEY_REMOVED}\nand ${KEY_REMOVED}.`,
      keys: [openai, zernio],
    })
  })
})

describe("scrubSecrets", () => {
  it("redacts nested strings without changing other values", () => {
    expect(scrubSecrets({ a: [`x ${openai}`], n: 1, ok: true })).toEqual({ a: [`x ${KEY_REMOVED}`], n: 1, ok: true })
  })
})

describe("KEY_PATTERN_SOURCES", () => {
  it("uses no syntax Postgres can't run", () => {
    for (const source of KEY_PATTERN_SOURCES) expect(source).not.toMatch(/\\b|\(\?<|\(\?=|\(\?!/)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/services/key-patterns.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `lib/services/key-patterns.ts`**

The pattern sources, exactly:

```ts
export const KEY_PATTERN_SOURCES = [
  "sk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{20,}",
  "(?:sk|rk)_(?:live_|test_)?[A-Za-z0-9]{20,}",
  "GOCSPX-[A-Za-z0-9_-]{20,}",
  "AIza[0-9A-Za-z_-]{35}",
  "gh[pousr]_[A-Za-z0-9]{30,}",
  "github_pat_[A-Za-z0-9_]{40,}",
  "xox[abposr]-[A-Za-z0-9-]{10,}",
  "AKIA[0-9A-Z]{16}",
  "eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}",
] as const
```

Build one global `RegExp` by joining the sources with `|`. `scrubSecrets` deep-maps arrays and plain objects, and passes other values through.

- [ ] **Step 4: Wire Sentry**

In `sentry.server.config.ts` and `sentry.edge.config.ts`, add `beforeSend: (event) => scrubSecrets(event)` and `beforeBreadcrumb: (crumb) => scrubSecrets(crumb)`. Add the same pair to the `Sentry.init` call in `instrumentation-client.ts`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run --configLoader runner tests/services/key-patterns.test.ts`, then `npx tsc --noEmit`
Expected: PASS, then no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/services/key-patterns.ts tests/services/key-patterns.test.ts sentry.server.config.ts sentry.edge.config.ts instrumentation-client.ts
git commit -m "feat(services): detect and redact pasted credentials, scrub Sentry events"
```

---

### Task 2: Service definitions and value validation

**Files:**
- Create: `lib/services/protocol.ts` (types and constants shared by client and server; no server imports), `lib/services/definition.ts`
- Test: `tests/services/definition.test.ts`

**Interfaces:**
- Produces (`protocol.ts`):

```ts
export type ServiceFieldKind = "secret" | "public"
export type ServiceField = { name: string; label: string; kind: ServiceFieldKind; help: string }
export type OAuthConfig = {
  authUrl: string; tokenUrl: string; scopes: string[]; params: Record<string, string>
  clientIdField: string; clientSecretField: string
}
export type ServiceCheck = {
  method: "GET" | "POST"; url: string; credential: string
  placement: { in: "header"; name: string; format: string } | { in: "query"; name: string }
}
export type ServiceDefinition = {
  slug: string; name: string; purpose: string; docsUrl: string
  authKind: "api_key" | "oauth2"; fields: ServiceField[]; allowedHosts: string[]
  oauth: OAuthConfig | null; check: ServiceCheck | null; setupSteps: string; notes: string
}
export type ServiceStatus = "missing" | "connected" | "rejected"
export type CheckResult = "ok" | "rejected" | null
export type ServiceSummary = {
  slug: string; name: string; purpose: string; docsUrl: string; authKind: ServiceDefinition["authKind"]
  allowedHosts: string[]; setupSteps: string; status: ServiceStatus; checkResult: CheckResult; checkedAt: string | null
  fields: { name: string; label: string; kind: ServiceFieldKind; help: string; set: boolean; hint: string | null }[]
  oauthConnected: boolean
}
export type PlannerService = { slug: string; name: string; status: ServiceStatus; fields: { name: string; set: boolean }[] }
export const SERVICE_CONNECT_RESULTS = ["connected", "denied", "no_refresh_token", "error"] as const
export type ServiceConnectResult = (typeof SERVICE_CONNECT_RESULTS)[number]
export const OAUTH_CALLBACK_PATH = "/api/oauth/callback"
export function oauthRedirectUri(origin: string): string // `${process.env.NEXT_PUBLIC_APP_URL || origin}${OAUTH_CALLBACK_PATH}`
export function envPrefix(slug: string): string          // "google-calendar" -> "GOOGLE_CALENDAR"
export function refreshTokenName(slug: string): string   // `${envPrefix(slug)}_REFRESH_TOKEN`
```

- Produces (`definition.ts`):
  - `serviceDefinitionSchema`, the zod object used as the planner tool's parameters. Every key is required, and optional values use `.nullable()`, following `backendSchema` in `lib/agent/planner.ts`. It adds `rotatesRefreshToken: boolean` inside `oauth`.
  - `normalizeService(input: z.infer<typeof serviceDefinitionSchema>): ServiceDefinition | string`. It returns a plain-English reason for the agent when the input can't be used.
  - `validateValues(definition: ServiceDefinition, values: unknown): Record<string, string> | string`.
  - `addedHosts(previous: string[], next: string[]): string[]`.

**What `normalizeService` checks.** Return the first failing reason.

| What | Rule |
|---|---|
| `slug` | `/^[a-z][a-z0-9-]{1,39}$/` |
| `name` | 1 to 60 characters |
| `purpose` | at most 300 characters |
| `setupSteps` | at most 4000 characters |
| `notes` | at most 20000 characters |
| `docsUrl` | `https:` |
| `fields` | 1 to 10 entries |
| Each field name | `/^[A-Z][A-Z0-9_]{1,63}$/`, starts with `${envPrefix(slug)}_`, unique, doesn't end with `_REFRESH_TOKEN`, doesn't start with `APPXPROMPT_` |
| Each field `label` | at most 60 characters |
| Each field `help` | at most 300 characters |
| `allowedHosts` | 1 to 10 entries, each lowercased and deduplicated, and each a hostname (`/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/`). `localhost` and IP literals are refused. |
| `api_key` | `oauth` must be null. |
| `check`, if present | `url` is `https:` and its host is in `allowedHosts`. `credential` names a field. A header `name` matches `/^[A-Za-z0-9-]{1,64}$/`, and `format` contains `{value}`. A query `name` matches `/^[A-Za-z0-9_.-]{1,64}$/`. |
| `oauth2` | `oauth` is required and `check` must be null. `authUrl` and `tokenUrl` are `https:`, and the `tokenUrl` host is in `allowedHosts`. `scopes` has 1 to 20 entries. `clientIdField` names a `public` field, and `clientSecretField` names a `secret` field. `rotatesRefreshToken: true` is refused with the reason `"<name> issues a new refresh token on every refresh, which isn't supported yet."`. `params` keys can't be `client_id`, `redirect_uri`, `state`, `response_type`, `scope`, `code_challenge` or `code_challenge_method`. |
| Credentials in text | If `findKeys` matches anything in `notes`, `setupSteps`, `purpose` or any `help`, the reason is `"Service text can't contain credentials."`. |

**What `validateValues` checks.**
- `values` must be a plain object.
- Every key must be one of the definition's field names. Otherwise the reason is `"Unknown field <KEY>."`.
- Each value must be a string of at most 4096 characters after trimming.
- Empty strings are dropped, which means "keep the stored value".

- [ ] **Step 1: Write the failing tests**

Use one fixture helper, `openaiInput(overrides)`. It builds a valid `api_key` input: slug `openai`, field `OPENAI_API_KEY` (secret), hosts `["api.openai.com"]`, and a check of `GET https://api.openai.com/v1/models` with the header `Authorization` and the format `Bearer {value}`. A second helper, `googleInput(overrides)`, builds a valid `oauth2` input: slug `google-calendar`, fields `GOOGLE_CALENDAR_CLIENT_ID` (public) and `GOOGLE_CALENDAR_CLIENT_SECRET` (secret), `tokenUrl` `https://oauth2.googleapis.com/token`, hosts `["oauth2.googleapis.com","www.googleapis.com"]`, and params `{ access_type: "offline", prompt: "consent" }`.

Tests (one `it` each, with exact expectations):
- `openaiInput()` normalizes, with `allowedHosts` `["api.openai.com"]`, and `googleInput()` normalizes too.
- A field named `API_KEY` on slug `openai` gives a string containing `"OPENAI_"`.
- `allowedHosts: ["API.OpenAI.com","api.openai.com"]` gives `["api.openai.com"]`.
- `allowedHosts: ["127.0.0.1"]` and `["localhost"]` each give a string.
- A check URL on `evil.example.com` gives a string.
- `googleInput` with `tokenUrl` on a host that isn't allowed gives a string.
- `googleInput` with `oauth.rotatesRefreshToken: true` gives the exact rotation reason.
- `googleInput` with `params: { redirect_uri: "x" }` gives a string.
- Notes containing `"sk-proj-" + "a".repeat(40)` give `"Service text can't contain credentials."`.
- `validateValues(def, { OPENAI_API_KEY: "  sk-x  ", })` gives `{ OPENAI_API_KEY: "sk-x" }`.
- `validateValues(def, { OPENAI_API_KEY: "" })` gives `{}`.
- `validateValues(def, { OTHER: "x" })` gives `"Unknown field OTHER."`.
- `validateValues(def, { OPENAI_API_KEY: "x".repeat(4097) })` gives a string.
- `addedHosts(["a.com"], ["a.com","b.com"])` gives `["b.com"]`, and `addedHosts(["a.com","b.com"], ["a.com"])` gives `[]`.
- `envPrefix("google-calendar")` gives `"GOOGLE_CALENDAR"`, and `refreshTokenName("google-calendar")` gives `"GOOGLE_CALENDAR_REFRESH_TOKEN"`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/services/definition.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `lib/services/protocol.ts` and `lib/services/definition.ts`** to the interfaces and rules above.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --configLoader runner tests/services/definition.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/services/protocol.ts lib/services/definition.ts tests/services/definition.test.ts
git commit -m "feat(services): validate service definitions and credential values"
```

---

### Task 3: Status, hints, and summaries

**Files:**
- Create: `lib/services/status.ts`
- Test: `tests/services/status.test.ts`

**Interfaces:**
- Consumes: the types from Task 2.
- Produces:
  - `type StoredCredential = { name: string; kind: "secret" | "public" | "oauth_token"; hint: string | null; publicValue: string | null }`
  - `credentialHint(value: string, kind: "secret" | "public"): string`
  - `serviceStatus(definition: ServiceDefinition, setNames: ReadonlySet<string>, approvedHosts: readonly string[], checkResult: CheckResult): ServiceStatus`
  - `summarizeService(definition, credentials: StoredCredential[], approvedHosts, checkResult, checkedAt: Date | null): ServiceSummary`
  - `plannerServices(summaries: ServiceSummary[]): PlannerService[]`

**How a status is worked out:**
1. Any host in `definition.allowedHosts` that isn't in `approvedHosts` gives `missing`.
2. For `api_key`: if any field isn't set, `missing`. Otherwise `rejected` when `checkResult === "rejected"`, else `connected`.
3. For `oauth2`: if the client fields or `refreshTokenName(slug)` aren't set, `missing`. Otherwise `rejected` when `checkResult === "rejected"`, else `connected`.

**How a hint is built:**
- A `public` value is shown whole.
- A `secret` value under 12 characters becomes `"••••"`.
- Otherwise it's the leading prefix matching `/^[A-Za-z]{2,8}[-_](?:proj-)?/`, if any, followed by `"…"` and the last 4 characters.

**In a summary**, each field's `hint` is the stored hint, so a public field's hint is its whole value. `oauthConnected` is whether the refresh token is set.

- [ ] **Step 1: Write the failing tests**

- `credentialHint("sk-proj-" + "a".repeat(36) + "a1b2", "secret")` gives `"sk-proj-…a1b2"`.
- `credentialHint("GOCSPX-abcdefghijklmnop1234", "secret")` gives `"GOCSPX-…1234"`.
- `credentialHint("short", "secret")` gives `"••••"`.
- `credentialHint("123.apps.googleusercontent.com", "public")` gives the same string back.
- `serviceStatus(openai, new Set(["OPENAI_API_KEY"]), ["api.openai.com"], null)` gives `"connected"`. The same with `"rejected"` gives `"rejected"`. The same with `new Set()` gives `"missing"`.
- **Review Focus 2:** an openai definition whose `allowedHosts` adds `"files.openai.com"`, with approvedHosts `["api.openai.com"]` and every field set, gives `"missing"`.
- For google, both client fields set but no refresh token gives `"missing"`. Adding `GOOGLE_CALENDAR_REFRESH_TOKEN` gives `"connected"`.
- `summarizeService(...)` for google with a stored public client ID shows that field's `hint` as the full client ID, the secret field's `hint` as the stored hint, and `oauthConnected: true`. `JSON.stringify` of the summary doesn't contain a sealed value passed in as a decoy.
- `plannerServices([summary])` gives `[{ slug, name, status, fields: [{ name, set }] }]`, with no hints, labels, or hosts.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/services/status.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `lib/services/status.ts`**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --configLoader runner tests/services/status.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/services/status.ts tests/services/status.test.ts
git commit -m "feat(services): compute service status, hints, and summaries"
```

---

### Task 4: Credential checks and OAuth helpers

**Files:**
- Create: `lib/services/check.ts`, `lib/services/oauth.ts` (both server only)
- Test: `tests/services/check.test.ts`, `tests/services/oauth.test.ts`

**Interfaces:**
- Consumes: the types from Task 2.
- Produces (`check.ts`). Each call takes `fetchImpl: typeof fetch = fetch` as its last parameter:
  - `buildCheckRequest(check: ServiceCheck, values: Record<string, string>): { url: string; init: RequestInit }`
  - `runCheck(definition, values, fetchImpl?): Promise<"ok" | "rejected" | "unreachable">`
  - `exchangeCode(input: { definition; clientId; clientSecret; code; verifier; redirectUri }, fetchImpl?): Promise<{ refreshToken: string } | { error: "no_refresh_token" | "error" }>`
  - `refreshAccessToken(input: { definition; clientId; clientSecret; refreshToken }, fetchImpl?): Promise<"ok" | "rejected" | "unreachable">`
- Produces (`oauth.ts`):
  - `OAUTH_STATE_COOKIE = "appxprompt_oauth_state"`
  - `OAUTH_STATE_MAX_AGE = 1800`
  - `createPkce(): { verifier: string; challenge: string }`, using S256 and base64url
  - `authorizationUrl(definition, clientId, redirectUri, state, challenge): string`
  - `encodeOAuthState(s: { state; projectId; slug; verifier }): string`, joined with `.`
  - `parseOAuthState(cookie: string | undefined): { state; projectId; slug; verifier } | null`
  - `sameState(a: string, b: string): boolean`, using `timingSafeEqual` with a length check

**Rules for every outgoing request:**
- It uses `redirect: "manual"` and `signal: AbortSignal.timeout(10_000)`.
- Its URL must be `https:` with a host in `definition.allowedHosts`. If not, don't fetch: the result is `"unreachable"`, or `{ error: "error" }` for `exchangeCode`.

**Reading the answer:**
- **`runCheck`:** a 2xx gives `"ok"`. A 401 or 403 gives `"rejected"`. Anything else, a thrown error or a timeout gives `"unreachable"`. With no `check` it returns `"ok"`.
- **Token calls** post `application/x-www-form-urlencoded`:
  - `exchangeCode` sends `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret` and `code_verifier`.
  - `refreshAccessToken` sends `grant_type=refresh_token`, `refresh_token`, `client_id` and `client_secret`. A 400 or 401 whose JSON `error` is `"invalid_grant"` or `"invalid_client"` gives `"rejected"`.

- [ ] **Step 1: Write the failing tests**

Use a fake `fetchImpl` that records `(url, init)` and returns a canned `Response`.

`check.test.ts`:
- `buildCheckRequest` with header placement sets `init.headers.Authorization = "Bearer sk-x"`. With query placement it appends `?key=sk-x`, keeping any existing query.
- **Review Focus 5:** `runCheck` with a 200 gives `"ok"`, a 401 gives `"rejected"`, a 503 gives `"unreachable"`, and a fetch that throws gives `"unreachable"`. The recorded init has `redirect: "manual"` and a `signal`.
- **Review Focus 5:** `runCheck` with a check URL host no longer in `allowedHosts` (a definition built by hand) never calls fetch and gives `"unreachable"`.
- `exchangeCode`:
  - A JSON `{ refresh_token: "rt" }` gives `{ refreshToken: "rt" }`, and the body contains `code_verifier=` and `grant_type=authorization_code`.
  - A JSON `{ access_token: "a" }` gives `{ error: "no_refresh_token" }`.
  - A 400 gives `{ error: "error" }`.
- `refreshAccessToken`: a 400 `{ error: "invalid_grant" }` gives `"rejected"`, and a 200 gives `"ok"`.

`oauth.test.ts`:
- `createPkce().challenge` equals the base64url SHA-256 of the verifier, and the verifier is 43 to 128 characters.
- `authorizationUrl` for the google fixture contains `response_type=code`, `client_id=`, `redirect_uri=`, `scope=` with the scopes joined by spaces, `state=`, `code_challenge_method=S256`, `access_type=offline` and `prompt=consent`.
- `parseOAuthState(encodeOAuthState(x))` gives `x`. `parseOAuthState(undefined)`, `parseOAuthState("a.b")` and a value with an extra part each give `null`.
- `sameState("abc","abc")` is true, and `sameState("abc","abd")` and `sameState("abc","ab")` are false.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/services/check.test.ts tests/services/oauth.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement both modules**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the same command
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/services/check.ts lib/services/oauth.ts tests/services/check.test.ts tests/services/oauth.test.ts
git commit -m "feat(services): credential checks, OAuth code exchange, PKCE and state helpers"
```

---

### Task 5: Tables, migrations, and the store

**Files:**
- Modify: `db/schema.ts` (and its export through `@/db` if the barrel lists tables)
- Create: the generated `drizzle/0014_*.sql`, `drizzle/0015_redact_message_keys.sql` (custom), `lib/services/store.ts`, `lib/services/flags.ts`
- Test: `tests/services/migration.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces (`db/schema.ts`):
  - **`projectServices`** (table `project_services`)
    - Columns: `projectId` uuid (cascade to `projects`), `slug` text, `definition` jsonb `$type<ServiceDefinition>()` not null, `approvedHosts` text[] default `'{}'` not null, `checkResult` text `$type<"ok" | "rejected">()` nullable, `checkedAt` timestamp nullable, `createdAt`, `updatedAt` (`$onUpdate`).
    - Primary key is (`projectId`, `slug`).
  - **`projectCredentials`** (table `project_credentials`)
    - Columns: `projectId` uuid, `name` text, `serviceSlug` text, `kind` text `$type<"secret" | "public" | "oauth_token">()` not null, `value` text not null (sealed unless `kind === "public"`), `hint` text nullable, `createdAt`, `updatedAt`.
    - Primary key is (`projectId`, `name`). A `foreignKey` on (`projectId`, `serviceSlug`) points to `projectServices` (`projectId`, `slug`) with `onDelete("cascade")`.
- Produces (`lib/services/flags.ts`): `integrationsEnabled(): boolean`, which is `process.env.APP_INTEGRATIONS === "1"`.
- Produces (`lib/services/store.ts`, server only and the only module that touches these tables):
  - `listServiceSummaries(projectId: string): Promise<ServiceSummary[]>`
  - `registerService(projectId: string, definition: ServiceDefinition): Promise<ServiceSummary>`. It upserts the definition and deletes credentials whose names are no longer fields. The OAuth refresh token is kept while `authKind` stays `oauth2`. It doesn't change `approvedHosts`, so added hosts make the status `missing` (Task 3).
  - `saveServiceValues(projectId: string, slug: string, values: Record<string, string>): Promise<ServiceSummary | null>`
    1. Upsert each value: seal it when the field is `secret`, store the hint from `credentialHint`, and store public values plain.
    2. Set `approvedHosts = definition.allowedHosts`.
    3. For `api_key` with every field set, run `runCheck`. Store `checkResult` as `"ok"`, `"rejected"`, or null for `"unreachable"`, plus `checkedAt`.
    4. For `oauth2`, leave `checkResult` as it is.
  - `retestService(projectId: string, slug: string): Promise<ServiceSummary | null>`. It uses `runCheck` for `api_key` and `refreshAccessToken` for `oauth2`, and stores the result the same way.
  - `saveRefreshToken(projectId: string, slug: string, refreshToken: string): Promise<void>`. It seals the token, sets `approvedHosts = allowedHosts`, `checkResult = "ok"` and `checkedAt = now`.
  - `loadServiceSecrets(projectId: string, slug: string): Promise<{ definition: ServiceDefinition; values: Record<string, string> } | null>`. It unseals values. Only the OAuth routes and the store's own checks call it.
  - `removeServiceValues(projectId: string, slug: string): Promise<void>` and `removeService(projectId: string, slug: string): Promise<void>`
  - `copyServiceDefinitions(tx, fromProjectId: string, toProjectId: string): Promise<void>`. It copies definitions only, with `approvedHosts = '{}'` and `checkResult = null`, and no credentials.
  - Later phases add to this store (not part of this plan): phase 3 adds `listServiceDefinitions`, `connectedServiceCredentials` (the one filter that keeps only `"connected"` services' credentials, plus the server key, before any value leaves the store) and `loadProjectEnvironment`. Phase 5 adds `listCredentialValues`, built on the same filter.

- [ ] **Step 1: Write the failing migration test**

```ts
import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { KEY_PATTERN_SOURCES, KEY_REMOVED } from "@/lib/services/key-patterns"

describe("redact_message_keys migration", () => {
  const file = readdirSync("drizzle").find((name) => name.endsWith("_redact_message_keys.sql"))
  it("exists", () => expect(file).toBeDefined())
  it("redacts every pattern the app redacts, with the same marker", () => {
    const sql = readFileSync(`drizzle/${file}`, "utf8")
    for (const source of KEY_PATTERN_SOURCES) expect(sql).toContain(source)
    expect(sql).toContain(KEY_REMOVED)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --configLoader runner tests/services/migration.test.ts`
Expected: FAIL, because `file` is undefined.

- [ ] **Step 3: Add the tables and generate the migrations**

1. Add both tables to `db/schema.ts`.
2. Run `npm run db:generate`. Expect a new `drizzle/0014_*.sql` that creates both tables.
3. Run `npx drizzle-kit generate --custom --name redact_message_keys`, and fill the new `0015_redact_message_keys.sql` with one `UPDATE "messages" SET "content" = regexp_replace("content", '<source>', '[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '<source>';` per entry of `KEY_PATTERN_SOURCES`. Write each source exactly once per statement, with `--> statement-breakpoint` between statements.

- [ ] **Step 4: Implement `lib/services/flags.ts` and `lib/services/store.ts`** to the interfaces above, using `db` from `@/db` and drizzle query style like `lib/cloudhike/backend.ts`.

- [ ] **Step 5: Run the test, the full suite, and the typecheck**

Run: `npx vitest run --configLoader runner tests/services/migration.test.ts`, then `npm test`, then `npx tsc --noEmit`
Expected: PASS, PASS, no errors.

- [ ] **Step 6: Apply locally and check**

Run: `npx drizzle-kit migrate` against the dev database (or the project's usual apply step).
Expected: `\d project_credentials` shows the composite primary and foreign keys. Inserting a message containing `sk-proj-` followed by 40 letters, then re-running the 0015 statements by hand, leaves the marker in its place.

- [ ] **Step 7: Commit**

```bash
git add db/schema.ts drizzle lib/services/store.ts lib/services/flags.ts tests/services/migration.test.ts
git commit -m "feat(services): tables for services and sealed credentials, redact old chat keys"
```

---

### Task 6: Owner API for services

**Files:**
- Create: `app/api/projects/[projectId]/services/route.ts` (GET), `app/api/projects/[projectId]/services/[slug]/route.ts` (PUT, DELETE)
- Modify: `messages/en.json`, `messages/ar.json` (the `errors` namespace)

**Interfaces:**
- Consumes: `store.ts` (Task 5) and `validateValues` (Task 2). Also `getCurrentUser`, `getProjectAccess` and `errorResponse`, using the same `ownedProject` pattern as `app/api/projects/[projectId]/github/route.ts:26-34`.
- Produces:
  - `GET` returns `{ services: ServiceSummary[] }`.
  - `PUT` takes a body of `{ values: Record<string,string> }` or `{ action: "retest" }`, and returns `{ service: ServiceSummary }`.
  - `DELETE ?scope=values|service` returns `{ ok: true }`.
  - New error keys: `serviceNotFound` ("This service isn't part of the app.") and `serviceValuesInvalid` ("Some of those values can't be saved.").

- [ ] **Step 1: Add the two error keys** to `en.errors` and `ar.errors`, with the Arabic written properly.

- [ ] **Step 2: Implement the routes**

| Case | Response |
|---|---|
| Not signed in | 401 `signInRequired` |
| Not the owner | 404 `projectNotFound` |
| Unknown slug | 404 `serviceNotFound` |
| `validateValues` returns a string | 400 `serviceValuesInvalid` |
| Body over 32 KB | 413 `serviceValuesInvalid` |

Never echo request bodies in errors or logs.

- [ ] **Step 3: Verify**

Run: `npm test` (the i18n parity tests cover the new keys), then `npx tsc --noEmit`, then `npm run lint`
Expected: all pass.

Then, with `npm run dev`, signed in as the owner of a project where a service was registered (insert one row by hand, or wait for Task 8):
- `curl` the PUT with a fake key. The response shows a `hint` and never the key.
- A GET from another account's session gives 404.

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/[projectId]/services messages/en.json messages/ar.json
git commit -m "feat(services): owner routes to list, save, re-test and remove service credentials"
```

---

### Task 7: OAuth connect with the owner's client

**Files:**
- Create: `app/api/projects/[projectId]/services/[slug]/oauth/start/route.ts` and `app/api/oauth/callback/route.ts`

**Interfaces:**
- Consumes: `loadServiceSecrets`, `saveRefreshToken` (Task 5), `createPkce`, `authorizationUrl`, `encodeOAuthState`, `parseOAuthState`, `sameState`, `OAUTH_STATE_COOKIE`, `OAUTH_STATE_MAX_AGE` and `exchangeCode` (Task 4), and `oauthRedirectUri` and `ServiceConnectResult` (Task 2).
- Produces: a redirect to `/workspace/${projectId}?service=${slug}&serviceResult=${ServiceConnectResult}`.

- [ ] **Step 1: Implement `start`** (GET)
  1. Check the owner. The service must be `oauth2`, with both client fields stored. If not, redirect with `serviceResult=error`.
  2. Create a random `state` (32 bytes as hex) and a PKCE pair.
  3. Set the cookie `OAUTH_STATE_COOKIE = encodeOAuthState(...)` with `httpOnly`, `secure` in production, `sameSite: "lax"`, `path: "/api/oauth"` and `maxAge: OAUTH_STATE_MAX_AGE`. Mirror `app/api/projects/[projectId]/github/connect/route.ts:21-29`.
  4. Redirect to `authorizationUrl(..., oauthRedirectUri(request.nextUrl.origin), state, challenge)`.

- [ ] **Step 2: Implement `callback`** (GET)
  1. Parse the cookie and compare `state` with `sameState`. Always delete the cookie.
  2. Check that the signed-in user owns `projectId`.
  3. Decide the result:
     - `error=access_denied` gives `denied`.
     - A bad or missing state or owner gives `error`. If no project is known, redirect to `/`.
     - Otherwise call `exchangeCode` with the stored client values and the verifier. `{ error: "no_refresh_token" }` gives `no_refresh_token`. Success calls `saveRefreshToken` and gives `connected`.
  4. Never put the code or the token in the redirect.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`, then `npm run lint`
Expected: no errors.

**Manual check (Review Focus 3).** Register a `google-calendar` service with a real test OAuth client whose redirect URI is `http://localhost:3000/api/oauth/callback`, and save the client ID and secret. Then:
- (a) Start and approve. This lands on `?serviceResult=connected`, and GET services shows `oauthConnected: true`.
- (b) Start and deny. This lands on `denied`.
- (c) Start, delete the cookie in devtools, then approve. This lands on `/` or `error`, and nothing is saved.
- (d) Open the start URL while signed in as another user. This gives 404.

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/[projectId]/services/[slug]/oauth app/api/oauth
git commit -m "feat(services): connect OAuth services with the owner's own client"
```

---

### Task 8: The planner's `register_service` tool and events

**Files:**
- Modify:
  - `lib/agent-protocol.ts`: add to `AgentEvent`.
  - `lib/agent/instructions.ts`: `PlannerState` and a new section.
  - `lib/agent/planner.ts`: the tool, its registration, `TOOL_STATUS` and the context.
  - `lib/agent/leaked-tool-call.ts`: `TOOL_NAMES`.
  - `messages/en.json` and `messages/ar.json`: `status.registeringService`.
- Test: `tests/agent/leaked-tool-call.test.ts` (extend it) and `tests/services/planner-services.test.ts`

**Interfaces:**
- Consumes: `serviceDefinitionSchema` and `normalizeService` (Task 2), `registerService`, `listServiceSummaries` and `integrationsEnabled` (Task 5), and `plannerServices` (Task 3).
- Produces:
  - New `AgentEvent` members: `{ type: "services"; services: ServiceSummary[] }` and `{ type: "service-request"; slug: string }`.
  - `PlannerState` gains `services: PlannerService[]` and `integrations: boolean`.
  - `servicesDescription(services: PlannerService[]): string` is exported from `instructions.ts`.

**The tool:** `register_service`, with parameters `serviceDefinitionSchema`. Its description is "Add or update an outside service the app needs (an AI provider, a calendar, a social API), with the credentials the owner must provide. Opens the dialog where the owner enters them. Never ask for credentials in the chat."

What `execute` does:
1. If `normalizeService` returns a string, return `Service not saved: ${reason} Fix it and call register_service again.`.
2. Otherwise call `registerService`, then emit `{ type: "services", services: await listServiceSummaries(projectId) }`. Update `ctx.services`.
3. If the service's status isn't `connected`, emit `{ type: "service-request", slug }` and return `"The dialog is open. The owner adds the values there, never in the chat. Tell them in one or two sentences what to get and that it's stored encrypted."`.
4. Otherwise return `"Already connected."`.

**When it's available:** the tool is registered only when `integrationsEnabled()`, with `tools: [..., ...(integrations ? [registerService] : [])]`. Add `register_service: "registeringService"` to `TOOL_STATUS`, and add `"register_service"` to `TOOL_NAMES`.

**The context:** in `runPlannerTurn`, set `services: plannerServices(await listServiceSummaries(project.id))` and `integrations: integrationsEnabled()`.

**`servicesDescription(services)`:**
- No services gives `"No outside services are set up."`.
- Otherwise it gives one line per service: `- <name> (<slug>): <status>. Fields: NAME set, NAME not set.`.

**The instructions section,** added after `# The app's backend` only when `state.integrations` is true. Its text:

```
# Outside services
- When the owner wants something that needs an outside service, like an AI model, their calendar, payments, messaging, or social posting, call `register_service` in the same turn as the plan or the change. Work out from the service's official API which credentials the owner must provide, how they're sent, and which hosts the app will call.
- In one or two plain sentences, say what they need to get and that they'll enter it in the dialog, where it's stored encrypted. Never ask for keys, secrets, or tokens in the chat, and never repeat one.
- The owner brings their own accounts and keys, and pays for them. AppxPrompt provides none.
- A message may contain "[key removed and moved to the keys dialog]". That means a key was taken out before it was saved. Tell them it wasn't stored in the chat and that the dialog will ask for it.
- Screens can't call outside services yet. Register the service so the owner can connect it now, and say the feature that uses it comes in a later update.
- Services so far:
${servicesDescription(state.services)}
```

- [ ] **Step 1: Write the failing tests**
  - In `leaked-tool-call.test.ts`, add `it("recognizes register_service", ...)`. It asserts that `findLeakedToolCall('register_service({"slug":"openai"})').tool` equals `"register_service"`, following the existing test cases' form.
  - In `planner-services.test.ts`:
    - `servicesDescription([])` gives `"No outside services are set up."`.
    - A google service in `missing` with the client ID set and the secret not set gives exactly `"- Google Calendar (google-calendar): missing. Fields: GOOGLE_CALENDAR_CLIENT_ID set, GOOGLE_CALENDAR_CLIENT_SECRET not set."`.
    - Mock `@/db` and the `lib/agent/instructions.ts` imports the way `tests/i18n/builder-messages.test.ts` does, if importing `instructions.ts` needs it.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/agent/leaked-tool-call.test.ts tests/services/planner-services.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** the changes listed in this task, and add `status.registeringService` ("Setting up a service…") to en and ar.

- [ ] **Step 4: Run the tests, the full suite, and the typecheck**

Run: the same two files, then `npm test`, then `npx tsc --noEmit`
Expected: PASS and no errors. The `switch` in `hooks/use-project-agent.ts` will fail to typecheck until Task 10 handles the new events. If so, add `case "services": case "service-request": return state` there now, and Task 10 replaces it.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-protocol.ts lib/agent lib/services tests messages hooks/use-project-agent.ts
git commit -m "feat(agent): register_service tool opens the service dialog (behind APP_INTEGRATIONS)"
```

---

### Task 9: Server-side redaction and duplicating projects

**Files:**
- Modify:
  - `app/api/projects/[projectId]/agent/route.ts`: line 76, the `message` action.
  - `app/api/projects/route.ts`: line 125, the first prompt.
  - `app/api/projects/[projectId]/duplicate/route.ts`: inside its transaction.

**Interfaces:**
- Consumes: `redactKeys` (Task 1) and `copyServiceDefinitions` (Task 5).

- [ ] **Step 1: Implement**
  - In the agent route, run `const { text } = redactKeys(content)` before the length check and `detectChatLanguage`, and use `text` for the insert and everything after it.
  - In `app/api/projects/route.ts`, redact `prompt` the same way before the transaction, and use the redacted prompt for the insert and for the project's stored `prompt`.
  - In the duplicate route, call `copyServiceDefinitions(tx, source.id, newProjectId)` after the project row is inserted.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`, then `npm test`
Expected: no errors, and PASS.

**Manual check:** with `curl`, POST a `message` containing `sk-proj-` plus 40 letters to the agent route. The stored `messages.content` contains the marker, and no key.

- [ ] **Step 3: Commit**

```bash
git add app/api/projects
git commit -m "feat(services): redact keys before chat messages are saved; copy service definitions on duplicate"
```

---

### Task 10: The workspace dialog, header button, chat card, and paste protection

**Files:**
- Create: `components/workspace/service-dialog.tsx`, `components/workspace/services-button.tsx` and `components/workspace/service-card.tsx`
- Modify:
  - `hooks/use-project-agent.ts`
  - `components/workspace/workspace-layout.tsx`, `components/workspace/workspace-header.tsx` and `components/workspace/chat-panel.tsx`
  - `components/home/prompt-composer.tsx`
  - `app/workspace/[projectId]/page.tsx`
  - `messages/en.json` and `messages/ar.json`: a new `services` namespace

**Interfaces:**
- Consumes: the `services` and `service-request` events (Task 8), the API routes from Tasks 6 and 7, `redactKeys`, and `ServiceSummary`, `SERVICE_CONNECT_RESULTS` and `oauthRedirectUri`.
- Produces:
  - **`AgentState`** gains `services: ServiceSummary[]` and `serviceRequest: string | null`.
  - **`useProjectAgent`** takes `services` in `initial`. It also returns `serviceChanged(slug: string, summary: ServiceSummary | null)` and `clearServiceRequest()`.
  - **`ServiceDialog` props:** `{ projectId: string; open: boolean; onOpenChange(open: boolean): void; service: ServiceSummary | null; pastedKeys: string[]; services: ServiceSummary[]; connectResult: ServiceConnectResult | null; onChanged(slug: string, summary: ServiceSummary | null): void }`
  - **`ServicesButton` props:** `{ services: ServiceSummary[]; onOpen(slug: string): void }`
  - **`ServiceCard` props:** `{ service: ServiceSummary; onOpen(): void }`
  - **`ChatPanel`** gains the prop `onKeysRemoved(keys: string[]): void`.

- [ ] **Step 1: The page and the hook**
  - **In `page.tsx`:**
    - Read `searchParams.service` and `searchParams.serviceResult`.
    - Load `services`: `listServiceSummaries(project.id)` for the owner, and `[]` for viewers.
    - Pass `services`, `integrations={integrationsEnabled()}`, and `serviceConnect`, which is `{ slug, result } | null` and validated against `SERVICE_CONNECT_RESULTS`, as `backendConnectResult` is.
  - **In the hook:** the reducer handles `services` (replace the list) and `service-request` (set `serviceRequest`). It also handles two new actions: `service-changed`, which upserts the service or removes it when the summary is `null`, and `service-request-handled`.

- [ ] **Step 2: `ServiceDialog`**

Build it with `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription` and `Button`, the same way `backend-dialog.tsx` does.

**What it shows:**
- **When `service` is set:**
  - The title is "Connect <name>", followed by the purpose.
  - A collapsible list of `setupSteps`, rendered as plain text lines. For `oauth2` it includes a read-only redirect URL from `oauthRedirectUri(window.location.origin)`, with a Copy button.
  - One input per field: `type="password"` for secrets and `type="text"` for public values, with `dir="ltr"`. Set fields show their `hint` as the placeholder, along with Replace.
  - The line "Your keys are only sent to: <hosts joined with commas>".
  - The reassurance line.
  - A budget line linking `docsUrl` for `api_key`.
  - The status line: connected, rejected, couldn't test (`checkResult` null with every field set), or missing.
- **When `pastedKeys` is set (from the chat):**
  - Explain that the key was taken out of the message.
  - For each key, offer a choice among the unset secret fields across `services`. Saving PUTs `{ values: { [field]: key } }`.
  - If no unset secret field exists, say the key wasn't saved and that the dialog will ask for it once a feature needs it.
  - Keep the keys in component state only, and clear them when the dialog closes.

**Buttons:**
- **Save** PUTs only the non-empty inputs.
- **Connect** (`oauth2`) first saves any typed client values, then calls `window.location.assign(`/api/projects/${projectId}/services/${slug}/oauth/start`)`.
- **Re-test** PUTs `{ action: "retest" }`.
- **Remove** DELETEs `?scope=values`.
- **Remove from app** DELETEs `?scope=service` and closes the dialog.
- **Skip for now** closes the dialog.
- Every response calls `onChanged`.

**`connectResult`** shows a line of text for each result.

- [ ] **Step 3: `ServicesButton`, `ServiceCard`, and the layout wiring**
  - **`ServicesButton`** is a `DropdownMenu` (from `@/components/ui/dropdown-menu`, as `workspace-header.tsx` uses) listing each service with its status. It shows a small dot when any service isn't `connected`.
  - **`WorkspaceHeader`** gains the props `services`, `showServices` and `onOpenService`, and renders the button next to `BackendButton` when `!readOnly && showServices`. `showServices` is `integrations || services.length > 0`.
  - **`ChatPanel`** renders a `ServiceCard` below the messages for each service whose status isn't `connected`.
  - **`ChatPanel.handleSubmit`** runs `redactKeys(content)`. If any keys come back, it calls `onKeysRemoved(keys)` and sends the redacted text.
  - **`WorkspaceLayout`:**
    - It holds `serviceDialog: { slug: string | null; pastedKeys: string[] } | null`.
    - It opens the dialog on `agent.serviceRequest` (then calls `clearServiceRequest()`), on `serviceConnect` at mount, on `onOpenService`, and on `onKeysRemoved`.
    - It passes `onChanged={agent.serviceChanged}`.
  - **`prompt-composer.tsx`:** `createApp` redacts the prompt with `redactKeys` before the POST. There's no dialog yet, and the planner instructions explain the marker.

- [ ] **Step 4: Translations**

Add a `services` namespace to en and ar with every string the three components use. These include the title "Connect {name}", the setup steps and copy labels, "Your keys are only sent to: {hosts}", the reassurance and budget lines, each status and connect-result line, the pasted-key copy, all button labels, the card text "Connect {name} to finish {purpose}", and the header label "Services & keys".

- [ ] **Step 5: Verify**

Run: `npm test` (i18n parity, no literal text, logical classes), then `npx tsc --noEmit`, then `npm run lint`
Expected: all pass.

**Manual check** with `APP_INTEGRATIONS=1 npm run dev`:
- (a) Ask for "an AI skin advisor using OpenAI". The dialog opens by itself, and the card appears in the chat.
- (b) Save a real key. The status becomes connected, the hint shows, and reloading the page never shows the key.
- (c) Save a wrong key. The status becomes rejected.
- (d) Paste `sk-proj-` plus 40 letters into the chat. The sent message shows the marker, and the dialog offers to save the key.
- (e) Sign in as a shared viewer. No button, card, or dialog appears.
- (f) Ask for Google Calendar. The dialog shows the redirect URL and Connect, and the OAuth round trip from Task 7 updates the dialog.

- [ ] **Step 6: Commit**

```bash
git add components hooks app/workspace messages
git commit -m "feat(workspace): service dialog, Services & keys menu, chat card, and paste protection"
```

---

### Task 11: Documentation

**Files:**
- Modify: `docs/app-builder-roadmap.md` (the secrets notes near line 34), `.env.example`

- [ ] **Step 1: Write it**
  - **The roadmap:** add a short "Services and credentials" entry covering where credentials live (`project_credentials`, sealed), that only the owner sees them, the `APP_INTEGRATIONS` flag, and the OAuth callback URL owners must register.
  - **`.env.example`:** add `APP_INTEGRATIONS=` with the comment `# 1 turns on outside services for generated apps (phase 1: credentials only)`.

- [ ] **Step 2: Commit**

```bash
git add docs/app-builder-roadmap.md .env.example
git commit -m "docs: services and credentials vault"
```
