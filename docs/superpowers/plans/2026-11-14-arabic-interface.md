# Arabic Interface (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every piece of AppxPrompt's own interface text comes from `messages/en.json` or `messages/ar.json`, switched by an `EN | ع` toggle, with a correct right-to-left layout and the Tajawal font in Arabic.

**Architecture:** next-intl without i18n routing. The locale lives in a cookie (falling back to `Accept-Language`) and is read on the server in `i18n/request.ts`, which sets `<html lang dir>`. Server components use `getTranslations`, client components use `useTranslations`, and route handlers and server-side `lib` code use a small `serverT()` wrapper that also accepts an explicit locale for code running in CloudHike Jobs. Text produced inside Jobs builds is either a message key the browser translates (status events) or plain text written in the project's stored chat language (fixed chat messages). The spec puts `chatLanguage` "on the project's plan state", but the plan is null until the first proposal. This plan stores it as a nullable `projects.chat_language` column instead, which Jobs code reads in the same way.

**Tech Stack:** Next.js 16.4 App Router, React 19.2, next-intl 4.x, Tailwind CSS 4, Base UI, Drizzle (PostgreSQL), Vitest (new).

**Spec:** `docs/superpowers/specs/2026-11-14-arabic-localization-design.md`, section "Design: A. AppxPrompt's interface". Part B (agent and generated apps) gets its own plan after this one ships.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code (`AGENTS.md`).
- Locales are exactly `en` (default) and `ar`. No locale in any URL.
- Message files: `messages/en.json` and `messages/ar.json`, identical key sets. `en.json` is the type source.
- Every value that comes from code (credits, limits, prices, file counts and sizes) is a message argument, never typed into a translation.
- Counts use ICU plurals. Arabic messages cover `zero`, `one`, `two`, `few`, `many`, and `other` wherever a count is shown.
- Digits are Western (0-9) in both locales.
- Arabic is Modern Standard Arabic. These stay in Latin script: AppxPrompt, Expo, Expo Go, EAS, GitHub, CloudHike, ImageKit, Stripe, ZIP, .apk, .aab, .ipa, iOS, Android, SDK, URL, and code identifiers.
- Fonts: Geist (`--font-geist-sans`) and Tajawal (`--font-tajawal`, `arabic` subset, weights 400, 500, 700). In Arabic, `--font-sans` is Tajawal first, then Geist.
- Logical direction classes only (`ms/me`, `ps/pe`, `start/end`, `text-start/end`, `rounded-s/e`, `border-s/e`) in `app/` and `components/`. Physical `left/right` only for symmetric centering transforms.
- English output must be unchanged: every English string after this plan reads exactly as before, unless a task says otherwise.
- Strings only the model reads (agent instructions, tool results) stay English and inline.
- Commit after each task with a `feat(i18n): …` message.

## Review Focus

- **Arabic counts.** `t("…", { count: 2 })` and `{ count: 11 }` in Arabic must use the dual and the plural forms, not "2 أرصدة". This is tested in Task 1 on the credits-balance message.
- **The numeral system.** next-intl formats numbers with `Intl` for `ar`, which defaults to Arabic-Indic digits (١٢). The spec requires 0-9, which Task 1 tests.
- **Mixed-direction text.** An English project name or chat message in the Arabic interface, and an Arabic one in the English interface, must not render with punctuation on the wrong side. Task 8 covers it with `dir="auto"`, and Task 13's guard checks every input and textarea has it.
- **Server errors inside Jobs.** A failed build reports its error in the project's chat language, not the default English. Task 12 tests this through `serverT(locale)`.
- **Old saved build events.** Events in `build_events` written before this change have `{ type: "status", label: "Designing…" }` and must still display. Task 12 tests the reducer with both shapes.

---

### Task 1: Tooling and i18n core

**Files:**
- Modify: `package.json` (add `next-intl`, devDeps `vitest`; scripts `"test": "vitest run"`)
- Create: `vitest.config.ts` (resolve alias `@` → repo root, environment `node`)
- Create: `i18n/config.ts`, `i18n/request.ts`, `global.d.ts`
- Create: `messages/en.json`, `messages/ar.json`
- Modify: `next.config.ts` (wrap with `createNextIntlPlugin("./i18n/request.ts")`)
- Test: `tests/i18n/config.test.ts`, `tests/i18n/messages.test.ts`

**Interfaces:**
- Produces, in `i18n/config.ts`:
  - `export const LOCALES = ["en", "ar"] as const`
  - `export type Locale = (typeof LOCALES)[number]`
  - `export const DEFAULT_LOCALE: Locale = "en"`
  - `export const LOCALE_COOKIE = "appxprompt-locale"`
  - `export function isLocale(value: unknown): value is Locale`
  - `export function localeDirection(locale: Locale): "ltr" | "rtl"`
  - `export function matchLocale(acceptLanguage: string | null): Locale`
- Produces, in `i18n/request.ts`: the default export from `getRequestConfig`, and `export async function requestLocale(): Promise<Locale>`, which reads the cookie, then `Accept-Language`, through `cookies()`/`headers()`.
- Produces, in `global.d.ts`: `AppConfig` with `Locale` and `Messages: typeof import("./messages/en.json")`.
- Produces a seed message `common.credits`. English: `{count, plural, one {# credit} other {# credits}}`. Arabic: `{count, plural, zero {# رصيد} one {رصيد واحد} two {رصيدان} few {# أرصدة} many {# رصيدًا} other {# رصيد}}`.
- Produces, in `i18n/formats.ts`: `export const formats`, shared by `i18n/request.ts`, the root layout's `NextIntlClientProvider`, and the tests.

- [ ] **Step 1: Write failing tests**

`tests/i18n/config.test.ts`:
- `matchLocale("ar-SA,ar;q=0.9,en;q=0.8")` → `"ar"`.
- `matchLocale("en-US,en;q=0.9,ar;q=0.5")` → `"en"`.
- `matchLocale("de-DE")` → `"en"`.
- `matchLocale(null)` → `"en"`.
- `matchLocale("AR")` → `"ar"`.
- `localeDirection("ar")` → `"rtl"`, and `localeDirection("en")` → `"ltr"`.
- `isLocale("fr")` → `false`.

`tests/i18n/messages.test.ts`:
- `keyPaths(en)` deep-equals `keyPaths(ar)`, where `keyPaths` (a test-local helper) lists dotted leaf paths, sorted.
- Every leaf in both files is a non-empty string.
- With `createTranslator({ locale: "ar", messages: ar, formats })` from `next-intl`, `t("common.credits", { count })` gives:

  | count | expected |
  |---|---|
  | 1 | `"رصيد واحد"` |
  | 2 | `"رصيدان"` |
  | 3 | `"3 أرصدة"` |
  | 11 | `"11 رصيدًا"` |
  | 100 | `"100 رصيد"` |

  No result matches `/[٠-٩]/`.
- With English, `t("common.credits", { count: 1 })` → `"1 credit"`, and `{ count: 1000 }` → `"1,000 credits"`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/i18n`
Expected: FAIL, because the modules and files don't exist.

- [ ] **Step 3: Implement `i18n/config.ts`, `i18n/request.ts`, `global.d.ts`, the two message files with `common.credits`, the `next.config.ts` plugin, and `vitest.config.ts`**

Western digits: pass `formats.number` and any `createTranslator`/`getRequestConfig` option that forces `numberingSystem: "latn"` for `ar`. Export the shared formats from `i18n/formats.ts` so the tests and the request config use the same object. If next-intl can't force it through formats, format with the `ar-u-nu-latn` locale tag inside a custom `onError`-free formatter. Either way, the test is the gate.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run tests/i18n && npx tsc --noEmit`
Expected: PASS, with no type errors.

- [ ] **Step 5: Commit**

---

### Task 2: Root layout, fonts, direction, and metadata

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css` (`@theme inline` font variables, plus a `:root:lang(ar)` override of `--font-sans`)
- Modify: `app/pricing/page.tsx`, `app/docs/page.tsx` (`metadata` → `generateMetadata`)
- Add keys: `meta.home.title|description`, `meta.pricing.*`, `meta.docs.*`

**Interfaces:**
- Consumes: `requestLocale`, `localeDirection` (Task 1).
- Produces: `<html lang={locale} dir={dir}>`. Children are wrapped in `NextIntlClientProvider` (messages and formats passed), then `DirectionProvider` from `components/ui/direction.tsx` with `direction={dir}`, outside the existing `AuthProvider`.

- [ ] **Step 1: Implement the layout and fonts.** Use `Tajawal` from `next/font/google`, with `subsets: ["arabic"]`, `weight: ["400","500","700"]` and `variable: "--font-tajawal"`, alongside Geist. `generateMetadata` reads `getTranslations("meta.home")`, and the same for Pricing and Docs. The English titles stay exactly "AppxPrompt — Build mobile apps with AI", "Pricing — AppxPrompt" and "Docs — AppxPrompt".
- [ ] **Step 2: Verify.** Run `npm run dev`, then use PowerShell with `Invoke-WebRequest` and the header `Cookie: appxprompt-locale=ar`. Expected: `<html lang="ar" dir="rtl"` and an Arabic `<title>`. With no cookie and `Accept-Language: ar`, the response is the same. With neither, it's `lang="en" dir="ltr"`.
- [ ] **Step 3: `npx tsc --noEmit && npx vitest run`, both pass. Commit.**

---

### Task 3: Language toggle

**Files:**
- Create: `components/language-toggle.tsx` (client)
- Modify: `components/home/site-header.tsx` (desktop, before the auth buttons; mobile menu, as a row)
- Modify: `components/workspace/workspace-header.tsx` (before the credits badge)
- Add keys: `languageToggle.label`, `languageToggle.en`, `languageToggle.ar`

**Interfaces:**
- Produces: `export function LanguageToggle({ className }: { className?: string })`. It's a two-segment control showing `EN` and `ع`, with `role="radiogroup"`, `aria-label={t("languageToggle.label")}`, and the active segment highlighted in the existing violet style.
- Selecting a language writes `LOCALE_COOKIE` (`path=/; max-age=31536000; samesite=lax`), then calls `router.refresh()` inside `startTransition`. It never calls `location.reload()`, so builds and Snack sessions keep running.

- [ ] **Step 1: Implement and place the toggle.**
- [ ] **Step 2: Verify in the browser.** Switch on `/`, `/pricing`, `/docs` and a workspace. The page re-renders in the other language and direction, the URL is unchanged, and the scroll position is kept on `/docs`. In the workspace, a running build's progress keeps streaming.
- [ ] **Step 3: Type check, run the tests, and commit.**

---

### Task 4: Logical direction sweep

**Files:**
- Modify: every `.tsx` under `app/` and `components/` (including `components/ui/`) that uses physical horizontal classes.
- Create: `tests/i18n/logical-classes.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test.** `tests/i18n/logical-classes.test.ts` globs `app/**/*.tsx` and `components/**/*.tsx`. Inside `className` strings and `cn(...)` arguments, it fails on any match of `/(?<![\w-])(-?(ml|mr|pl|pr)-|(left|right)-(?!1\/2)|text-(left|right)\b|rounded-(l|r|tl|tr|bl|br)-|border-(l|r)\b|border-(l|r)-|space-x-|divide-x)/`. Allowed exceptions sit in a short `ALLOWED` list of `file:snippet` pairs, each with a reason: symmetric centering such as `left-1/2 -translate-x-1/2`, and `space-x`/`divide-x` where direction doesn't matter. The failure message lists each offending file and line.
- [ ] **Step 2: Run it.** `npx vitest run tests/i18n/logical-classes.test.ts`. It should FAIL and list the current offenders.
- [ ] **Step 3: Convert to logical classes.**
  - `ml→ms`, `mr→me`, `pl→ps`, `pr→pe`, `left→start`, `right→end`, `text-left→text-start`, `text-right→text-end`.
  - `rounded-l→rounded-s`, `rounded-r→rounded-e`, `rounded-tl→rounded-ss`, `rounded-tr→rounded-se`, `rounded-bl→rounded-es`, `rounded-br→rounded-ee`.
  - `border-l→border-s`, `border-r→border-e`.
  - Replace `space-x-*` with `gap-*` on a flex parent where possible.
  - Horizontal arrow and chevron icons (`ArrowRightIcon`, `ArrowLeftIcon`, `ChevronRightIcon`, `ChevronLeftIcon`, `ArrowUpRightIcon`) get `rtl:-scale-x-100`.
- [ ] **Step 4: Run the test and type check.** Both PASS. Then check in the browser, with `ar` set, that the home page, a workspace, and every Base UI popover, dropdown, and sheet open on the mirrored side.
- [ ] **Step 5: Commit.**

---

### Task 5: Literal-text guard and the landing page

**Files:**
- Create: `tests/i18n/no-literal-text.test.ts`
- Modify:
  - `app/page.tsx`
  - `components/home/*.tsx`: site-header, prompt-composer, projects-section, project-card, project-actions, public-app-dialog, templates-section, faq-section, sign-in-dialog, logo
  - `app/auth/callback/page.tsx`
  - `lib/home-data.ts`: keep only `USE_PROMPT_EVENT`, `TEMPLATES` and `QUICK_PROMPTS`. Data entries keep `id` and `emoji`, and their text moves to `templates.<id>.*` and `quickPrompts.<id>.*`.
  - `lib/auth-validation.ts`: return message keys, not sentences.
  - `lib/projects.ts`: `PLATFORM_LABELS` becomes keys `platforms.<id>`.
- Add keys: `home.*`, `header.*`, `composer.*`, `projects.*`, `templates.*`, `quickPrompts.*`, `faq.*`, `auth.*`, `platforms.*`

**Interfaces:**
- Produces, in `tests/i18n/no-literal-text.test.ts`:
  - `const CHECKED: string[]`, a glob list. This task sets it to `["app/page.tsx", "app/auth/**/*.tsx", "components/home/**/*.tsx"]`. Later tasks append to it.
  - The test parses each file with `@babel/parser` (`plugins: ["typescript", "jsx"]`) and fails on:
    - any `JSXText` matching `/\p{L}/u`
    - any string literal or template literal with letters passed to the JSX attributes `placeholder`, `title`, `aria-label`, `alt`, `label`, `description`, or `reason`
  - Allowed: an exported `BRAND_WORDS` list (`AppxPrompt`, `Expo`, `Expo Go`, `GitHub`, `CloudHike`, `ZIP`, `EN`, `ع`, file extensions) when the text is only those words.
  - `lib/auth-validation.ts` export: `validateSignIn(...)` returns `{ field, key: AuthErrorKey } | null`, and the dialog shows `t(\`auth.errors.${key}\`)`.
  - Template `prompt` text in Arabic describes the same app, in Arabic. The English templates and quick prompts stay word-for-word.

- [ ] **Step 1: Write the guard with `CHECKED` as above. Run it and watch it FAIL with the list of literals.**
- [ ] **Step 2: Move every string to messages.** Server components use `getTranslations`, client ones `useTranslations`. Rich text, such as the FAQ links and the "Shift + Enter" kbd, uses `t.rich`. FAQ credit numbers are arguments taken from `lib/plans.ts`.
- [ ] **Step 3: Run the guard, `messages.test.ts` and `tsc`. All PASS.** Check `/` in both languages at 1280 px and 390 px. The English page must be visually identical to before.
- [ ] **Step 4: Commit.**

---

### Task 6: Docs page

**Files:**
- Modify: `app/docs/page.tsx`
- Add keys: `docs.<sectionId>.title` and the body paragraphs `docs.<sectionId>.<n>`. Section ids stay the same, so anchors don't change.
- Test: append `"app/docs/**/*.tsx"` to `CHECKED`.

- [ ] **Step 1: Append to `CHECKED`, run the guard, and watch it FAIL.**
- [ ] **Step 2: Move the content to messages.**
  - `SECTIONS` keeps `id` and becomes a list of keys.
  - Paragraphs with links, `<strong>` or `<code>` use `t.rich`, with tags `link`, `strong`, `code`, `pricing`, `templates`, `expoGo`, `expoToken`.
  - Plan-table numbers come from `lib/plans.ts` as arguments.
  - `Steps` and `Tip` stay as components. The `Tip` icon spacing becomes logical.
- [ ] **Step 3: Run the guard and `tsc`, both PASS.** Check `/docs` in Arabic: the sidebar sits on the right and the step numbers read right-to-left.
- [ ] **Step 4: Commit.**

---

### Task 7: Pricing and billing

**Files:**
- Modify:
  - `app/pricing/page.tsx`, `app/billing/page.tsx`
  - `components/billing/pricing-plans.tsx`, `upgrade-dialog.tsx`, `plan-usage.tsx`, `usage-billing.tsx`
  - `lib/plans.ts`: `PLANS[*].name` stays as an id-like English name for the server, and display names move to `plans.<id>.name`.
- Add keys: `pricing.*`, `billing.*`, `upgrade.<reason>.*`, `plans.*`
- Test: append `"app/pricing/**/*.tsx"`, `"app/billing/**/*.tsx"` and `"components/billing/**/*.tsx"` to `CHECKED`.

- [ ] **Step 1: Append to `CHECKED`, run the guard, and watch it FAIL.**
- [ ] **Step 2: Move strings.** `PRO_PRICE_LABEL` is passed as `{price}`. Dates in billing use `useFormatter().dateTime`, with Western digits through the Task 1 formats.
- [ ] **Step 3: Run the guard and `tsc`, both PASS.** Check `/pricing` and `/billing` in both languages.
- [ ] **Step 4: Commit.**

---

### Task 8: Workspace shell and chat

**Files:**
- Modify:
  - `app/workspace/[projectId]/page.tsx`
  - `components/workspace/workspace-layout.tsx`, `workspace-header.tsx`, `chat-panel.tsx`, `plan-card.tsx`, `build-progress.tsx`, `theme-switcher.tsx`
  - user-visible strings in `hooks/*.ts`: errors set into state, and the "Looks good, build it!" optimistic message in `hooks/use-project-agent.ts`, which uses `t("chat.confirmMessage")`
  - `lib/workspace-data.ts`
- Add keys: `workspace.*`, `chat.*`, `planCard.*`, `buildProgress.*`, `themes.*`
- Test: append `"app/workspace/**/*.tsx"` and these component files to `CHECKED`.

**Interfaces:**
- Produces: `dir="auto"` on:
  - the chat textarea
  - every rendered chat message body (`MessageText`)
  - the project name in the header
  - every plan card text field: appName, tagline, summary, screen name, purpose and key elements
  - the composer textarea from Task 5, added there if not already done
- Theme names from `lib/themes.ts` (`Default`, `Ocean`, `Forest`, `Sunset`, `Midnight`) display through `themes.<id>`. Agent-made themes, which have no key, show their own name.

- [ ] **Step 1: Append to `CHECKED`, then extend the guard so every `<textarea>` and `<input type="text">` without `dir` fails. Run it and watch it FAIL.**
- [ ] **Step 2: Move the strings and add `dir="auto"`.**
- [ ] **Step 3: Run the guard and `tsc`, both PASS.** In the browser with `ar`, open a project with English chat history. The English messages read left-to-right inside the right-to-left layout. Then type Arabic in the English interface and check the same the other way round.
- [ ] **Step 4: Commit.**

---

### Task 9: Canvas, preview, and element editor

**Files:**
- Modify: `components/workspace/canvas-panel.tsx`, `preview-panel.tsx`, `app-frame.tsx`, `expo-qr-popover.tsx`, `element-editor.tsx`
- Add keys: `canvas.*`, `preview.*`, `expoQr.*`, `elementEditor.*`
- Test: append these files to `CHECKED`.

- [ ] **Step 1: Append to `CHECKED`, run the guard, and watch it FAIL.**
- [ ] **Step 2: Move the strings.** The device frame and the iframe's contents keep `dir="ltr"` on the frame wrapper, so the interface direction doesn't flip the phone mockup. The code tab and file paths get `dir="ltr"`.
- [ ] **Step 3: Run the guard and `tsc`, both PASS.** Check in Arabic: edit an element inline, generate an AI image, and scan the QR popover. All the text is Arabic, and the phone's content isn't mirrored.
- [ ] **Step 4: Commit.**

---

### Task 10: Workspace dialogs

**Files:**
- Modify: `components/workspace/publish-dialog.tsx`, `github-dialog.tsx`, `backend-dialog.tsx`, `share-dialog.tsx`, `download-dialog.tsx`
- Add keys: `publish.*`, `github.*`, `backend.*`, `share.*`, `download.*`
- Test: append these files to `CHECKED`. The final `CHECKED` is `["app/**/*.tsx", "components/**/*.tsx"]` minus `components/ui/**`, which is scanned separately with `sr-only` strings only.

- [ ] **Step 1: Set `CHECKED` to the final globs, plus a separate scan of `components/ui/**` for `sr-only` and `aria-label` literals. Run it and watch it FAIL.**
- [ ] **Step 2: Move every remaining string, including `components/ui` strings like "Close", "More", and "Previous"/"Next".**
- [ ] **Step 3: Run the guard and `tsc`, both PASS.** Open each dialog in Arabic: publish (token form, web, native, iOS setup), GitHub, backend, share and download.
- [ ] **Step 4: Commit.**

---

### Task 11: Server-side error text

**Files:**
- Create: `lib/i18n/server.ts`
- Modify:
  - every `app/api/**/route.ts` that returns an `error` string
  - user-facing messages in `lib/`: `lib/auth-route.ts`, `lib/billing/credits.ts` (`PlanLimitError`, `screenLimitMessage`), `lib/billing/stripe.ts`, `lib/github/*.ts`, `lib/publish/*.ts`, `lib/imagekit.ts`, `lib/cloudhike/backend.ts`, `lib/cloudhike/gateway.ts` (only errors that reach AppxPrompt's interface, not the generated app), `lib/project-access.ts`, `lib/storage.ts`, `lib/jobs.ts`
- Add keys: `errors.*`
- Test: `tests/i18n/server.test.ts`

**Interfaces:**
- Produces, in `lib/i18n/server.ts`:
  - `export type Translator<N extends string> = Awaited<ReturnType<typeof getTranslations<N>>>`
  - `export async function serverT(locale?: Locale): Promise<Translator<"errors">>`. It uses `getTranslations({ locale: locale ?? (await requestLocale()), namespace: "errors" })`.
  - `export function translatorFor(locale: Locale): Translator<"errors">`, a synchronous `createTranslator` over the imported message files, for code with no request scope (Jobs) and for tests.
- `PlanLimitError` keeps `reason`, `status`, and `message`. Its constructor takes `(reason, message)`, where callers pass translated text, so `planLimitResponse` is unchanged.
- Leave alone: log messages (`console.*`), errors thrown for programming mistakes, and errors only the model sees.

- [ ] **Step 1: Write the failing test.**
  - `translatorFor("ar")("signInRequired")` is Arabic: it matches `/\p{Script=Arabic}/u` and contains no Latin letters.
  - `translatorFor("en")("signInRequired")` → `"Please sign in to continue."`.
  - `translatorFor("en")("messageTooLong", { max: 5000 })` → `"Keep your message under 5000 characters."`.
- [ ] **Step 2: Run it and watch it FAIL.**
- [ ] **Step 3: Implement `lib/i18n/server.ts` and move every user-facing server string.** Existing English sentences become the `en` values word-for-word.
- [ ] **Step 4: Run the tests and `tsc`, both PASS.** Then call `POST /api/projects` with no session, `Cookie: appxprompt-locale=ar`, and check the error is Arabic.
- [ ] **Step 5: Commit.**

---

### Task 12: Build status keys, chat language, and fixed chat messages

**Files:**
- Modify: `db/schema.ts` (projects: `chatLanguage: text("chat_language").$type<Locale>()`), then run `npm run db:generate` to create `drizzle/0012_*.sql`
- Create: `lib/i18n/chat-language.ts`
- Modify:
  - `lib/agent-protocol.ts`: the status event
  - `hooks/use-project-agent.ts`: the reducer and `activity` type
  - `components/workspace/build-progress.tsx` and `chat-panel.tsx`: render activity
  - `lib/agent/builder.ts`, `lib/cloudhike/backend.ts`: emit keys
  - `lib/agent/builder.ts`, `lib/agent/builds.ts`, `lib/agent/planner.ts`, `app/api/projects/[projectId]/agent/route.ts`, `app/api/projects/route.ts`: fixed messages and chat language
- Add keys: `status.*`, `agentMessages.*`
- Test: `tests/i18n/chat-language.test.ts`, `tests/i18n/status-event.test.ts`

**Interfaces:**
- Produces, in `lib/i18n/chat-language.ts`: `export function detectChatLanguage(text: string, previous: Locale): Locale`. It returns `"ar"` if `text` contains `\p{Script=Arabic}`, `"en"` if it contains Latin letters and no Arabic, and `previous` otherwise.
- `lib/agent-protocol.ts`:
  - `export type StatusKey = keyof (typeof import("@/messages/en.json"))["status"]`
  - the status event becomes `{ type: "status"; label?: string | null; key?: StatusKey; values?: Record<string, string | number> }`
  - an event with neither `label` nor `key` clears the activity
- `hooks/use-project-agent.ts`: `activity: { key: StatusKey; values?: Record<string, string | number> } | string | null`. A string is an old saved label, shown as is.
- `projects.chat_language`:
  - set at creation in `POST /api/projects` with `detectChatLanguage(prompt, await requestLocale())`
  - updated on each `message` action in the agent route, before the run starts
  - read in Jobs code, with `"en"` when null
- Fixed messages are written through `translatorFor(project.chatLanguage ?? "en")` under `agentMessages.*`, with English values word-for-word as today. That covers:
  - the "On it!" confirm reply
  - "ready", partial failure, refund and backend notes, and `changesSummary`
  - planner fallbacks
  - `FAILED_MESSAGE` and "Couldn't start the build"
  - error events emitted in Jobs
- The `confirm` action's user message uses `translatorFor(await requestLocale())("agentMessages.confirm")`, the same text as the optimistic client message.

- [ ] **Step 1: Write the failing tests.**
  - `detectChatLanguage("أريد تطبيق وصفات", "en")` → `"ar"`.
  - `detectChatLanguage("A recipe app", "ar")` → `"en"`.
  - `detectChatLanguage("2", "ar")` → `"ar"`.
  - `detectChatLanguage("👍 https://x.com", "en")` → `"en"`.
  - `detectChatLanguage("make it like Uber لكن للمطاعم", "en")` → `"ar"`.
  - With the reducer exported from `hooks/use-project-agent.ts`:
    - a status event `{ label: "Designing Home…" }` sets activity to `"Designing Home…"`
    - `{ key: "designingScreen", values: { name: "Home" } }` sets `{ key, values }`
    - `{ label: null }` clears it
- [ ] **Step 2: Run them and watch them FAIL.**
- [ ] **Step 3: Implement.** Generate the migration with `npm run db:generate` and check the SQL is a single nullable `ADD COLUMN`.
- [ ] **Step 4: Run the tests and `tsc`, both PASS.** Then check end to end with `JOBS_PUBLIC_URL` tunnelled. Create a project from an Arabic prompt and confirm a plan. The confirm reply, the progress labels in the Arabic interface, and the final "ready" message are Arabic. In the English interface the progress labels are English, while the saved chat messages stay Arabic.
- [ ] **Step 5: Commit, including the migration file.**

---

### Task 13: Final verification

**Files:**
- Modify: `README.md` (one short "Languages" section: where messages live, how to add a key, `npm test`)

- [ ] **Step 1: Run `npx vitest run && npx tsc --noEmit && npm run build`.** Everything passes, and the build reports no warnings from next-intl.
- [ ] **Step 2: Do a manual sweep in both locales at 1280 px and 390 px.**
  - Pages: `/`, `/docs`, `/pricing`, `/billing`, the sign-in dialog, and a workspace with a built app.
  - In that workspace: every dialog, the element editor, the QR popover, and the theme switcher.
  - English must match the current site. Arabic must show no English apart from brand words, and no physical-direction glitches.
- [ ] **Step 3: Update the README and commit.**
