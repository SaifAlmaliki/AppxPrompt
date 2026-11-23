# Integrations Phase 5: Publishing Server Functions and Exporting Them

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Contract changes (Task 1 makes them in `docs/superpowers/plans/2026-11-23-integrations-contract.md`):**
> 1. `syncAppEnvironment` gains a 4th parameter, `managedNames: readonly string[]`. Without it the function can't tell its own variables apart from ones the owner made in the same Expo project, so "deletes the ones it manages" couldn't work safely.
> 2. `deployServer`'s `reason` gains `"retry"`, which is used by the dialog's retry button and by queued redeploys. It returns `Promise<"started" | "queued" | "skipped" | "failed">`.
> 3. New phase 5 names: `cancelWorkflowRun` and `AppEnvVar` (expo.ts), `webWorkflow(serverEnv?)`, `lib/publish/snapshots.ts` (where `saveSnapshot` / `loadSnapshot` live), `lib/publish/server-hooks.ts` (`scheduleServerRedeploy`, `onCredentialsChanged`), `loadProjectExport(project, { includeServer })`, and `loadProjectEnvironment` added to the phase 1 store.
> 4. New names this phase **consumes** from phase 3/4, which their plans must produce or alias:
>    - `serverSourceFiles(projectId: string): Promise<{ path: string; code: string }[]>` in `lib/sandbox/bundle.ts`. It returns every server-side source file as the sandbox loads it: routes, helpers, `server/data.ts`, `server/auth.ts`, `server/agent-loop.ts` and `server/agents/<id>.instructions.ts`.
>    - The generated `lib/server/config.ts` exports exactly `SERVER_BASE_URL: string` (no trailing slash; `""` means relative) and `SERVER_TOKEN: string | null`, and `lib/server/index.ts` reads nothing else to decide where to call.

**Goal:** When an app has server functions, every publish deploys them to the owner's own EAS Hosting with the owner's credentials as EAS **sensitive** environment variables. Native builds call that server. Later credential or agent changes redeploy the last published snapshot in the background. ZIP and GitHub exports carry the server code, `.env.example` (names only) and deploy instructions.

**Architecture:**
- **Expo calls:** every new GraphQL call (listing, creating, updating and deleting environment variables, and cancelling a run) goes in `lib/publish/expo.ts`.
- **Pure rules** live in `lib/publish/server-files.ts`, so they're unit-tested: which files are server files, the server hash, swapping agent instructions into a snapshot, mapping credentials to variables, the deploy/queue/skip decision, and run → status.
- **The snapshot table:** a `published_snapshots` row per project holds the exact files last sent to EAS plus the server deploy's status. `lib/publish/server-deploy.ts` orchestrates deploys, and `lib/publish/server-hooks.ts` runs them in the background through `after()`.
- **Exports:** `exportedProjectFiles` gains the server files and their config, so the ZIP, GitHub, the website publish and native builds all send the same tree.

**Tech Stack:** Next.js 16 route handlers and `after()`, Drizzle ORM / Postgres, Expo's GraphQL API (undocumented, mirrored from eas-cli), EAS Workflows, next-intl, vitest (node env, `tests/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-11-22-app-integrations-design.md`. This plan covers build order phase 5: section 6 in full, and the export parts of section 4's "Snack and export". Contract: `docs/superpowers/plans/2026-11-23-integrations-contract.md`.

## Decisions and verified facts

1. **EAS environment variable GraphQL calls** (verified in eas-cli `main`, `packages/eas-cli/src/graphql/mutations/EnvironmentVariableMutation.ts`, `queries/EnvironmentVariablesQuery.ts` and `generated.ts`):
   - **Create:** `mutation ($input: CreateEnvironmentVariableInput!, $appId: ID!) { environmentVariable { createEnvironmentVariableForApp(environmentVariableData: $input, appId: $appId) { id } } }`. The input is `{ name, value, visibility, environments?, type?, overwrite?, fileName? }`.
   - **Update:** `mutation ($input: UpdateEnvironmentVariableInput!) { environmentVariable { updateEnvironmentVariable(environmentVariableData: $input) { id } } }`. The input is `{ id, name?, value?, visibility?, environments?, type? }`.
   - **Delete:** `mutation ($id: ID!) { environmentVariable { deleteEnvironmentVariable(id: $id) { id } } }`.
   - **List:** `query ($appId: String!, $filterNames: [String!], $environment: EnvironmentVariableEnvironment) { app { byId(appId: $appId) { id environmentVariables(filterNames: $filterNames, environment: $environment) { id name environments scope visibility } } } }`.
   - **Enums:** `EnvironmentVariableVisibility` is `PUBLIC | SENSITIVE | SECRET`, and `EnvironmentSecretType` is `STRING | FILE_BASE64`. `EnvironmentVariableEnvironment` is a scalar, and the CLI passes lowercase names (`"production"`).
   - `createBulkEnvironmentVariablesForApp` also exists, but isn't used, because its `overwrite` semantics aren't documented.
2. **Visibility.** EAS Hosting only uses **plain text** and **sensitive** variables, and secret variables can't be deployed (docs, `eas/environment-variables/usage`). Credentials of kind `secret` and `oauth_token` become `SENSITIVE`, and `public` ones become `PUBLIC`. The spec accepts that sensitive values can be read by members of the owner's Expo account.
3. **The deploy job doesn't upload server variables by itself.** This is verified in source, and it's why the spec's "existing `webWorkflow()`" isn't enough on its own:
   - `eas deploy` puts EAS variables into the deployment manifest only with `--environment`. Without the flag, it only reads the project's `.env*` files (`packages/eas-cli/src/worker/assets.ts`, `createManifestAsync`, which calls `parseProjectEnv(projectDir, { mode: "production" })`).
   - The workflow `deploy` job's `eas/deploy` step runs `eas deploy --non-interactive --json --export-dir dist [--alias] [--prod] [--source-maps]`, with **no `--environment`** (`packages/build-tools/src/steps/functions/deploy.ts`).
   - A job-level `environment: production` only exposes the variables to the job's process.
   - **The fix:** the deploy job gets an `after_install_node_modules` hook that runs `eas env:pull --environment production --non-interactive`. That writes `.env.local` with the plain-text and sensitive values (`commands/env/pull.ts`, default path `.env.local`), and `createManifestAsync` then reads it.
   - **Task 1 proves this on a real account.** The fallback is a custom job that runs `eas deploy --prod --environment production` itself.
4. **A known limit:** `env:pull` writes unquoted `NAME=value` lines, so a value containing a newline won't survive. v1 credentials are single-line keys and tokens, and phase 1 trims every value.
5. **Deployments are immutable**, so changing a variable needs a new deploy but not a native rebuild (docs, "Environment variables are per deployment").
6. **SDK 54 Expo Router:**
   - `web.output: "server"` is required for API routes.
   - The `expo-router` plugin option `origin` exists in SDK 54 (`docs.expo.dev/versions/v54.0.0/sdk/router`). It polyfills relative `fetch` in production native builds, and in development the origin is the dev server.
   - Nothing may be written to `expo.extra.router.origin` (docs, api-routes).
7. **Cancelling a run:** `mutation ($workflowRunId: ID!) { workflowRun { cancelWorkflowRun(workflowRunId: $workflowRunId) { id } } }` exists (eas-cli `generated.ts`, `WorkflowRunMutation_CancelWorkflowRunArgs`).
8. **`after()` from `next/server`** runs a callback after a route handler's response, within the route's `maxDuration`, using Vercel's `waitUntil` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`). Outside a request scope it throws, so the hook falls back to a detached promise.
9. **README commands:** `eas env:set --environment production --visibility sensitive --name NAME --value "…"` (`eas env:create` is deprecated, per `commands/env/create.ts`), then `npx expo export --platform web` and `eas deploy --prod --environment production`.
10. **Designer's calls:**
    - **One snapshot row per project**, holding the whole project as last sent. The deploy job exports the web client and the server together, so a server deploy is a whole-project deploy.
    - **A native publish whose server files changed** deploys the current project, which also updates the website. The dialog says so.
    - **A background redeploy** sends the snapshot byte for byte. The only change is the instruction files of agents that are already in the snapshot.
    - **Redeploy requested during a publish run:** the publish run is never cancelled; the redeploy is queued instead. An older redeploy run *is* cancelled when a newer one is needed.
    - **Where apps call:** `lib/server/config.ts` in exports and publishes calls relative on the web and the absolute origin on native.
    - **Server origin storage:** the origin lives on `project_publishing.server_origin`, so every export carries it.

## Global Constraints

- **Next.js:** read `node_modules/next/dist/docs/` before writing a route handler (`AGENTS.md`). Use `after` from `next/server` for background work.
- **Expo's API:** everything that depends on Expo's GraphQL shape stays in `lib/publish/expo.ts`.
- **Visibility:** server variables use **sensitive** visibility, never secret, in the `production` environment. Public values go as plain text (`PUBLIC`).
- **Where values may go:** a credential value may only be in the sealed column, the sandbox's environment, and the owner's EAS environment variables. Never put one in logs, Sentry, stored errors, API responses, snapshots, tarball files, exports or GitHub pushes. `.env.example` lists names only.
- **Exports:** they set `web.output: "server"` only when the app has server routes, and leave apps without them byte-for-byte unchanged.
- **Snapshots:** a background redeploy never sends unpublished screen or route edits. The snapshot is what goes out, with only agent instruction files swapped in.
- **Who may act:** only the owner publishes, retries, or receives server files in exports (`getProjectAccess(...).role === "owner"`). Everyone else's ZIP leaves out `app/api/**`, `server/**` and `.env.example`.
- **Interface text:** every string goes in `messages/en.json` **and** `messages/ar.json`. No literal JSX text. Use logical Tailwind classes only, and wrap URLs and names in `<bdi dir="ltr">`.
- **Tests:** run with `npx vitest run --configLoader runner <file>`, typecheck with `npx tsc --noEmit`, and lint with `npm run lint`.

## Review Focus

1. **Unpublished edits going live through a redeploy.** The owner edits screens and a route but doesn't publish, then changes a key or the agent's instructions. The live site and server must still be the published version, with only existing agents' instructions updated. *(Task 3 `withAgentInstructions` tests, Task 6 "redeploys the published files" test.)*
2. **The owner's own EAS variables.** The owner may already have `OPENAI_API_KEY` in `development`, or a variable AppxPrompt never set. Syncing must not change their other environments, and must never delete a name it didn't set. *(Task 2 tests.)*
3. **Expo echoing a value in an error.** If a mutation fails with a message that contains the value, neither the thrown error, the log, nor the stored publish error may contain it. *(Task 2 test.)*
4. **Changes in quick succession, or during a publish.** Two keys saved a second apart, or a key changed while the website publish runs. The last values must end up live, and the publish run must not be cancelled. *(Task 3 `nextServerDeploy` tests, Task 6 queue/cancel tests.)*
5. **A background redeploy with Expo gone.** The owner has disconnected Expo, or the token was revoked, when a key changes. The key save still succeeds, and the dialog shows "failed" with the reason, never a crash or a silent "up to date". *(Task 6 and Task 7 tests.)*

---

### Task 1: Spike on a real Expo account, and the contract update

**Files:**
- Modify: `docs/superpowers/plans/2026-11-23-integrations-contract.md` (the Phase 5 section, plus the two consumed names under Phases 3 and 4)
- Scratch (not committed): a throwaway Expo SDK 54 app in `C:\Users\lenovo\AppData\Local\Temp\opencode\spike-hosting`

**Interfaces:**
- Produces: a recorded answer to which deploy YAML gets EAS variables into API routes, which Task 3 encodes as `SERVER_ENV_HOOK`.

- [ ] **Step 1: Update the contract.** Apply the four changes listed at the top of this plan, word for word, to the contract's Phase 5 section, and add the two consumed names to its Phase 3 and Phase 4 sections. Also write out every Phase 5 signature from this plan's Interfaces blocks.

- [ ] **Step 2: Build the spike app**
  - Create it with `npx create-expo-app@latest spike-hosting --template default@sdk-54`.
  - Set `web.output: "server"`.
  - Add `app/api/ping+api.ts`, returning `Response.json({ hasKey: Boolean(process.env.SPIKE_KEY), length: process.env.SPIKE_KEY?.length ?? 0 })`.
  - Run `eas init`, then `eas deploy --prod` once by hand, so it has a domain.

- [ ] **Step 3: Check the variable mutations**
  - With a throwaway `node` script calling `https://api.expo.dev/graphql` with an access token, run the exact create, list, update and delete documents from Decisions 1 on `SPIKE_KEY`, using `environments: ["production"]`, `visibility: "SENSITIVE"` and `type: "STRING"`.
  - Also create `SPIKE_SECRET` with visibility `SECRET`, then try to update it to `SENSITIVE`.
  - Expected: all four documents succeed. Record whether the SECRET → SENSITIVE update is refused. If it is, Task 2's sync must delete and recreate such a variable instead of updating it.

- [ ] **Step 4: Check which workflow gets the variable into the route**
  - Run each YAML below with `eas workflow:run <file>` from the spike app, with `SPIKE_KEY` set to a 10-character value. After each run, `curl https://<domain>.expo.app/api/ping`.
  - **A** is today's `webWorkflow()` text from `lib/generated-app/build-files.ts`. Expected: `hasKey: false`, which confirms Decisions 3.
  - **B** is A plus this hook under the job:
    ```yaml
        hooks:
          after_install_node_modules:
            - name: Load the server's keys
              run: npx --yes eas-cli@latest env:pull --environment production --non-interactive
    ```
    Expected: `hasKey: true, length: 10`.
  - **C** (only if B fails) is a custom job:
    ```yaml
    jobs:
      deploy:
        environment: production
        env:
          EAS_NO_VCS: "1"
        steps:
          - uses: eas/checkout
          - uses: eas/install_node_modules
          - run: npx expo export --platform web
          - run: npx --yes eas-cli@latest deploy --prod --environment production --non-interactive --json
    ```
  - Record which of B or C works as one line in the contract's Phase 5 section. Task 3 uses that one. If neither works, stop and report: publishing server functions isn't possible as designed.

- [ ] **Step 5: Check `origin` and cancelling**
  - Add `["expo-router", { "origin": "https://<domain>.expo.app" }]` to the spike's plugins, and run `npx expo export --platform android`. Expected: the origin string appears in `dist/` (in the embedded app config), and `app.json` has no `extra.router.origin`.
  - Start workflow B and run the `cancelWorkflowRun` document from Decisions 7 on it while it's in progress. Expected: the run ends `CANCELED`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-11-23-integrations-contract.md
git commit -m "docs(integrations): phase 5 contract names and EAS hosting spike results"
```

---

### Task 2: EAS environment variables and cancelling runs in `expo.ts`

**Files:**
- Modify: `lib/publish/expo.ts`, `messages/en.json`, `messages/ar.json` (the `errors` namespace), `tests/i18n/publish-errors.test.ts`
- Test: `tests/publish/expo-env.test.ts`

**Interfaces:**
- Produces:
  - `export type AppEnvVar = { name: string; value: string; visibility: "sensitive" | "plaintext" }`
  - `syncAppEnvironment(accessToken: string, appId: string, vars: AppEnvVar[], managedNames: readonly string[]): Promise<void>`
  - `cancelWorkflowRun(accessToken: string, workflowRunId: string): Promise<void>`
  - New error keys:
    - `expoEnvFailed`: "Expo didn't accept the app's keys. Try publishing again in a moment."
    - `serverDeployFailed`: "The server functions couldn't be updated."
    - `serverDeployCancelled`: "The server update was cancelled."
    - `serverDeployNeverReached`: "The server update never reached Expo."

**How `syncAppEnvironment` works:**
1. List the app's variables in `environment: "production"`, with `filterNames` set to the sorted, deduplicated union of `vars` names and `managedNames`. Keep only `scope === "PROJECT"`.
2. For each var:
   - **No existing variable:** create it with `{ name, value, visibility, environments: ["production"], type: "STRING" }`.
   - **Existing, and its `environments` is exactly `["production"]`:** update `{ id, value, visibility }`. If Task 1 found SECRET → SENSITIVE refused and the existing variable is `SECRET`, delete it and create instead.
   - **Existing, and linked to other environments too:** update `{ id, environments: <its environments minus "production"> }`, then create a production-only variable.
3. For each name in `managedNames` that isn't in `vars` and exists:
   - If its environments are exactly `["production"]`, delete it.
   - Otherwise, update its environments to remove `"production"`.
4. Visibility maps `sensitive` to `SENSITIVE` and `plaintext` to `PUBLIC`.
5. **Errors:** any `ExpoError` that isn't `unauthorized` from steps 1 to 3 is rethrown as `new ExpoError("expoEnvFailed", false, cause.code)`, with no `values`, so Expo's message (which might echo a value) is dropped. An `unauthorized` error is rethrown unchanged.

- [ ] **Step 1: Write the failing tests**

Use `vi.stubGlobal("fetch", fake)`. The `fake` records `JSON.parse(init.body)` and answers by the query text:
- `environmentVariables(` gives `{ data: { app: { byId: { id: "app1", environmentVariables: listed } } } }`.
- Any mutation gives `{ data: { environmentVariable: { x: { id: "new" } } } }`, or `{ data: { workflowRun: {...} } }`.

Tests:
- `"creates a missing variable as sensitive in production only"`:
  - Call `syncAppEnvironment("t", "app1", [{ name: "OPENAI_API_KEY", value: "sk-x", visibility: "sensitive" }], [])`.
  - There's exactly one mutation. Its query contains `createEnvironmentVariableForApp`, and its variables equal `{ appId: "app1", input: { name: "OPENAI_API_KEY", value: "sk-x", visibility: "SENSITIVE", environments: ["production"], type: "STRING" } }`.
- `"sends public values as PUBLIC"`: `visibility: "plaintext"` gives `input.visibility === "PUBLIC"`.
- `"updates a production-only variable in place"`: `listed = [{ id: "v1", name: "OPENAI_API_KEY", environments: ["production"], scope: "PROJECT", visibility: "SENSITIVE" }]` gives one `updateEnvironmentVariable` with `input` equal to `{ id: "v1", value: "sk-y", visibility: "SENSITIVE" }`, and no create.
- **Review Focus 2:** `"leaves the owner's other environments alone"`: the existing environments are `["production","development"]`. That gives first an update with `input` equal to `{ id: "v1", environments: ["development"] }`, then a create with `environments: ["production"]`. No mutation contains `deleteEnvironmentVariable`.
- **Review Focus 2:** `"only deletes names it manages"`:
  - With `managedNames: ["OLD_KEY"]` and `vars: []`, and `listed` holding `OLD_KEY` (production only, `id: "v9"`), there's one `deleteEnvironmentVariable` with `{ id: "v9" }`.
  - The list request's `filterNames` equals `["OLD_KEY"]`.
- `"filters the list by the names involved"`: `vars` `B, A` with managed `C, A` gives `filterNames` `["A","B","C"]` and `environment: "production"`.
- **Review Focus 3:** `"keeps values out of errors"`:
  - The create answers `{ errors: [{ message: "invalid value sk-secret-123", extensions: { errorCode: "BAD" } }] }`.
  - The promise rejects with an `ExpoError` whose `key` is `"expoEnvFailed"`.
  - Neither `JSON.stringify(error)`, `String(error)` nor `error.message` contains `"sk-secret-123"`.
- `"passes an expired token through"`: HTTP 401 gives an `ExpoError` with `unauthorized === true`.
- `"cancels a workflow run"`: `cancelWorkflowRun("t", "run1")` sends a query containing `cancelWorkflowRun(workflowRunId: $workflowRunId)`, with variables `{ workflowRunId: "run1" }`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/publish/expo-env.test.ts`
Expected: FAIL, because `syncAppEnvironment is not a function`.

- [ ] **Step 3: Implement both functions in `lib/publish/expo.ts`** with the documents from Decisions 1 and 7, through the existing `expoRequest`. Use `const EAS_ENVIRONMENT = "production"`. Never pass a value to `console` or into an error.

- [ ] **Step 4: Add the four error keys** to `en.errors` and `ar.errors`, with the Arabic written properly. Add all four to the key list in the first test of `tests/i18n/publish-errors.test.ts`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run --configLoader runner tests/publish/expo-env.test.ts tests/i18n/publish-errors.test.ts`, then `npx tsc --noEmit`
Expected: PASS, then no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/publish/expo.ts messages tests/publish/expo-env.test.ts tests/i18n/publish-errors.test.ts
git commit -m "feat(publish): sync EAS sensitive environment variables and cancel workflow runs"
```

---

### Task 3: Server deploy rules and the deploy workflow

**Files:**
- Create: `lib/publish/server-files.ts` (pure, no db or network imports)
- Modify: `lib/generated-app/build-files.ts`, `lib/publish-protocol.ts`
- Test: `tests/publish/server-files.test.ts`

**Interfaces:**
- Consumes: `AppEnvVar` (Task 2), `WebRunState` (expo.ts), and `PublishFailure`, `applicationFailure` and `failureText` (errors.ts).
- Produces (`publish-protocol.ts`):
  ```ts
  export const SERVER_DEPLOY_STATUSES = ["deploying", "deployed", "failed"] as const
  export type ServerDeployStatus = (typeof SERVER_DEPLOY_STATUSES)[number]
  export type ServerDeployReason = "publish" | "credentials" | "agent" | "retry"
  export type ServerDeploySummary = { status: "up_to_date" | "updating" | "failed"; error: string | null; deployedAt: string | null }
  ```
- Produces (`server-files.ts`):
  - `hasServerRoutes(files: { path: string }[]): boolean`. It's true when any path matches `/^app\/api\/.+\+api\.ts$/`.
  - `isServerFile(path: string): boolean`, which matches `/^(app\/api\/|server\/)/`.
  - `serverFilesHash(files: { path: string; content: string }[]): string`. It's the SHA-256 hex digest over the server files sorted by path, each fed as `${path}\0${content}\0`.
  - `withAgentInstructions(published: ExportedFile[], current: { path: string; code: string }[]): ExportedFile[]`. Each `published` file matching `/^server\/agents\/[^/]+\.instructions\.ts$/` that has a `current` entry at the same path gets that entry's content. Order is kept, and nothing is added or removed.
  - `environmentVars(credentials: { name: string; value: string; kind: "secret" | "public" | "oauth_token" }[]): AppEnvVar[]`. A `public` credential becomes `plaintext` and everything else `sensitive`. The result is sorted by name.
  - `type DeployState = { serverHash: string; hasServerRoutes: boolean; status: ServerDeployStatus; reason: ServerDeployReason }`
  - `nextServerDeploy(input: { reason: ServerDeployReason; snapshot: DeployState | null; current: { hash: string; hasServerRoutes: boolean } | null }): "start" | "cancel_and_start" | "queue" | "skip"`
  - `type ServerReport = { status: "deploying" } | { status: "deployed" } | { status: "failed"; error: PublishFailure }`
  - `serverReport(run: WebRunState): ServerReport`
  - `summarizeServerDeploy(row: { status: ServerDeployStatus; error: string | null; redeployQueued: boolean; deployedAt: Date | null }, t: Translator<"errors">): ServerDeploySummary`
- Produces (`build-files.ts`): `webWorkflow(serverEnv = false)`. With `false` the YAML is byte-for-byte today's. With `true` it's the variant Task 1 recorded: B adds the `hooks` block exactly as in Task 1 Step 4, after `params`; C is the custom job.

**How `nextServerDeploy` decides.** The first matching row wins.

| Reason | Condition | Result |
|---|---|---|
| `publish` | `!current?.hasServerRoutes && !snapshot?.hasServerRoutes` | `skip` |
| `publish` | `snapshot && snapshot.serverHash === current.hash && snapshot.status !== "failed"` | `skip` |
| `publish` | otherwise | `start` |
| other reasons | `!snapshot?.hasServerRoutes` | `skip` |
| other reasons | `snapshot.status === "deploying" && snapshot.reason === "publish"` | `queue` |
| other reasons | `snapshot.status === "deploying"` | `cancel_and_start` |
| other reasons | otherwise | `start` |

**How `serverReport` reads a run.** The job is the first `DEPLOY` job, or `jobs[0]`.
- `SUCCESS` gives `deployed`.
- `CANCELED` gives `failed` with `applicationFailure("serverDeployCancelled")`.
- `FAILURE` gives `failed` with the first job or run error message as `{ source: "provider", detail }`, falling back to `applicationFailure("serverDeployFailed")`.
- Anything else gives `deploying`.

**How `summarizeServerDeploy` maps a row.**
- `deploying`, or `redeployQueued`, gives `updating`.
- `deployed` gives `up_to_date`.
- `failed` gives `failed`, with `error` set to `failureText(row.error, t)`.
- `deployedAt` is an ISO string or null.

- [ ] **Step 1: Write the failing tests**
  - `hasServerRoutes([{ path: "app/api/booking/slots+api.ts" }])` is true. `[{ path: "app/index.tsx" }, { path: "server/google.ts" }]` is false.
  - `serverFilesHash` ignores non-server files: adding `app/index.tsx` doesn't change it, but changing `server/google.ts` does. It doesn't depend on input order.
  - **Review Focus 1:** given published `[app/index.tsx "old screen", app/api/assistant+api.ts "old route", server/agents/a.instructions.ts "old"]` and current `[server/agents/a.instructions.ts "new", server/agents/b.instructions.ts "b", app/api/assistant+api.ts "new route"]`, `withAgentInstructions` gives exactly `[app/index.tsx "old screen", app/api/assistant+api.ts "old route", server/agents/a.instructions.ts "new"]`.
  - `environmentVars([{ name: "B", value: "1", kind: "public" }, { name: "A", value: "2", kind: "oauth_token" }])` gives `[{ name: "A", value: "2", visibility: "sensitive" }, { name: "B", value: "1", visibility: "plaintext" }]`.
  - `nextServerDeploy`: one `it` per table row, with fixtures that just meet each condition. **Review Focus 4:** `reason: "credentials"` while a `publish` is deploying gives `"queue"`, and `reason: "agent"` while a `credentials` deploy is deploying gives `"cancel_and_start"`.
  - `serverReport`: `SUCCESS` gives `{ status: "deployed" }`. `FAILURE` with a job error message `"boom"` gives `{ status: "failed", error: { source: "provider", detail: "boom" } }`. `CANCELED` gives the `serverDeployCancelled` failure. `IN_PROGRESS` gives `deploying`.
  - `summarizeServerDeploy` with `status: "deployed", redeployQueued: true` gives `status: "updating"`.
  - `webWorkflow()` equals today's text. Check it with a literal copy of the current YAML string in the test. `webWorkflow(true).yamlConfig` contains `environment: production` and the chosen variant's `env:pull` or `--environment production` line.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/publish/server-files.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement** the changes in `publish-protocol.ts`, `server-files.ts` and `build-files.ts` to the interfaces above.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the same file, then `npx tsc --noEmit`
Expected: PASS, then no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/publish/server-files.ts lib/publish-protocol.ts lib/generated-app/build-files.ts tests/publish/server-files.test.ts
git commit -m "feat(publish): rules for server deploys, snapshots, and the deploy workflow that carries keys"
```

---

### Task 4: The snapshot table, the server origin, and loading the environment

**Files:**
- Modify: `db/schema.ts`, `lib/services/store.ts`
- Create: the generated `drizzle/00NN_*.sql` (the next free number after phases 1 to 4), `lib/publish/snapshots.ts`

**Interfaces:**
- Consumes: `serverFilesHash` and `hasServerRoutes` (Task 3), `storeFailure` and `PublishFailure`, `unseal`.
- Produces (`db/schema.ts`):
  - `serverDeployStatus = pgEnum("server_deploy_status", SERVER_DEPLOY_STATUSES)`.
  - **`projectPublishing`** gains `serverOrigin: text("server_origin")`, nullable. It holds the site address, such as `https://shop-ab12cd34.expo.app`.
  - **`publishedSnapshots`** (table `published_snapshots`):
    - `projectId` uuid primary key (cascade).
    - `files` jsonb `$type<ExportedFile[]>()` not null.
    - `serverHash` text not null, and `hasServerRoutes` boolean not null.
    - `envNames` text[] not null, default `'{}'`.
    - `status` `serverDeployStatus` not null, and `reason` text `$type<ServerDeployReason>()` not null.
    - `easRunId` text, nullable, and `error` text, nullable.
    - `redeployQueued` boolean not null, default false.
    - `startedAt` timestamp not null, and `deployedAt` timestamp nullable.
    - `createdAt`, and `updatedAt` (`$onUpdate`).
  - `export type PublishedSnapshot = typeof publishedSnapshots.$inferSelect`.
- Produces (`lib/publish/snapshots.ts`, server only):
  - `loadSnapshot(projectId: string): Promise<PublishedSnapshot | null>`
  - `saveSnapshot(projectId: string, files: ExportedFile[], run: { easRunId: string; reason: ServerDeployReason; envNames: string[] }): Promise<void>`. It upserts `files`, `serverHash`, `hasServerRoutes` and `envNames`, sets `status: "deploying"`, `easRunId` and `reason`, sets `error: null`, `redeployQueued: false` and `startedAt: now`, and keeps `deployedAt`.
  - `recordServerDeploy(row: PublishedSnapshot, report: ServerReport): Promise<void>`. It only moves the row while `status = 'deploying'` and `easRunId = row.easRunId`. `deployed` sets `deployedAt: now, error: null`, and `failed` sets `error: storeFailure(...)`.
  - `failServerDeploy(projectId: string, error: PublishFailure): Promise<void>`. It sets `status: "failed"`, the error, and `redeployQueued: false`, for a deploy that couldn't start.
  - `queueRedeploy(projectId: string): Promise<void>`
  - `loadPublishIdentity(projectId: string): Promise<ProjectPublishing | null>`
  - `saveServerOrigin(projectId: string, origin: string): Promise<void>`
- Produces (`lib/services/store.ts`, an addition to phase 1's store): `loadProjectEnvironment(projectId: string): Promise<{ name: string; value: string; kind: "secret" | "public" | "oauth_token" }[]>`. It returns every `project_credentials` row of the project, including system ones such as `APPXPROMPT_SERVER_KEY`, with values unsealed unless `kind === "public"`. Only `lib/publish/server-deploy.ts` and `lib/publish/web.ts` call it. Add that to the store's header comment.

- [ ] **Step 1: Add the column and table, and generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/00NN_*.sql` that creates `server_deploy_status`, `published_snapshots`, and `ALTER TABLE "project_publishing" ADD COLUMN "server_origin" text`.

- [ ] **Step 2: Implement `lib/publish/snapshots.ts` and `loadProjectEnvironment`**, in the drizzle style of `lib/publish/web.ts`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`, then `npm test`
Expected: no errors (the `PublishIdentity` addition comes in Task 5, so `exportedProjectFiles` still compiles), and PASS.

Run: `npx drizzle-kit migrate` on the dev database.
Expected: `\d published_snapshots` shows the primary key and the cascade.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts drizzle lib/publish/snapshots.ts lib/services/store.ts
git commit -m "feat(publish): published snapshots table, server origin, and loading a project's environment"
```

---

### Task 5: Server files in the ZIP, GitHub and publishes

**Files:**
- Create: `lib/generated-app/server-export.ts`
- Modify:
  - `lib/generated-app/export-project.ts`
  - `lib/project-access.ts`
  - `app/api/projects/[projectId]/export/route.ts`
  - `lib/github/projects.ts:146`
  - `lib/publish/web.ts:130,145` and `lib/publish/builds.ts:226,244` (call sites only)
- Test: `tests/generated-app/export-server.test.ts`

**Interfaces:**
- Consumes: `ServiceSummary` and `refreshTokenName` (phase 1), and `serverSourceFiles` and `listServiceSummaries` (phases 3 and 1).
- Produces (`server-export.ts`):
  - `type ExportServer = { files: { path: string; code: string }[]; services: ServiceSummary[] }`
  - `publishedServerConfig(origin: string | null): string`
  - `envNames(server: ExportServer): string[]`. In order, it lists each service's field names, then `refreshTokenName(slug)` for `oauth2` services, then `"APPXPROMPT_SERVER_KEY"` if any file's code contains it. No name appears twice.
  - `envExampleFile(server: ExportServer): string`
  - `serverReadmeSection(server: ExportServer): string`
- Produces (`export-project.ts`):
  - `PublishIdentity` gains `serverOrigin: string | null`.
  - `exportedProjectFiles(project, screens, publishing?, server?: ExportServer | null)`
- Produces (`project-access.ts`): `loadProjectExport(project: Project, options: { includeServer: boolean }): Promise<LoadedExport>`. The option is required, so every call site makes the decision. With `includeServer`, it loads `serverSourceFiles(project.id)` and `listServiceSummaries(project.id)`, and passes `{ files, services }`. Otherwise it passes `null`. If phase 3 already filtered server files for viewers in this function or in the export route, replace that with this option.

**What `exportedProjectFiles` changes.** Let `routes = server && hasServerRoutes(server.files)` and `origin = publishing?.serverOrigin ?? null`.
- If the sources contain `lib/server/config.ts` (phase 3 generates it whenever the plan has server routes), drop it and add `{ path: "lib/server/config.ts", content: publishedServerConfig(origin) }`. This applies to viewers too, so no sandbox config ever leaves.
- **When `routes` is true:**
  - Add every `server.files` entry.
  - In `app.json`, set `web.output: "server"`, and set `plugins` to `[["expo-router", { origin }]]` when there's an origin, else `["expo-router"]`.
  - Add `.env.example`, made by `envExampleFile`.
  - Append `serverReadmeSection(server)` to `README.md`.
  - Append the line `.env` to `.gitignore`.
- **When `routes` is false**, every file is byte-for-byte as today, apart from the config replacement.

**`publishedServerConfig(origin)`, exactly:**
- With an origin:
  ```ts
  import { Platform } from "react-native"

  // The app's server functions. The website calls them on its own address, and the apps call the published server.
  export const SERVER_BASE_URL = Platform.OS === "web" ? "" : "<origin>"
  export const SERVER_TOKEN: string | null = null
  ```
- With `null`, the same comment, then `export const SERVER_BASE_URL = ""` and the same `SERVER_TOKEN` line, with no import.

**`envExampleFile`:** these two header lines, a blank line, then one `NAME=` line per `envNames` entry:

```
# The keys the server functions in app/api/ read. Put real values in a .env file to run the app on your computer,
# and set them as sensitive EAS environment variables to deploy. Never commit real values.
```

**`serverReadmeSection`:** the following, with one `###` block per service. The service's `setupSteps` go in as they are, followed by `Keys: \`A\`, \`B\``. The `APPXPROMPT_SERVER_KEY` paragraph is only included when that name is in `envNames`.

````
## Server functions

`app/api/` holds the app's server functions (Expo Router API routes), and `server/` holds the code they share. They run on a server, so the keys they use never reach the app.

### <service name>

<setupSteps>

Keys: `NAME`, `NAME`

`APPXPROMPT_SERVER_KEY` lets the functions reach the app's data on AppxPrompt. AppxPrompt sets it when you publish from there, and it isn't shown anywhere.

### Run them on your computer

Copy `.env.example` to `.env`, fill in the values, and run `npx expo start`. `.env` stays out of git.

### Deploy them

Set each key as a **sensitive** EAS environment variable in the `production` environment. EAS Hosting can't use secret ones.

```bash
eas env:set --environment production --visibility sensitive --name NAME --value "…"
```

Then deploy:

```bash
npx expo export --platform web
eas deploy --prod --environment production
```

Keys are part of each deployment, so deploy again after changing one. The apps reach the functions at the `origin` set for the `expo-router` plugin in `app.json`.
````

- [ ] **Step 1: Write the failing tests**

Fixtures:
- `project = { title: "Shop", plan: null }`.
- One `ProjectScreen` with status `"done"` and code at `app/index.tsx`, built with the same fields `toProjectScreen` gives.
- `server = { files: [{ path: "app/api/assistant+api.ts", code: "export async function POST() { return Response.json({ k: process.env.OPENAI_API_KEY, s: process.env.APPXPROMPT_SERVER_KEY }) }" }, { path: "server/google.ts", code: "export {}" }], services: [openaiSummary, googleSummary] }`.
- `openaiSummary` has field `OPENAI_API_KEY` with hint `"sk-…a1b2"` and `setupSteps` `"1. Open platform.openai.com"`.
- `googleSummary` is `oauth2` with slug `google-calendar` and fields `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`.

Tests:
- `"leaves apps without server functions unchanged"`: `exportedProjectFiles(project, screens)` and `exportedProjectFiles(project, screens, null, null)` give identical arrays. `app.json` has `web.output === "single"` and `plugins` equal to `["expo-router"]`, and there's no `.env.example`.
- `"includes server files and server output"`: the paths include both server files. `JSON.parse(app.json).expo.web.output === "server"`.
- `".env.example lists names and never values"`:
  - Its lines after the header are exactly `OPENAI_API_KEY=`, `GOOGLE_CALENDAR_CLIENT_ID=`, `GOOGLE_CALENDAR_CLIENT_SECRET=`, `GOOGLE_CALENDAR_REFRESH_TOKEN=` and `APPXPROMPT_SERVER_KEY=`.
  - No exported file contains `"a1b2"`.
- `"points native builds at the published server"`: with `publishing.serverOrigin = "https://shop-ab12cd34.expo.app"`:
  - `plugins` equals `[["expo-router", { origin: "https://shop-ab12cd34.expo.app" }]]`, and `expo.extra?.router` is undefined.
  - `lib/server/config.ts` contains `Platform.OS === "web" ? "" : "https://shop-ab12cd34.expo.app"`.
- `"replaces the sandbox config exactly once"`: partially mock `@/lib/generated-app/project-files` (keeping `ALLOWED_PACKAGES` real through `vi.importActual`) so that `generatedAppFiles` returns `[{ path: "lib/server/config.ts", code: "sandbox" }]`. In the export, exactly one file has that path, its content equals `publishedServerConfig(null)`, and no file contains `"sandbox"`.
- `"README explains keys and deploys"`: the README contains `eas deploy --prod --environment production`, `--visibility sensitive`, `"### "` followed by the openai service's name, and `"1. Open platform.openai.com"`.
- `".gitignore keeps .env out"`: for the server export, `.gitignore` ends with `.env\n`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/generated-app/export-server.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `server-export.ts` and the `exportedProjectFiles` changes**, then `loadProjectExport`'s option, and update the call sites:
  - The export route passes `{ includeServer: access.role === "owner" }`.
  - `lib/github/projects.ts`, `web.ts` and `builds.ts` pass `{ includeServer: true }`. These routes are owner-only.
  - `loadProjectExport` maps the `projectPublishing` row's `serverOrigin` into `PublishIdentity`.

- [ ] **Step 4: Run the tests, the full suite, and the typecheck**

Run: the same file, then `npm test`, then `npx tsc --noEmit`
Expected: PASS, PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/generated-app lib/project-access.ts app/api/projects/[projectId]/export lib/github/projects.ts lib/publish/web.ts lib/publish/builds.ts tests/generated-app/export-server.test.ts
git commit -m "feat(export): server functions, .env.example, server output and origin in ZIP, GitHub and publishes"
```

---

### Task 6: Deploying the server, on publish and as a redeploy

**Files:**
- Create: `lib/publish/server-deploy.ts`
- Modify: `lib/publish/web.ts` (`sendToExpo`, `startWebPublish`), `lib/publish/builds.ts` (`sendToExpo`, and `friendlyStartError`'s fallback union)
- Test: `tests/publish/server-deploy.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `syncAppEnvironment`, `cancelWorkflowRun`. Also from expo.ts: `ensureExpoApp`, `ensureWebDomain`, `startWorkflowRun`, `readWebRun`.
  - Task 3: `nextServerDeploy`, `withAgentInstructions`, `environmentVars`, `serverFilesHash`, `hasServerRoutes`, `serverReport`, `summarizeServerDeploy`, `webWorkflow(true)`, `EAS_JSON`.
  - Task 4: all of `snapshots.ts`, and `loadProjectEnvironment`.
  - Task 5: `loadProjectExport(project, { includeServer: true })`.
  - Others: `serverSourceFiles` (phase 3), `projectTarball`, and from builds.ts `loadExpoConnection`, `withProjectId`, `friendlyStartError`, `PublishBlockedError`, `CHECK_EVERY_MS` and `NEVER_STARTED_AFTER_MS`.
- Produces (`server-deploy.ts`, server only):
  - `syncServerEnvironment(expoToken: string, appId: string, projectId: string, previous: PublishedSnapshot | null): Promise<string[]>`. It calls `syncAppEnvironment(expoToken, appId, environmentVars(await loadProjectEnvironment(projectId)), previous?.envNames ?? [])` and returns the names it set.
  - `deployServer(project: Project, userId: number, reason: ServerDeployReason): Promise<"started" | "queued" | "skipped" | "failed">`
  - `getServerDeploy(projectId: string, userId: number, t: Translator<"errors">): Promise<ServerDeploySummary | null>`
- **Imports:** `builds.ts` imports `deployServer` with a dynamic `await import("@/lib/publish/server-deploy")` inside `sendToExpo`, because `server-deploy.ts` imports from `builds.ts`. `web.ts` imports it statically.

**What `deployServer` does:**
1. `snapshot = await loadSnapshot(project.id)`.
2. **For `publish`:** load `current = loadProjectExport(project, { includeServer: true })` and compute `{ hash: serverFilesHash(current.files), hasServerRoutes: hasServerRoutes(current.files) }`. **For other reasons**, `current = null` and nothing from the live project is loaded.
3. `decision = nextServerDeploy(...)`. `skip` returns `"skipped"`. `queue` calls `queueRedeploy` and returns `"queued"`.
4. **The Expo connection:** `expo = loadExpoConnection(userId)`. If it's missing:
   - `publish` throws `PublishBlockedError("expoConnectFirst", "expo")`.
   - Other reasons call `failServerDeploy(project.id, applicationFailure("publishExpoDisconnected"))` and return `"failed"`.
5. **The app and its address:** `identity = loadPublishIdentity(project.id)`. If it's null, return `"skipped"`. Then `{ appId, accountId } = ensureExpoApp(token, identity.easOwner, identity.slug)`, `domain = ensureWebDomain(token, appId)`, and `saveServerOrigin(project.id, \`https://${domain}.expo.app\`)`.
6. **The files:**
   - `publish`: reload the export (it now carries the origin) and map `app.json` through `withProjectId(…, appId)`.
   - Other reasons: `withAgentInstructions(snapshot.files, await serverSourceFiles(project.id))`.
7. `envNames = syncServerEnvironment(token, appId, project.id, snapshot)`.
8. If the decision is `cancel_and_start` and `snapshot.easRunId` is set, run `await cancelWorkflowRun(token, snapshot.easRunId).catch(() => {})`.
9. Start the run: `easRunId = startWorkflowRun(token, { appId, accountId, workflow: webWorkflow(true), tarball: projectTarball(files), easJson: EAS_JSON, packageJson })`, where `packageJson` is the `package.json` content in `files`.
10. `saveSnapshot(project.id, files, { easRunId, reason, envNames })`, then return `"started"`.
11. **Errors:** for `publish`, errors propagate to the caller. For other reasons, catch, log with `console.error(\`Updating the server of project ${project.id} failed\`, cause)`, call `failServerDeploy(project.id, friendlyStartError(cause, "serverDeployFailed"))`, and return `"failed"`.

**What `getServerDeploy` does:**
- It returns null when there's no snapshot, or `!snapshot.hasServerRoutes`.
- **The refresh:** when the status is `deploying` and `updatedAt` is older than `CHECK_EVERY_MS`:
  - With no `easRunId` past `NEVER_STARTED_AFTER_MS`, it calls `failServerDeploy(..., applicationFailure("serverDeployNeverReached"))`.
  - Otherwise it calls `recordServerDeploy(row, serverReport(await readWebRun(token, row.easRunId)))`.
  - `unauthorized` gives `publishTokenRejected`, and other errors are logged and retried on the next look. This mirrors `refreshWebPublish`.
- **A queued redeploy:** if the reloaded row is no longer `deploying` and `redeployQueued` is true, it loads the project and calls `deployServer(project, project.userId, "retry")`.
- It returns `summarizeServerDeploy(reloaded, t)`.

**Wiring the publishes:**
- **`web.ts` `sendToExpo`:**
  1. After `ensureWebDomain`, call `saveServerOrigin`.
  2. Load the files with `includeServer: true`, then `previous = loadSnapshot(project.id)`.
  3. If `hasServerRoutes(files) || previous?.envNames.length`, set `envNames = syncServerEnvironment(...)`. Otherwise `envNames = []`.
  4. Start the run with `webWorkflow(hasServerRoutes(files))`.
  5. Call `saveSnapshot(project.id, sentFiles, { easRunId, reason: "publish", envNames })`, where `sentFiles` are the files after `withProjectId`.
- **`builds.ts` `sendToExpo`:** after `ensureIdentity`, call `await deployServer(project, build.userId, "publish")`, then load the files for the build. Its errors fail the build start the way the others do. Widen `friendlyStartError`'s fallback to `"buildStartFailed" | "publishStartFailed" | "serverDeployFailed"`.

- [ ] **Step 1: Write the failing tests**

Use `vi.mock` for `@/lib/publish/expo`, `@/lib/publish/snapshots`, `@/lib/publish/builds` (`loadExpoConnection`, plus the real `withProjectId` and `friendlyStartError` via `vi.importActual`), `@/lib/project-access`, `@/lib/sandbox/bundle`, `@/lib/services/store`, `@/lib/publish/tarball` (which records the files it's given) and `@/lib/cloudhike/crypto` (`unseal`, which returns its input). Fixtures:
- `snapshot` has `hasServerRoutes: true`, `status: "deployed"`, `reason: "publish"`, `envNames: ["OLD_KEY"]`, `easRunId: "run-old"` and the published files from the Task 3 Review Focus 1 test.
- `loadProjectEnvironment` returns `[{ name: "OPENAI_API_KEY", value: "sk-x", kind: "secret" }]`.

Tests:
- **Review Focus 1:** `"redeploys the published files, not the current project"`. `deployServer(project, 7, "credentials")`:
  - never calls `loadProjectExport`;
  - gives `projectTarball` the snapshot files with only `server/agents/a.instructions.ts` swapped in;
  - calls `saveSnapshot` with those same files and `reason: "credentials"`.
- `"syncs keys before starting the run"`:
  - `syncAppEnvironment` is called with `[{ name: "OPENAI_API_KEY", value: "sk-x", visibility: "sensitive" }]` and `["OLD_KEY"]`, before `startWorkflowRun` (compare `mock.invocationCallOrder`).
  - `startWorkflowRun`'s `workflow` equals `webWorkflow(true)`.
- `"skips projects never published with server functions"`: `loadSnapshot` gives null, which returns `"skipped"`, and no expo mock is called.
- **Review Focus 4:** `"queues behind a running publish"`: `status: "deploying", reason: "publish"` with reason `"agent"` returns `"queued"`. `queueRedeploy` is called, and `startWorkflowRun` and `cancelWorkflowRun` aren't.
- **Review Focus 4:** `"cancels an older redeploy first"`: `status: "deploying", reason: "credentials"` makes `cancelWorkflowRun("t", "run-old")` happen before `startWorkflowRun`.
- **Review Focus 5:** `"records a failure when Expo is disconnected"`: `loadExpoConnection` gives null with reason `"credentials"`. It resolves to `"failed"`, and `failServerDeploy` is called with `applicationFailure("publishExpoDisconnected")`.
- **Review Focus 5:** `"records a failure when the env sync is refused"`: `syncAppEnvironment` rejects with `ExpoError("expoEnvFailed")`. It resolves to `"failed"`, the stored failure's key is `"expoEnvFailed"`, and `startWorkflowRun` isn't called.
- `"publish skips an unchanged server"`: `current` files whose `serverFilesHash` equals `snapshot.serverHash` return `"skipped"`.
- `"publish deploys a changed server with the current files"`: the files are the current export, with `app.json` carrying `extra.eas.projectId`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/publish/server-deploy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `server-deploy.ts`**, then wire `web.ts` and `builds.ts` as described above.

- [ ] **Step 4: Run the tests, the full suite, and the typecheck**

Run: the same file, then `npm test`, then `npx tsc --noEmit`
Expected: PASS, PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/publish tests/publish/server-deploy.test.ts
git commit -m "feat(publish): deploy server functions with the owner's keys on publish, and redeploy the last snapshot"
```

---

### Task 7: Background redeploys when credentials or agents change

**Files:**
- Create: `lib/publish/server-hooks.ts`
- Modify:
  - `lib/services/store.ts`: `saveServiceValues`, `saveRefreshToken`, `removeServiceValues`, `removeService`, `registerService` (when it deletes dropped fields), and phase 3's server key rotation.
  - Phase 4's `onAgentChanged`, wherever phase 4 put it.
- Test: `tests/publish/server-hooks.test.ts`

**Interfaces:**
- Consumes: `deployServer` (Task 6), loaded with a dynamic `import()` inside the callback, because `store.ts` → hooks → `server-deploy` → `store.ts` would otherwise be a cycle.
- Produces:
  - `scheduleServerRedeploy(projectId: string, reason: "credentials" | "agent"): void`
  - `onCredentialsChanged(projectId: string): void`, which calls `scheduleServerRedeploy(projectId, "credentials")`. If phase 3 already added a credentials-changed hook for reloading the sandbox, call `scheduleServerRedeploy` from that hook instead, keep its name, and re-export it as `onCredentialsChanged`.
  - `onAgentChanged(projectId)` (phase 4) also calls `scheduleServerRedeploy(projectId, "agent")`.

**What `scheduleServerRedeploy` does:**
1. Build `run = async () => { … }`. It loads the project by id. If it's missing, it returns. Otherwise it awaits `deployServer(project, project.userId, reason)`. Everything is inside `try`/`catch` that logs `console.error(\`Updating the server of project ${projectId} failed\`, cause)` and never rethrows.
2. Call `after(run)` from `next/server`. If `after` throws (outside a request, for example in a job worker), call `void run()`.
3. It never awaits and never throws to the caller, so a key save can't fail because of publishing.

- [ ] **Step 1: Write the failing tests**

Mock `next/server` (`after`, which records its callback), `@/lib/publish/server-deploy` (`deployServer`), and the project lookup in `@/db`.
- `"runs the redeploy after the response"`: `scheduleServerRedeploy("p1", "credentials")` calls `after` once. Awaiting the recorded callback calls `deployServer(project, project.userId, "credentials")`.
- `"still runs outside a request"`: `after` throws, and `deployServer` is called anyway (await a flushed microtask).
- **Review Focus 5:** `"never throws to the caller"`: `deployServer` rejects. The recorded callback resolves, `console.error` is called once, and `scheduleServerRedeploy` itself returns `undefined` synchronously.
- `"onCredentialsChanged uses the credentials reason"`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --configLoader runner tests/publish/server-hooks.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the hooks**, and call `onCredentialsChanged(projectId)` at the end of each store function listed under Files, after its writes. Call `scheduleServerRedeploy(projectId, "agent")` from `onAgentChanged`.

- [ ] **Step 4: Run the tests, the full suite, and the typecheck**

Run: the same file, then `npm test`, then `npx tsc --noEmit`
Expected: PASS, PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/publish/server-hooks.ts lib/services/store.ts lib tests/publish/server-hooks.test.ts
git commit -m "feat(publish): redeploy server functions in the background when keys or agent instructions change"
```

---

### Task 8: The server status line in the publish dialog, and the retry route

**Files:**
- Create: `app/api/projects/[projectId]/publish/server/route.ts`
- Modify:
  - `app/api/projects/[projectId]/publish/web/route.ts`
  - `hooks/use-web-publish.ts`
  - `components/workspace/publish-dialog.tsx`
  - `messages/en.json`, `messages/ar.json` (`publish.server`)

**Interfaces:**
- Consumes: `getServerDeploy` and `deployServer` (Task 6), and `ServerDeploySummary` (Task 3).
- Produces:
  - `GET` and `POST /publish/web` return `{ web, server: ServerDeploySummary | null }`.
  - `POST /publish/server` is owner-only, with the same `ownedProject` as `publish/web/route.ts:20-27`. It runs `deployServer(project, user.id, "retry")` and returns `{ server }`. It maps errors the same way as `publish/web` POST (`PublishBlockedError`, `ExportUnavailableError`, `ExpoError`, with a 500 `serverDeployFailed` fallback) and sets `export const maxDuration = 300`.
  - `useWebPublish` also returns `server: ServerDeploySummary | null` and `retryServer(): Promise<void>`. It keeps polling while `web` is active **or** `server?.status === "updating"`.
- **The dialog:** above the `Tabs`, when `webPublish.server` isn't null, it renders a `ServerStatusLine` (`role="status"`):
  - a dot (emerald for up to date, amber with a spinner for updating, destructive for failed) and the status text;
  - when failed, an `ErrorDetails` with `server.error` and an outline "Try again" button that calls `retryServer`.
  - In the stores tab, above `ExportForm`, a muted note appears when `server` isn't null.

**The strings (en):**
- `publish.server.upToDate`: "Server functions: up to date"
- `publish.server.updating`: "Server functions: updating…"
- `publish.server.failed`: "Server functions: failed"
- `publish.server.errorSummary`: "Why the update failed"
- `publish.server.retry`: "Try again"
- `publish.server.nativeNote`: "If your server functions changed, publishing the app also updates them and your website."

- [ ] **Step 1: Implement** the two routes, the hook, the dialog line, and the en and ar strings, with the Arabic written properly.

- [ ] **Step 2: Verify**

Run: `npm test` (i18n parity, no literal text, logical classes), then `npx tsc --noEmit`, then `npm run lint`
Expected: all pass.

- [ ] **Step 3: End-to-end check** with `APP_INTEGRATIONS=1 npm run dev`, a real Expo token, and a project with an OpenAI server route and a connected key:
  - (a) Publish the website. The line shows updating, then up to date. Posting to `https://<domain>.expo.app/api/...` works, and the Expo dashboard lists `OPENAI_API_KEY` as sensitive in production only.
  - (b) Edit a screen without publishing, then replace the key. The line shows updating, then up to date. The route uses the new key, and the site still shows the old screen (Review Focus 1).
  - (c) Change the key twice within 5 seconds. The final deploy uses the second value (Review Focus 4).
  - (d) Disconnect Expo, then change the key. The save succeeds, and the dialog shows failed with the reconnect reason (Review Focus 5).
  - (e) Build an `.apk`. Its `app.json` (in the EAS build's project archive) has the `origin`, and the installed app's assistant works.
  - (f) Download the ZIP as the owner. It has `app/api/`, `server/`, and a `.env.example` with names only. As a shared viewer, the ZIP has none of those. A GitHub push matches the owner's ZIP.

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/[projectId]/publish hooks/use-web-publish.ts components/workspace/publish-dialog.tsx messages
git commit -m "feat(publish): server functions status line and retry in the publish dialog"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/app-builder-roadmap.md`

- [ ] **Step 1: Write it.** Add a short "Publishing server functions" entry. It covers:
  - that credentials go to the owner's `production` EAS environment as sensitive variables;
  - that the deploy job pulls them with `eas env:pull` (or the Task 1 fallback), and why: the `deploy` job runs `eas deploy` without `--environment`;
  - that `published_snapshots` is what background redeploys send;
  - that a native publish also redeploys the server, and so the website, when server files changed.

- [ ] **Step 2: Commit**

```bash
git add docs/app-builder-roadmap.md
git commit -m "docs: publishing server functions to EAS Hosting"
```
