# AppxPrompt

AppxPrompt is an AI agent that turns a written idea into a working Expo (React Native) app. You describe the product, review a screen plan, and the agent writes the screens, a shared theme, sample data, and reusable components. The result runs in the browser, on a phone through Expo Go, and can be exported, pushed to GitHub, or published with EAS.

Generated apps target **Expo SDK 54** (`expo ~54.0.38`). Device preview uses Expo Snack on SDK `54.0.0` and needs Expo Go for that SDK.

## Features

- **Plan, then build.** The agent proposes screens in chat. You revise the plan, then confirm it. Generation starts only after confirmation.
- **Live workspace.** Chat on the left, a canvas of phone screens in the middle, and a preview plus code viewer on the right. On small screens those are three tabs.
- **Chat edits.** After the first build, follow-up messages add, change, rename, or remove screens, update shared components, and switch or add themes. Only the affected files are regenerated.
- **Inline editing.** Click an element on the canvas to change its text, style, or image. The edit shows immediately and is written back into the source.
- **Themes.** Screens use tokens from `@/theme`. Switching themes updates CSS variables in the preview and `activeThemeId` in the exported app.
- **CloudHike backends.** Connect an account and the agent can deploy Postgres, and Auth or Storage when the screens need them. Preview data stays in the browser until a backend is connected.
- **Device preview.** A QR code opens the app in Expo Go. Code changes, including inline edits, stream to connected phones while the browser tab stays open.
- **Export.** Download a complete Expo project as a ZIP, or push it to GitHub. The first push to an empty repository uses the default branch. Later pushes, and any push to a repository that already has commits, go to a new `appxprompt/...` branch.
- **Publish.** Pro can build `.aab`, `.apk`, and `.ipa` through EAS. Any plan can publish a website to EAS Hosting (`https://<name>.expo.app`).
- **Sharing.** Invite an existing account by email for view-only access. Mark a finished app public to list it on the home page, where visitors run it on sample data.
- **Credits and plans.** Free and Pro limits, Stripe checkout, and a credit ledger live in the app. See [Plans and credits](#plans-and-credits).

## Product flow

1. On the home page, write a prompt (up to 5,000 characters) and optionally attach up to 5 reference files (images, PDF, TXT, Markdown, JSON, or CSV, 10 MB each). Choose iOS, Android, or both.
2. Sign in with email, Google, or GitHub. A prompt started while signed out is kept and submitted after sign-in.
3. AppxPrompt creates a project, names it from the prompt, and opens `/workspace/<projectId>`.
4. The planner agent calls `propose_plan`. The plan appears as a card. Chat can revise it. Confirm with the button or by saying to build.
5. Credits are charged, then CloudHike Jobs builds a foundation (theme and sample data), shared components, and each screen.
6. The canvas and sandboxed preview update as screens finish. Status moves from `planning` to `building` to `ready` (or `failed`).
7. Keep chatting to change the app, edit elements on the canvas, connect a backend, export, share, or publish.

Chatting, planning, and theme switches do not spend credits. The agent will not accept a message when fewer than 5 credits remain, because that is the cost of one edit round.

## Architecture

```text
Browser
  Home, pricing, billing, workspace
        |
        |  NDJSON  (plan, tokens, build progress)
        v
Next.js App Router
  Auth, projects, agent, files, billing, publish
        |
        +-- PostgreSQL (Drizzle)     users, projects, screens, builds, ledger
        +-- OpenAI Agents SDK        planner and builders, via AI_BASE_URL
        +-- CloudHike Jobs           one build step per run, chained
        +-- CloudHike Auth           sign-in for AppxPrompt itself
        +-- CloudHike Storage (S3)   prompt attachments
        +-- Stripe                   Pro subscription
        +-- GitHub OAuth             push exported projects
        +-- Expo / EAS               Snack preview, native builds, web hosting
        +-- ImageKit                 optional AI images
        |
        v
Sandboxed preview iframe
  preview-runtime on react-native-web
  no allow-same-origin, so generated code cannot read AppxPrompt cookies
```

### Agents

| Agent | Role |
| --- | --- |
| Planner (`lib/agent/planner.ts`) | Understands the request, proposes and revises the plan, applies chat edits, and can set up a backend. |
| Foundation and data designers | Write the theme package and the collections the screens share. |
| Component designer and builder | Write reusable components. A component only imports components listed before it. |
| Screen builder | Writes one screen at a time. Screens that use literal colors are sent back. |

Planner tools: `propose_plan`, `confirm_plan`, `update_app`, `set_theme`, `setup_backend`.

The planner runs in the agent route. Screen generation runs on CloudHike Jobs, one step per run (foundation, then components, then each screen). Each step queues the next, so a build is not limited to a single function timeout. The worker writes events to `build_events`. The browser reads them as the same NDJSON stream, including after a reconnect.

Jobs delivers at least once. An earlier step is ignored. A retry of the current step takes over `builds.lease`, so the older execution stops at its next write. A failed build refunds the credits for work that did not finish. Picking up an interrupted build is not charged again.

### How generated apps run

- Preview code is bundled by `scripts/build-preview-runtime.mjs` into `public/preview-runtime/runtime.js` and loaded by `public/preview-runtime/frame.html`.
- Screens talk to data through `@/lib/backend`. The local provider keeps data in the workspace `localStorage`. A connected CloudHike backend switches the provider without rewriting screens.
- AppxPrompt proxies the generated app’s data at `/api/apps/<projectId>/...`. Apps do not hold database or storage credentials.
- Each collection becomes an `app_<name>` table (`id`, `owner_id`, timestamps, and a typed column per field). Saved values live in `appxprompt_values`.
- Public home-page previews strip `plan.backend`, so visitors only see sample data in their own browser.

### Build pipeline (local development)

CloudHike Jobs refuses `localhost`. Set `JOBS_PUBLIC_URL` to a public tunnel that reaches the dev server, or builds cannot start.

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Next.js App Router, React, TypeScript |
| UI | Tailwind CSS v4, shadcn/ui, Lucide, Geist |
| Data | PostgreSQL, Drizzle ORM, `postgres` (prepared statements off, for PgBouncer transaction mode) |
| Agent | OpenAI Agents SDK on the Chat Completions API (`AI_BASE_URL` / `AI_API_KEY`) |
| Default model | `claude-sonnet-5-5` (`AI_MODEL`, with an optional `AI_BUILDER_MODEL`) |
| Generated apps | Expo SDK 54, Expo Router, React Native |
| Preview | `react-native-web` inside a sandboxed iframe, bundled with esbuild |
| Auth | CloudHike Auth (email, Google, GitHub) |
| Payments | Stripe Checkout and webhooks |
| Native and web publish | Expo Application Services (EAS) |

## Repository layout

```text
app/                  Routes: home, pricing, billing, workspace, API
components/           Home, workspace, billing, and UI primitives
db/                   Drizzle client and schema
drizzle/              SQL migrations 0000–0011
docs/                 Roadmap and the prompts used to build AppxPrompt
hooks/                Workspace hooks (agent stream, preview, inline edit, Snack)
lib/agent/            Planner, builders, validation, job steps
lib/billing/          Credits and Stripe
lib/cloudhike/        Connect flow, backend deploy, data gateway
lib/generated-app/    Expo project export, Snack adapter, shared files
lib/github/           OAuth and git pushes
lib/publish/          EAS native builds and web deploys
preview-runtime/      Sandboxed runtime source
public/preview-runtime/  frame.html and the built runtime.js
scripts/              Bundles the preview runtime
```

Pages:

| Path | Purpose |
| --- | --- |
| `/` | Prompt, public apps, and your projects |
| `/workspace/[projectId]` | Chat, canvas, preview, export, publish |
| `/pricing` | Free and Pro |
| `/billing` | Usage and subscription |
| `/auth/callback` | Social sign-in return |

## Requirements

- Node.js current enough for Next.js and ES2022
- PostgreSQL, including a URL that works through PgBouncer in transaction mode
- A CloudHike project for AppxPrompt’s own database, auth, storage, and jobs ([cloudhike.dev](https://cloudhike.dev))
- An OpenAI-compatible chat API (`AI_BASE_URL` and `AI_API_KEY`)
- For the features that need them: a CloudHike OAuth app, a GitHub OAuth app, a Stripe price, an Expo account (connected in the UI), and ImageKit

This directory contains the application source, SQL migrations, and docs. It does not include `package.json`, `next.config`, `drizzle.config`, or `.env.example`. Install and start commands below assume those files are restored from a complete checkout of the project.

## Environment variables

Copy them into `.env`. `NEXT_PUBLIC_*` values are visible in the browser. Everything else stays on the server.

### App

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Public origin of this AppxPrompt server, with no trailing path. OAuth callbacks, the jobs worker, and generated apps’ `apiUrl` use it. Local backends must be opened at this exact origin. |
| `DATABASE_URL` | Yes | Postgres connection string for AppxPrompt. |
| `NODE_ENV` | Set by Next.js | `production` marks session cookies `Secure`. |

### AppxPrompt accounts (CloudHike Auth)

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_URL` | Yes | CloudHike Auth base URL. |
| `AUTH_PUBLISHABLE_KEY` | Yes | Sent as `x-api-key` on auth requests. |

### AI

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_BASE_URL` | Yes | OpenAI-compatible base URL, for example `https://api.anthropic.com/v1/`. |
| `AI_API_KEY` | Yes | Key for that endpoint. |
| `AI_MODEL` | No | Planner model. Default `claude-sonnet-5-5`. |
| `AI_BUILDER_MODEL` | No | Screen-writing model. Defaults to `AI_MODEL`. |
| `DEFAULT_SCREEN_COUNT` | No | Screens in a plan before someone asks for more. Default `3`, capped by the Pro screen limit (10). A default Sign In screen can sit on top of this, still inside the plan cap. |

### Storage for prompt attachments

S3-compatible. On CloudHike this is CloudHike Storage.

| Variable | Required | Purpose |
| --- | --- | --- |
| `S3_BUCKET` | Yes, to upload files | Bucket name. |
| `S3_REGION` | Yes, to upload files | Region. |
| `S3_ACCESS_KEY_ID` | Yes, to upload files | Access key. |
| `S3_SECRET_ACCESS_KEY` | Yes, to upload files | Secret key. |
| `S3_ENDPOINT` | No | Custom endpoint. Leave unset for AWS. |

### Background builds (CloudHike Jobs)

| Variable | Required | Purpose |
| --- | --- | --- |
| `JOBS_API_URL` | Yes, to build screens | Jobs API base URL. |
| `JOBS_API_KEY` | Yes, to build screens | API key. Also used to verify the worker’s HMAC signature. |
| `JOBS_PUBLIC_URL` | For local dev | Public URL Jobs can POST to. Required when `NEXT_PUBLIC_APP_URL` is localhost. |
| `JOBS_TIMEOUT_SECONDS` | No | Per-step limit. Default `300` (Free plan maximum). Pro allows up to `3600`. |

### CloudHike connect (generated-app backends)

Register the callback `{NEXT_PUBLIC_APP_URL}/api/cloudhike/callback`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `CLOUDHIKE_CLIENT_ID` | For Connect Backend | OAuth client id. |
| `CLOUDHIKE_CLIENT_SECRET` | For Connect Backend | OAuth client secret. |
| `CLOUDHIKE_ENCRYPTION_KEY` | For Connect Backend, GitHub, and Expo | Encrypts stored tokens and project credentials. |
| `CLOUDHIKE_URL` | No | Defaults to `https://cloudhike.dev`. |

The agent never receives CloudHike MCP tools. Server code calls `create_project` and `deploy_services`. Status and environment variables come from the REST API.

### GitHub

Create an OAuth app with callback `{NEXT_PUBLIC_APP_URL}/api/github/callback` and the `repo` scope.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | For Push to GitHub | OAuth client id. |
| `GITHUB_CLIENT_SECRET` | For Push to GitHub | OAuth client secret. |

### ImageKit

Optional. With it off, generated apps use placeholder images and edit mode only has an image URL field.

| Variable | Required | Purpose |
| --- | --- | --- |
| `IMAGEKIT_ENABLED` | No | Set to `true` to turn image tools on. |
| `IMAGEKIT_PRIVATE_KEY` | With ImageKit | Private API key. |
| `IMAGEKIT_URL_ENDPOINT` | With ImageKit | URL endpoint, without a trailing slash. |

A build step generates at most 8 images. Further images, or a slow generation, fall back to placeholders.

### Stripe

| Variable | Required | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | For paid plans | Secret key. |
| `STRIPE_PRO_PRICE_ID` | For paid plans | Recurring price for Pro. |
| `STRIPE_WEBHOOK_SECRET` | For paid plans | Signs `POST /api/billing/webhook`. |
| `NEXT_PUBLIC_PRO_PRICE_LABEL` | No | Label on the pricing page. Default `$20`. Keep it aligned with the Stripe price. |

Webhook events set the plan from the subscription, which is read again from Stripe because events can arrive out of order. Credits are granted only for a paid `subscription_create` or `subscription_cycle` invoice. Downgrade sets `cancel_at_period_end`. Pro lasts until the paid period ends, then the `deleted` event moves the account to Free.

Expo access tokens are entered in the product UI and stored encrypted. They are not environment variables.

## Local development

1. Create a CloudHike project and fill `.env` from the tables above. At minimum you need the database, auth, AI, storage, and jobs variables before you can sign in and build an app.
2. Install dependencies from the project’s `package.json` (`npm install`, or the package manager that lockfile uses).
3. Apply the SQL in `drizzle/` in filename order (`0000_create_users.sql` through `0011_plans_and_credits.sql`). With Drizzle Kit configured, `drizzle-kit migrate` does the same thing.
4. Point `NEXT_PUBLIC_APP_URL` at the origin you will open in the browser.
5. Expose the dev server with a tunnel and set `JOBS_PUBLIC_URL` to that public URL.
6. Build the preview runtime, then start Next.js. The preview script is intended to run before both `dev` and `build`:

```bash
node scripts/build-preview-runtime.mjs
npx next dev
```

7. Open `NEXT_PUBLIC_APP_URL` (not a different host), so OAuth state cookies match the site.

Production:

```bash
node scripts/build-preview-runtime.mjs
npx next build
npx next start
```

Publish generated apps that call a backend from a deployed AppxPrompt. `apiUrl` is taken from `NEXT_PUBLIC_APP_URL`, so a localhost publish cannot reach that API from a phone or a public site.

### Database

Schema source: `db/schema.ts`. Migrations:

| File | Adds |
| --- | --- |
| `0000_create_users` | Accounts |
| `0001_create_projects` | Projects, messages, attachments |
| `0002_agent_plan_and_screens` | Plans and generated screens |
| `0003_background_builds` | Job builds and streamed events |
| `0004_cloudhike_backends` | Connected backends |
| `0005_chat_sessions` | Archived chat sessions |
| `0006_export_and_sharing` | Shares and GitHub connections |
| `0007_publish_builds` | Expo connection and native builds |
| `0008_publish_eas_run` | EAS workflow run ids |
| `0009_publish_web` | EAS Hosting publishes |
| `0010_public_projects` | Public home-page listing |
| `0011_plans_and_credits` | Free/Pro and the credit ledger |

`DATABASE_URL` is opened with `prepare: false` and a pool of 5 connections.

## Plans and credits

Defined in `lib/plans.ts`. The pricing page and upgrade dialogs read the same values the server enforces.

| | Free | Pro |
| --- | --- | --- |
| Price label | $0 | `NEXT_PUBLIC_PRO_PRICE_LABEL` (default $20) |
| Starting or monthly credits | 100 once, never expire | 1,000 per period |
| Projects | 2 | Unlimited |
| Screens per project | 5 | 10 |
| Native store builds | No | Yes |
| Web publish, ZIP, GitHub | Yes | Yes |

| Action | Credits |
| --- | --- |
| New screen | 10 |
| One round of chat changes | 5 |
| One AI image in edit mode | 1 |
| Chat, planning, theme switch | 0 |

A 4-screen app costs 40 credits. Free’s 100 credits cover about two small apps and four edits. Pro’s 1,000 cover about 25 small apps or 200 edits.

Two balances are stored: `credits` (never expire) and `monthly_credits` (Pro, spent first). Renewal replaces `monthly_credits`. Ending Pro zeroes `monthly_credits` and leaves `credits` in place. Refunds go to `credits`.

`chargeForBuild` deducts credits in one conditional `UPDATE` before the build is saved, so two tabs cannot drive the balance below zero. Every change is a row in `credit_transactions` with a unique `reference`, which makes refunds and renewals idempotent.

Someone who drops to Free keeps existing projects and larger apps and can still edit them. They cannot create more than the Free limits allow. API limit errors include a `code` (`projects`, `screens`, `credits`, or `native-publish`) that opens the upgrade dialog. The agent stream sends the same signal as an `upgrade` event.

## Integrations

### CloudHike backend for a generated app

Connect Backend sends the browser to CloudHike `/connect`. A random `state` in an HttpOnly cookie ties the callback to that browser and project. One access token is stored per person. Each app has its own CloudHike project and a row in `project_backends`.

Deploy runs from the `setup_backend` tool and again at the end of any build of a connected app. It always deploys Postgres, and adds Auth or Storage when screens use `useAuth` or `uploadFile`. Repeating the deploy only adds what is missing.

Email requires the person to accept [CloudHike’s email policy](https://cloudhike.dev/legal/email-policy). Email can only go to the signed-in person’s own address. Jobs and Redis can be deployed, and screens cannot call them until the app has server code.

Records belong to the signed-in user, or to one install when nobody is signed in. Collections are private to their owner unless marked shared. Only the owner can change a record. Removing a field from a plan leaves the database column in place.

### GitHub

One OAuth token per person. A project remembers the repository, last branch, last commit, and the git blob id of each pushed file. Existing history on the default branch is left in place after the first commit to an empty repository.

### Expo

Native publish (`POST /api/projects/[id]/publish`) stores an `app_builds` row, ensures an EAS project, uploads the exported project as a tarball, and starts an EAS workflow. EAS does the compile. GitHub is not part of this path.

There is no build webhook. While the publish dialog is open, status is refreshed from Expo at most every 15 seconds and saved, so closing the tab does not drop the result. A build only advances while someone is looking at it.

Package name, bundle identifier, and slug are chosen once, on the first build, with a suffix from the project id. EAS owns `versionCode` and `buildNumber` (`appVersionSource: remote`). Android keystores are created by Expo once and then reused. iOS builds wait until Apple credentials exist for that bundle id, and the dialog shows the setup steps instead of starting a build.

Web publish uses the same Expo account and identity, exports the app, and deploys it to EAS Hosting with `prod: true`. The hostname stays stable across publishes. `live_url` changes only after a successful deploy, so a failed update leaves the previous site online. Generated apps set `web.output` to `"single"`.

### Sharing and the home page

- Signed-in people see their projects and projects shared with them.
- Visitors see the 24 most recently updated public apps whose status is `ready`.
- Public only affects the home list and the preview route. It does not open the workspace.
- Cards run the app in the same sandboxed frame, loaded when the card is near the viewport.
- Duplicate copies chat, screens, and files, starts private, and has no backend. Delete removes AppxPrompt rows and uploaded files. It does not remove the GitHub repository, the EAS site, or the CloudHike backend.

## HTTP API

All project mutations require the owner. Shared users can open and download. Session cookie: `appxprompt_session` (HttpOnly, 7 days).

| Method and path | Purpose |
| --- | --- |
| `POST /api/auth/sign-up`, `sign-in`, `sign-out` | Email auth |
| `GET /api/auth/session` | Current user |
| `GET /api/auth/social/[provider]` | Start Google or GitHub sign-in |
| `POST /api/auth/social/complete` | Finish social sign-in |
| `GET /api/projects`, `POST /api/projects` | List or create |
| `GET /api/projects/public`, `GET /api/projects/shared` | Home lists |
| `GET/PATCH/DELETE /api/projects/[id]` | One project |
| `POST /api/projects/[id]/agent` | Chat and build stream (NDJSON) |
| `GET/PUT /api/projects/[id]/files` | Generated source, including inline edits |
| `GET /api/projects/[id]/preview` | Public sample-data preview |
| `POST /api/projects/[id]/duplicate` | Copy a project |
| `GET /api/projects/[id]/export` | ZIP download |
| `POST /api/projects/[id]/shares` | Invite or remove a viewer |
| `PUT /api/projects/[id]/theme` | Active theme |
| `POST /api/projects/[id]/images` | Generate or transform an image |
| `POST /api/projects/[id]/backend/connect` | Start CloudHike OAuth |
| `GET/POST /api/projects/[id]/backend` | Backend status and setup |
| `GET /api/cloudhike/callback` | CloudHike OAuth return |
| `POST /api/projects/[id]/github/connect` | Start GitHub OAuth |
| `GET/POST /api/projects/[id]/github` | Repo link and push |
| `GET /api/github/callback`, `GET /api/github/connection`, `GET /api/github/repos` | GitHub account |
| `POST /api/projects/[id]/publish` | Start an EAS native build |
| `POST /api/projects/[id]/publish/web` | Publish to EAS Hosting |
| `GET/POST /api/expo/connection` | Expo account token |
| `GET/POST /api/billing` | Plan and checkout |
| `POST /api/billing/webhook` | Stripe webhooks |
| `POST /api/jobs/build-step` | Jobs worker. Signature required. |
| `/api/apps/[projectId]/...` | Data, auth, and file gateway for a generated app |

## Security notes

- Generated preview code runs in an iframe sandboxed without `allow-same-origin`.
- CloudHike, GitHub, and Expo tokens and backend environment variables are encrypted with `CLOUDHIKE_ENCRYPTION_KEY` and are not returned to the browser.
- Job callbacks are accepted only with a recent HMAC (`t` and `v1`) over the raw body, using `JOBS_API_KEY`.
- Credit charges and refunds are conditional and idempotent.
- OAuth `state` cookies bind CloudHike and GitHub callbacks to the browser and project that started them.
- Do not commit `.env`, access tokens, or Stripe secrets.

## Further reading

- [docs/app-builder-roadmap.md](docs/app-builder-roadmap.md) — how plans, builds, previews, backends, publishing, and billing are implemented.
- [docs/project-prompts.md](docs/project-prompts.md) — the chapter prompts that built AppxPrompt, and the runtime prompts the agents use.

## License

See the repository license if one is included with your checkout. This source snapshot does not ship a `LICENSE` file.
