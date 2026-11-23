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
- **Related protocol additions** in `lib/agent-protocol.ts`:
  - `PendingChanges.serverRoutes?: Record<string, string>` holds the request text by route `path`.
  - `ProjectServerRoute = { path; kind; purpose; status; code }`.
  - New `AgentEvent`s: `{ type: "server-routes"; routes }` and `{ type: "server-route"; route }`.
  - Path rules: `API_ROUTE_FILE`, `SERVER_HELPER_FILE` (which allows `server/agents/<id>.instructions.ts`), `RESERVED_HELPER_FILE` (`server/agents/**` and `server/agent-loop.ts`, which the server builder never writes), `SYSTEM_SERVER_FILES`, `apiRouteUrl(path)` (`"app/api/booking/slots+api.ts"` → `"/api/booking/slots"`; later phases use it, never their own) and `isServerFile(path)` (`app/api/**` or `server/**`; phase 5 imports it).
  - `SERVER_ROUTE_ID = /^[a-z][a-z0-9-]{0,39}$/`. Every planned route id must match it, and phase 4's `AGENT_ID` is the same pattern.
- **Storage:** a `server_routes` table: `projectId`, `path`, `kind` (`function` | `agent` | `helper`), `purpose`, `code`, `status` (same values as screens), and timestamps. The key is (`projectId`, `path`). Phase 4's generated agent files are stored as `helper` rows. There's also a `project_sandboxes` table for the runner's state.
- **`lib/server-routes/store.ts`:** `listServerRoutes(projectId)`, `prepareServerRoutes(projectId, plan)`, `setServerRouteStatus(projectId, path, status, code?)`, `saveServerHelper(projectId, path, purpose, code)`, `failWaitingServerRoutes(projectId)`, `removeServerRoutes(tx, projectId, paths: string[])`, and `copyServerRoutes(tx, fromProjectId, toProjectId)`. The duplicate route calls `copyServerRoutes`, and copied routes keep their code and status, with no charge.
- **Writing the code:**
  - `lib/agent/server-builder.ts` exports `buildServerRoute(...)`, which runs as a build step from `runBuildStep` in `lib/agent/builder.ts`:
    ```ts
    buildServerRoute(ctx: ServerRouteContext, options: {
      generate?: Generate; signal?: AbortSignal; saveHelper: (path: string, purpose: string, code: string) => Promise<void>
      extraPrompt?: string; extraHelperPaths?: string[]; extraValidate?: (code: string) => string[]
    }): Promise<{ code: string } | { problems: string[] }>
    ```
    It knows nothing about agents. Phase 4 runs its agent steps in `runBuildStep` around the call and passes its rules, file paths and checks through the three `extra` options.
  - Build order: every `function` route is built before any `agent` route (`nextServerRoute(planned, rows)` in `server-builder.ts`), and both come before the screens. Later phases don't reorder.
  - `SERVER_BUILDER_INSTRUCTIONS` says routes of kind `agent` follow the prompt's agent section instead of the `withErrors` / `requireCaller` rules.
  - `lib/agent/validate-server-route.ts` exports:
  ```ts
  validateServerRoute(code: string, ctx: {
    path: string; credentialNames: string[]; allowedHosts: string[]; helperPaths: string[]
  }): string[] // problems; empty means valid
  ```
  An import is allowed when it names a `helperPaths` entry or a system file, as `@/<path without .ts>` or relatively. That includes `app/api/**` handler files, which agent routes import to call function handlers in-process.
- **The sandbox:**
  - `lib/sandbox/runner.ts`:
    ```ts
    interface SandboxRunner {
      invoke(projectId: string, request: SandboxRequest): Promise<SandboxResponse>
      reload(projectId: string): Promise<void> // clears only the stored signature; sandboxId is kept, so the next invoke stops the old sandbox and starts one with the current files and credentials
      stop(projectId: string): Promise<void>
    }
    type SandboxRequest = { method: string; path: string; headers: Record<string, string>; body: string | null }
    type SandboxResponse = { status: number; headers: Record<string, string>; body: string }
    class SandboxUnavailableError extends Error { reason: "disabled" | "starting" | "limit" | "failed" }
    getSandboxRunner(): SandboxRunner
    ```
    The implementation is Vercel Sandbox (`SANDBOX_PROVIDER=vercel`), confirmed by the phase 3 spike, and can be swapped behind this interface.
  - `lib/sandbox/bundle.ts`:
    ```ts
    buildSandboxBundle(projectId: string): Promise<SandboxBundle> // { runtime, env, signature }
    sandboxSignature(projectId: string): Promise<string>          // changes when routes, helpers, credentials, services, plan.backend or plan.serverRoutes change
    serverSourceFiles(projectId: string): Promise<{ path: string; code: string }[]>
    matchApiRoute(routes: string[], path: string): { route: string; params: Record<string, string> } | null // re-exported from lib/sandbox/routes.ts
    ```
    `serverSourceFiles` returns every server-side source file, uncompiled, exactly as the sandbox loads it. That's the `app/api/**/+api.ts` routes, the `server/**` helpers (phase 4's agent files included), and the system files `server/data.ts`, `server/auth.ts` and `server/respond.ts`.
  - **Only connected services reach the sandbox.** Its env holds the credentials of services whose status is `"connected"` (every field set, every `allowedHosts` entry approved, not rejected), plus the server key. Its egress allow-list, `serverAllowedHosts(plan, services: Pick<ServiceSummary, "allowedHosts" | "status">[])`, takes only connected services' hosts. Credentials and hosts of other services are left out.
  - `lib/sandbox/token.ts`:
    ```ts
    createSandboxToken(projectId: string, userId: number, ttlSeconds?: number): string
    verifySandboxToken(token: string, projectId: string): boolean
    ```
  - The route `app/api/apps/[projectId]/server/[...path]/route.ts`, which requires the header `x-appxprompt-sandbox`.
- **The server key:**
  - It's the system credential `APPXPROMPT_SERVER_KEY`, kept under a hidden system service with slug `appxprompt`. It isn't returned by `listServiceSummaries`, and `normalizeService` refuses that slug.
  - The gateway accepts it in the header `x-appxprompt-server-key`, with `x-appxprompt-as: caller | app` (default `caller`).
  - `lib/services/server-key.ts` exports `ensureServerKey(projectId): Promise<void>` (creates the key when it's missing), `rotateServerKey(projectId)` and `verifyServerKey(projectId, given)`.
- **Phase 1 store additions** (`lib/services/store.ts`):
  ```ts
  listServiceDefinitions(projectId: string): Promise<ServiceDefinition[]> // system service left out
  connectedServiceCredentials<T extends { serviceSlug: string; name: string }>(
    services: { slug: string; definition: ServiceDefinition; approvedHosts: string[]; checkResult: CheckResult }[],
    credentials: T[],
  ): T[] // pure; keeps the system service's credentials and those of services whose serviceStatus is "connected"
  loadProjectEnvironment(projectId: string): Promise<{ env: Record<string, string>; secretNames: string[] }> // sandbox only
  ```
  `connectedServiceCredentials` is the one filter for every place credential values go: `loadProjectEnvironment` here, and phase 5's `listCredentialValues`.
- **Generated app files:**
  - `lib/server/config.ts` exports exactly two values and nothing else:
    - `SERVER_BASE_URL: string`, with no trailing slash, where `""` means relative.
    - `SERVER_TOKEN: string | null`. It's the sandbox token in preview and Snack, `""` when there's no token (`callServer` then throws `preview` without fetching), and `null` in published builds.
  - `lib/server/index.ts` reads only those two values to decide where and whether to call, and it reads them at call time.
  - `lib/server/index.ts` exports `callServer(path, body?)`, which always POSTs JSON, and `class ServerError { code: "not_connected" | "sign_in" | "bad_request" | "unavailable" | "preview"; service?: string }`. These client files come from `generatedAppFiles(plan, server?: ServerTarget)`.
  - Server-side system files come from `generatedServerFiles(plan)`, never from `generatedAppFiles`:
    - `server/data.ts`, exporting `data.asCaller(request)` and `data.asApp()`.
    - `server/auth.ts`, exporting `getCaller(request)` and `requireCaller(request)`. `getCaller` resolves to `null` when nobody is signed in or the token isn't valid, and never throws for that. This file is generated whenever the plan has any server route, so always when it has a route of kind `agent`.
    - `server/respond.ts`, exporting `ok`, `fail`, `withErrors`, `ServiceNotConnected` and `SignInRequired`.
- **Preview protocol** (`lib/preview-protocol.ts`): the workspace sends the frame `{ type: "sandbox-token"; token: string }` (`""` means none), and the frame sends the workspace `{ type: "service-needed"; slug: string }`.
- **The planner:**
  - `planSchema.serverRoutes`, and `update_app`'s `addServerRoutes`, `editServerRoutes`, `removeServerRoutePaths` and `removeServices: string[]`. Removing a service calls `removeService` and queues edits for the routes that used it and the screens that call those routes.
  - The `# Server functions` instructions section, right after `# Outside services`.
- **Credits:**
  - `buildCost` counts server routes of kind `function` and `agent` as screens, using `SCREEN_CREDITS` / `EDIT_CREDITS`.
  - They're charged under the new credit reason `"server-route"`.
- **Viewers:** the Code tab and the ZIP leave out `app/api/**` and `server/**` for anyone who isn't the owner.
  - `filesForRole(files, role)` in `lib/generated-app/export-project.ts`.
  - `loadProjectExport(project: Project, options: { includeServer: boolean }): Promise<LoadedExport>` in `lib/project-access.ts`. The export route passes `{ includeServer: access.role === "owner" }`, and the GitHub, web publish and native build callers pass `{ includeServer: true }`. Phase 5 only extends what `includeServer: true` adds.

## Phase 4: AI agents and the Agent tab

**Produces:**
- **Storage:** a `project_agents` table: `projectId`, `id`, `name`, `service` (the slug of the AI service whose key the agent uses), `instructions`, `model`, `access` (`public` | `signed_in`), `tools` (text[], the ids of server routes it may call), and timestamps. The key is (`projectId`, `id`).
- **`lib/agents/protocol.ts`** (client-safe): `AGENT_ACCESS`, `AgentAccess`, `AGENT_ERROR_CODES`, `AgentErrorCode`, `AGENT_ID` (the same pattern as phase 3's `SERVER_ROUTE_ID`), `MAX_AGENT_INSTRUCTIONS`, `MAX_AGENT_NAME`, `AGENT_LOOP_PATH` (`"server/agent-loop.ts"`), `agentInstructionsPath(id)` (`server/agents/<id>.instructions.ts`), `AGENT_PROVIDERS`, `agentServiceFor(services)`, `defaultAgentModel(service)`, `AgentRecord`, `ProjectAgentSummary`, `PlannerAgent`, `AgentSettings`, `checkInstructions`, `validateAgentSettings`, `summarizeAgent`, `plannerAgents` and `hasAgentRoute`. Route URLs come from phase 3's `apiRouteUrl`.
- **`lib/agents/files.ts`:** `AGENT_LOOP_FILE` (the contents of `server/agent-loop.ts`), `AgentConfigInput` and `agentConfigFile(agent)`.
  - The generated `server/agents/<id>.instructions.ts` exports `agentConfig`.
  - The generated `server/agent-loop.ts` is a tool loop with a step cap and a timeout. It exports `AgentConfig`, `AgentMessage`, `AgentTool`, `AgentResult`, `AGENT_GUARD`, the loop limits, `AgentLoopError`, `AgentToolError`, `parseAgentMessages`, `runAgentLoop`, `callRoute`, `agentErrorResponse` and `handleAgentRequest`.
- **`lib/agents/store.ts`:** `listAgents`, `getAgent`, `upsertAgentDraft`, `ensureAgent`, `saveAgentSettings` (gives `"changed"` on a stale `baseUpdatedAt`), `setAgentTools`, `writeAgentFiles` (writes both generated files as `server_routes` `helper` rows), `syncAgentsWithPlan` and `copyAgents(tx, from, to)`.
- **`lib/agents/route-rules.ts`:** `AgentToolRoute`, `agentRouteRules(...)`, `validateAgentRoute(code, ctx)`, `agentToolIds(code, serverRoutes)` and `routeImportPath(path)`.
- **Building agent routes:** `runBuildStep` runs `ensureAgent` and `writeAgentFiles` before phase 3's `buildServerRoute`, passes `agentRouteRules` as `extraPrompt`, the agent files and tool routes as `extraHelperPaths`, and `validateAgentRoute` as `extraValidate`. On success it calls `setAgentTools`, then `getSandboxRunner().reload(projectId)` directly, never `onAgentChanged`.
- **The hook:** `onAgentChanged(projectId)` in `lib/agents/on-changed.ts`. It calls `getSandboxRunner().reload(projectId)` in phase 4 and is extended in phase 5 to redeploy. Only settings changes call it: the Agent tab's save and `update_agent_instructions`.
- **Events:** the `AgentEvent` `{ type: "agents-changed" }`, with no data.
- **Routes (owner only):** `GET /api/projects/[projectId]/agents` gives `{ agents: ProjectAgentSummary[]; sandboxToken: string }`, and `PUT /api/projects/[projectId]/agents/[agentId]` takes `{ instructions?, model?, access?, baseUpdatedAt }` and gives `{ agent }`, or 409 `agentChanged`.
- **The planner:** the `update_agent_instructions` tool, `PlannerState.agents: PlannerAgent[]`, `agentsDescription(agents)`, and the `# AI agents` instructions section, right after phase 3's `# Server functions`.
- **The workspace:** an Agent tab in `components/workspace/preview-panel.tsx` (owner only), with a "Try it" box that calls the sandbox through `/api/apps/[projectId]/server/...`. `lib/agents/try.ts` exports `readAgentReply` and `tryAgent`, and `hooks/use-agent-settings.ts` exports `useAgentSettings`.

## Phase 5: publishing and export

**Produces:**
- `lib/publish/expo.ts`:
  ```ts
  type AppEnvVar = { name: string; value: string; visibility: "sensitive" | "plaintext" }
  syncAppEnvironment(accessToken: string, appId: string, vars: AppEnvVar[], managedNames: readonly string[]): Promise<void>
  cancelWorkflowRun(accessToken: string, workflowRunId: string): Promise<void>
  ```
  `syncAppEnvironment` upserts the given variables in the `production` environment and deletes (or unlinks from `production`) only the `managedNames` that are no longer listed.
- `lib/publish-protocol.ts`: `SERVER_DEPLOY_STATUSES`, `ServerDeployStatus`, `ServerDeployReason = "publish" | "credentials" | "agent" | "retry"` and `ServerDeploySummary`.
- `lib/publish/server-files.ts` (pure): `hasServerRoutes`, `serverFilesHash`, `withAgentInstructions`, `environmentVars`, `DeployState`, `nextServerDeploy`, `ServerReport`, `serverReport` and `summarizeServerDeploy`. It imports phase 3's `isServerFile` and doesn't define its own.
- `lib/generated-app/build-files.ts`: `webWorkflow(serverEnv = false)`. With `true`, the deploy job loads the EAS variables. The variant (B: an `eas env:pull` hook, or C: a custom job running `eas deploy --environment production`) is recorded here by phase 5's Task 1 spike: _to be filled in_.
- **Snapshots:** a `published_snapshots` table and `project_publishing.server_origin`. `lib/publish/snapshots.ts` exports `loadSnapshot`, `saveSnapshot`, `recordServerDeploy`, `failServerDeploy`, `queueRedeploy`, `loadPublishIdentity` and `saveServerOrigin`.
- **Phase 1 store addition:**
  ```ts
  listCredentialValues(projectId: string): Promise<{ name: string; value: string; kind: "secret" | "public" | "oauth_token" }[]>
  ```
  It's built on phase 3's `connectedServiceCredentials`, so EAS gets exactly the credentials the sandbox gets: connected services' plus the server key. Phase 3's `loadProjectEnvironment(projectId): Promise<{ env: Record<string, string>; secretNames: string[] }>` is unchanged.
- `lib/publish/server-deploy.ts`:
  ```ts
  syncServerEnvironment(expoToken: string, appId: string, project: Pick<Project, "id" | "plan">, previous: PublishedSnapshot | null): Promise<string[]>
  deployServer(project: Project, userId: number, reason: ServerDeployReason): Promise<"started" | "queued" | "skipped" | "failed">
  getServerDeploy(projectId: string, userId: number, t: Translator<"errors">): Promise<ServerDeploySummary | null>
  ```
  `syncServerEnvironment` calls `ensureServerKey(project.id)` before listing credentials whenever the plan has a backend. Every env sync, `web.ts` included, goes through it.
- **Redeploys** send the snapshot byte for byte, with only the agent instruction files swapped in: `withAgentInstructions(snapshot.files, await serverSourceFiles(projectId))` takes the current `server/agents/<id>.instructions.ts` rows, which phase 4's `writeAgentFiles` writes with `agentConfigFile(agent)` at `agentInstructionsPath(id)`.
- **Export changes:** `lib/generated-app/server-export.ts` (`ExportServer`, `publishedServerConfig`, `envNames`, `envExampleFile`, `serverReadmeSection`), `exportedProjectFiles(project, screens, publishing?, server?)`, and `PublishIdentity.serverOrigin`. Together they add the server files, `.env.example`, `web.output: "server"`, the `expo-router` `origin`, and the README section. `loadProjectExport`'s `includeServer: true` now also loads `serverSourceFiles` and `listServiceSummaries`.
- **Hooks:** `lib/publish/server-hooks.ts` exports `scheduleServerRedeploy(projectId, reason: "credentials" | "agent")` and `onCredentialsChanged(projectId)`. Changes to credentials (phase 1 store, and phase 3's key rotation) and `onAgentChanged` (phase 4) call them, which run `deployServer` in the background when the app is published.
- **Routes:** `GET`/`POST /publish/web` give `{ web, server: ServerDeploySummary | null }`, and `POST /api/projects/[projectId]/publish/server` (owner only) runs `deployServer(project, user.id, "retry")`.
