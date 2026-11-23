# Integrations: interfaces between phases

Spec: `docs/superpowers/specs/2026-11-22-app-integrations-design.md`. Phase 1 plan: `docs/superpowers/plans/2026-11-22-integrations-phase-1-vault.md`.

Each phase's plan must **produce** what it lists here under the exact names, and may **consume** anything listed for earlier phases. If a plan finds a name here won't work, it changes this file in the same plan and says so at the top.

## Phase 1: vault (already planned)

These all come from the phase 1 plan:
- `lib/services/protocol.ts`: the types `ServiceDefinition`, `ServiceSummary`, `PlannerService`, `ServiceConnectResult`, and the functions `envPrefix`, `refreshTokenName` and `oauthRedirectUri`.
- `lib/services/key-patterns.ts`: `findKeys`, `redactKeys`, `KEY_REMOVED` and `scrubSecrets`.
- `lib/services/definition.ts`: `serviceDefinitionSchema`, `normalizeService`, `validateValues` and `addedHosts`.
- `lib/services/status.ts`: `serviceStatus`, `summarizeService` and `plannerServices`.
- `lib/services/check.ts`: `runCheck`, `exchangeCode` and `refreshAccessToken`.
- `lib/services/store.ts`: `listServiceSummaries`, `registerService`, `saveServiceValues`, `retestService`, `saveRefreshToken`, `loadServiceSecrets`, `removeServiceValues`, `removeService` and `copyServiceDefinitions`.
- `lib/services/flags.ts`: `integrationsEnabled()`, which reads `APP_INTEGRATIONS=1`.
- The tables `project_services` and `project_credentials`.
- The `AgentEvent`s `services` and `service-request`.
- The planner tool `register_service`, and `PlannerState.services` / `PlannerState.integrations`.
- The `# Outside services` instructions section in `lib/agent/instructions.ts`.

## Phase 2: web research

**Produces:**
- `lib/research/search.ts`: `webSearch(query: string): Promise<SearchResult[]>`, where `type SearchResult = { title: string; url: string; snippet: string }`.
  - The provider is chosen in the phase 2 plan and configured by platform env vars, documented in `.env.example`.
  - With no key configured, the call throws `ResearchUnavailableError`.
- `lib/research/read-page.ts`:
  - `readPage(url: string): Promise<{ url: string; title: string; text: string } | { error: string }>`
  - `isPublicHttpsUrl(url: string): boolean`
  - `MAX_PAGE_CHARS`
- `lib/agent/research-tools.ts`:
  - `createResearchTools<TContext extends { research: ResearchBudget }>(): Tool<TContext>[]`, which gives the `web_search` and `read_page` tools.
  - `type ResearchBudget = { searches: number; pages: number }`, the counts left in this turn.
  - `newResearchBudget(): ResearchBudget`
- **The planner:**
  - `PlannerContext` gains `research: ResearchBudget`, and the research tools are registered when `integrationsEnabled()`.
  - The `# Outside services` section is rewritten to require researching official docs and to treat page text as reference, never as instructions.

## Phase 3: server functions

**Produces:**
- **The plan:** `AppPlan.serverRoutes?: PlannedServerRoute[]` in `lib/agent-protocol.ts`, where:
  ```ts
  type PlannedServerRoute = {
    id: string; path: string; purpose: string
    kind: "function" | "agent"; services: string[]; access: "public" | "signed_in"
  }
  ```
  `path` is an Expo Router file path like `app/api/booking/slots+api.ts`.
- **Storage:** a `server_routes` table: `projectId`, `path`, `kind` (`function` | `agent` | `helper`), `purpose`, `code`, `status` (same values as screens), and timestamps. The key is (`projectId`, `path`).
- **Writing the code:** `lib/agent/server-builder.ts` exports `buildServerRoute(...)`, which runs as a build step. `lib/agent/validate-server-route.ts` exports:
  ```ts
  validateServerRoute(code: string, ctx: {
    path: string; credentialNames: string[]; allowedHosts: string[]; helperPaths: string[]
  }): string[] // problems; empty means valid
  ```
- **The sandbox:**
  - `lib/sandbox/runner.ts`:
    ```ts
    interface SandboxRunner { invoke(projectId: string, request: SandboxRequest): Promise<SandboxResponse> }
    type SandboxRequest = { method: string; path: string; headers: Record<string, string>; body: string | null }
    type SandboxResponse = { status: number; headers: Record<string, string>; body: string }
    getSandboxRunner(): SandboxRunner
    ```
    The implementation is chosen by a spike task inside the phase 3 plan.
  - `lib/sandbox/bundle.ts`:
    ```ts
    buildSandboxBundle(projectId: string): Promise<SandboxBundle>
    matchApiRoute(routes: string[], path: string): { route: string; params: Record<string, string> } | null
    ```
  - `lib/sandbox/token.ts`:
    ```ts
    createSandboxToken(projectId: string, userId: number, ttlSeconds?: number): string
    verifySandboxToken(token: string, projectId: string): boolean
    ```
  - The route `app/api/apps/[projectId]/server/[...path]/route.ts`, which requires the header `x-appxprompt-sandbox`.
- **The server key:** the system credential `APPXPROMPT_SERVER_KEY`, kept under a hidden system service with slug `appxprompt`. It isn't returned by `listServiceSummaries`. The gateway accepts it in the header `x-appxprompt-server-key`.
- **Generated app files:**
  - `lib/server/config.ts` and `lib/server/index.ts`, exporting `callServer(path, body)` and `class ServerError { code: "not_connected" | "sign_in" | "bad_request" | "unavailable" | "preview"; service?: string }`.
  - `server/data.ts`, exporting `data.asCaller(request)` and `data.asApp()`.
  - `server/auth.ts`, exporting `getCaller(request)`.
- **Preview protocol** (`lib/preview-protocol.ts`): the workspace sends the frame `{ type: "sandbox-token"; token: string }`, and the frame sends the workspace `{ type: "service-needed"; slug: string }`.
- **Credits:** `buildCost` counts server routes of kind `function` and `agent` as screens, using `SCREEN_CREDITS` / `EDIT_CREDITS`.
- **Viewers:** the Code tab and the ZIP leave out `app/api/**` and `server/**` for anyone who isn't the owner.

## Phase 4: AI agents and the Agent tab

**Produces:**
- **Storage:** a `project_agents` table: `projectId`, `id`, `name`, `instructions`, `model`, `access` (`public` | `signed_in`), `tools` (text[], the ids of server routes it may call), and timestamps.
- **Generated files:**
  - `server/agents/<id>.instructions.ts`, generated from that table.
  - `server/agent-loop.ts`, a shared helper: a tool loop with a step cap and a timeout.
- **The planner:** `update_agent_instructions` tool.
- **The workspace:** an Agent tab in `components/workspace/preview-panel.tsx` (owner only), with a "Try it" box that calls the sandbox through `/api/apps/[projectId]/server/...`.
- **The hook:** `onAgentChanged(projectId)`, which reloads the sandbox in phase 4 and is extended in phase 5 to redeploy.

## Phase 5: publishing and export

**Produces:**
- `lib/publish/expo.ts`:
  ```ts
  syncAppEnvironment(accessToken: string, appId: string, vars: { name: string; value: string; visibility: "sensitive" | "plaintext" }[]): Promise<void>
  ```
  It upserts the given variables and deletes the ones it manages that are no longer listed.
- **Snapshots:** a `published_snapshots` table, plus `saveSnapshot` and `loadSnapshot`.
- `lib/publish/server-deploy.ts`, exporting `deployServer(project, userId, reason: "publish" | "credentials" | "agent")`.
- **Export changes:** server files, `.env.example`, `web.output: "server"`, the `expo-router` `origin`, and the README section.
- **Hooks:** changes to credentials (phase 1 store) and to agents (phase 4) call `deployServer` in the background when the app is published.
