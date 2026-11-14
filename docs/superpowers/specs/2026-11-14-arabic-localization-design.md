# Arabic interface and multi-language apps

## Intent

AppxPrompt should work fully for Arabic speakers, both as visitors and as builders, and the apps it builds should be able to speak several languages:

1. **AppxPrompt in Arabic.** Every piece of interface text (landing page, templates, FAQ, docs, pricing, billing, sign-in, the workspace and all its dialogs, toasts, errors, and progress labels) exists in English and Arabic. A small toggle switches between them, and Arabic flips the interface to right-to-left.
2. **Chat in Arabic.** Someone who writes to the agent in Arabic gets Arabic replies, Arabic interview questions, and an Arabic plan.
3. **Multi-language apps.** Before planning, the agent asks which languages the app should support (for example Arabic, English, and German). The app gets one locale file per language (`locales/ar.json`, `locales/en.json`, `locales/de.json`), its screens never contain literal text, and the app's users can switch language inside the app. Arabic (and any RTL language) flips the app to right-to-left. Adding a language later just adds a file. No screen is rebuilt.

Why: the owner wants Arabic-speaking users to be able to evaluate the product and use it day to day, and wants generated apps to serve multilingual audiences in a way that scales to more languages over time.

This is two subsystems, built in this order, each with its own implementation plan:

- **A. AppxPrompt's own interface** (sections "Locale selection" through "Toggle").
- **B. The agent and generated apps** (sections "The agent" and "Generated apps").

## Goals

- All hardcoded AppxPrompt interface text lives in `messages/en.json` and `messages/ar.json`, titles and subtitles included.
- A small `EN | ع` toggle in the site header and the workspace header. The choice persists per browser.
- The Arabic interface renders right-to-left with the Tajawal font. English keeps Geist.
- The agent chats in the language of the person's latest message.
- The interview always settles which languages the app supports, unless the person already said so.
- Generated apps with languages keep every user-visible string in `locales/<code>.json`. Screens use keys, and the app switches language and direction at runtime, everywhere the app runs: workspace preview, home-page cards, Expo Go via Snack, ZIP and GitHub export, and published builds and websites.
- The workspace gets a language switcher next to the theme switcher, which previews the app in each of its languages with nothing rebuilt.
- Adding or removing an app language, or changing which one is first, rebuilds no screen.

## Non-goals

- Separate addresses per language for AppxPrompt (no `/ar/...` routes). The owner chose this explicitly. SEO for Arabic pages isn't a goal.
- AppxPrompt's own interface in languages other than English and Arabic.
- Translating sample data. An app's sample records (`data/seed.ts`) are in its first language only, because in a real app that content comes from its users. *(Designer's call.)*
- Converting existing projects. Apps built before this keep their literal text and work exactly as today. They gain languages only if someone asks for them, which rebuilds their screens as a normal round of changes.
- A per-account language setting in the database. The cookie is enough.

## Anti-goals (a failure even if it technically works)

- English flashing before Arabic on load, or a layout jump when the direction is applied.
- A half-flipped interface: Arabic text with left-aligned spacing, chevrons pointing the wrong way, popovers anchored to the wrong side.
- A generated app in which some text doesn't change when its language changes, or whose layout stays left-to-right in Arabic.
- A locale file missing a key that another one has, so an app shows a raw key like `home.title`.
- Breaking English: every English string, layout, and agent behavior must be unchanged for English users.
- Breaking existing projects: plans without languages must keep building, previewing, editing, and exporting exactly as today.

## Constraints

- Next.js 16.4 App Router (read `node_modules/next/dist/docs/` before writing Next-specific code, per `AGENTS.md`). React 19.2, Tailwind CSS 4, shadcn/ui on Base UI. Node 24.
- Server components exist (`app/page.tsx`, `app/pricing/page.tsx`, `app/docs/page.tsx`, `components/home/faq-section.tsx`) and should stay server components.
- Builds run in CloudHike Jobs, outside the browser's request, so text produced there can't read the browser's cookie.
- Generated apps run in three places: `react-native-web` in a sandboxed frame (`public/preview-runtime/frame.html`, `preview-runtime/`), Expo Go via Snack on SDK 54 (`lib/generated-app/snack-project.ts`), and exports (`lib/generated-app/export-project.ts`). Each must support the app's languages and direction.
- Screen, theme, and component ids are ASCII (`slugify` in `lib/agent/changes.ts` keeps only `[a-z0-9]`).
- There's no test runner yet. Add Vitest for pure logic.

## Approaches considered

**For AppxPrompt's interface:**

1. **next-intl without i18n routing (chosen by the owner).** `en.json`/`ar.json`, locale in a cookie read on the server, one API for server components, client components, and route handlers. ICU messages handle Arabic's six plural forms and number formatting, and keys are type-checked.
2. **An in-house helper.** Rejected: Arabic plurals and formatting would be hand-rolled.
3. **Client-only switching.** Rejected: English flashes on load, and server pages couldn't be translated.

**For generated apps:**

1. **Locale files plus keys, like theme tokens (chosen by the owner).** Screens call `t("key")`. Each language is a JSON file, and switching language or adding one rebuilds nothing. This mirrors how themes already work (screens only use tokens from `@/theme`, `validate-screen.ts` rejects literal colors).
2. **A copy of each screen per language.** Rejected: cost multiplies with languages, and copies drift apart.
3. **Inline conditionals (`isArabic ? … : …`).** Rejected: breaks at a third language and can't be extended.

## Design: A. AppxPrompt's interface

### Locale selection

- Locales `en` (default) and `ar`, in a cookie set by the toggle and kept for a year. With no cookie, `Accept-Language` decides (Arabic if preferred, otherwise English).
- The toggle sets the cookie and refreshes the route, so server components re-render in the new language. The URL never changes.

### Root layout

- `<html lang dir>` set on the server from the locale, so there's no flash.
- Geist (Latin) and Tajawal (Arabic, weights 400, 500, 700) from `next/font/google`. Arabic uses Tajawal first with Geist as the fallback for Latin text.
- Base UI's `DirectionProvider` (`components/ui/direction.tsx`) wraps the app with the current direction.
- Root and page metadata (titles, descriptions) come from the messages files, via `generateMetadata`.

### Messages files

- `messages/en.json` and `messages/ar.json` with identical keys, grouped by area (`header`, `home`, `templates`, `faq`, `docs`, `pricing`, `billing`, `auth`, `workspace.*`, `errors`, `status`, `agentMessages`, …).
- Everything written inline moves there: page copy, every dialog, labels, `aria-label`s, placeholders, toasts, and the data in `lib/home-data.ts` (templates and quick prompts), the FAQ, the docs, pricing questions, plan names and features, and platform labels.
- Values from code (credits, limits) stay in code and are passed as message arguments. Counts use ICU plurals. Links and emphasis inside sentences use next-intl rich text.
- Modern Standard Arabic, to be reviewed by a native speaker before launch. Product and technical names (AppxPrompt, Expo, Expo Go, GitHub, CloudHike, ZIP, .apk/.aab/.ipa, iOS, Android) stay in Latin script. Western digits (0-9) in both languages. *(Designer's call.)*
- In Arabic, templates fill the composer with Arabic prompts.

### Right-to-left interface

- Physical direction classes become logical across `app/` and `components/` (including `components/ui/`): `ml/mr` → `ms/me`, `pl/pr` → `ps/pe`, `left/right` → `start/end`, `text-left/right` → `text-start/end`, `rounded-l/r` → `rounded-s/e`, `border-l/r` → `border-s/e`, and `space-x`/`divide-x` where it matters. Purely visual centering transforms stay.
- Horizontal arrows and chevrons flip in RTL. Vertical and non-directional icons stay.
- Text people type, and AI text, gets `dir="auto"`: the composer, chat input, chat messages, project names, and plan card content. Code views and file paths stay LTR.
- The device frame around the preview doesn't flip. What's inside follows the app's current language, not the interface's.

### Server-side text

- API errors shown to people come from the messages files, in the request's locale (the cookie).
- Build progress `status` events carry a message key and values (for example `{ key: "status.designingScreen", values: { name } }`) instead of an English sentence, and the browser translates them. Old saved events with a plain `label` still display.
- Fixed chat messages the server writes go under `agentMessages` and are saved as plain text in the conversation's language: the "Looks good, build it!" confirmation and "On it!" reply in the agent route; "X is ready!", partial-failure, refund, and backend notes and `changesSummary` in `lib/agent/builder.ts`; planner fallbacks in `lib/agent/planner.ts`; `FAILED_MESSAGE` and "Couldn't start the build" in `lib/agent/builds.ts`. The confirmation the person "sends" with the button uses the interface locale. *(Designer's call.)*
- The plan state stores `chatLanguage` (`"en"` | `"ar"`), updated on each person message: `ar` if it contains Arabic letters, `en` if it has Latin letters and no Arabic, and unchanged otherwise. Before the first message it's the interface locale. Jobs code reads it from there. *(Designer's call.)*
- Strings only the model sees (tool results) stay English.

### Toggle

- A compact segmented control showing `EN` and `ع`, labelled for screen readers ("Language" / "اللغة"). It sits in the site header (desktop) and the mobile menu, and in the workspace header next to the credits badge.
- Switching must not interrupt a running build or a connected Expo Go session.

## Design: B. The agent and generated apps

### The agent

- The agent receives the interface locale as a hint. It replies in the language of the person's latest message. When that's unclear (a number, an emoji, a link), it uses `chatLanguage`.
- **The language question.** The interview always settles the app's languages, and that counts as one of the interview's required answers. If the person already named languages in their prompt or answers, the agent doesn't ask. The question comes with numbered choices suited to the conversation (for an Arabic chat, for example: `1. العربية فقط`, `2. English only`, `3. العربية + English`, `4. لغات أخرى`), and the person can type any languages they like.
- **The plan gains:**
  - `languages`: an ordered list of BCP 47 codes, such as `["ar", "en", "de"]`. The first is the app's **first language**. Between 1 and `MAX_APP_LANGUAGES` (5, in `lib/plans.ts`) on every plan, at no extra cost. *(Designer's call: the owner asked for no separate translation charge.)*
  - `slug`: required, ASCII kebab-case, a transliteration or short English rendering of the app name (for example `wasfati` for "وصفتي"). `projectSlug` in `lib/generated-app/export-project.ts`, the default GitHub repo name in `components/workspace/workspace-layout.tsx`, and the publish slug base in `lib/publish/builds.ts` use it when present and fall back to today's behavior. Existing publishing identities never change.
- `propose_plan` rejects, with fixable tool errors: non-ASCII screen ids or slug, an empty, duplicate, or invalid language list, and more than `MAX_APP_LANGUAGES` languages.
- **Which language plan fields use.** `appName` and screen `name` are in the first language. `tab.label` becomes a locale key, with its text in every language. Descriptive fields shown only in the plan card (`tagline`, `summary`, `targetUsers`, `purpose`, `keyElements`, `design.style`) are in the conversation's language.
- The plan card shows the app's languages.
- **Changing languages later.** `update_app` gains `addLanguages`, `removeLanguages`, and `firstLanguage`. Adding a language writes one new locale file with all of the app's existing keys, in one build step per language, and rebuilds no screen. Removing one deletes its file. A changed first language reorders the list and changes `appName`, and sample data isn't rewritten. No credits are charged for language changes. *(Designer's call.)* The agent never changes languages unless asked.
- Interview replies (`lib/interview-choices.ts`): `numberReply` and `expandNumberReply` also accept Arabic-Indic digits (٠-٩), "و" as "and", "الكل"/"كلها" as "all", and "كلاهما"/"الاثنين" as "both". Choice lines numbered with Arabic-Indic digits are parsed as choices.

### Generated apps

Applies to plans with `languages`. Plans without it build exactly as today.

- **Generated files** (from `generatedAppFiles` in `lib/generated-app/project-files.ts`, like the theme files):
  - `locales/<code>.json`, one per language, each a flat or nested map of keys to strings with identical keys.
  - `lib/i18n.ts`, a fixed file exporting:
    - `t(key, values?)`, with `{name}` interpolation
    - `useLanguage()`, returning `{ language, languages, setLanguage, direction }`
    - `LanguageProvider`
  - `app/_layout.tsx` wraps the app in `LanguageProvider` and applies the current direction at the root.
- **Starting language.** The phone's language if the app supports it, otherwise the first language. The choice persists on the device with the same storage the local backend uses. In the web preview, the phone's language is `navigator.language`.
- **Switching inside the app.** Apps with more than one language get a language picker on their settings or profile screen. The agent adds one if the plan has no such screen. Switching re-renders with the new strings and direction without restarting.
- **Direction.** It comes from the current language (`ar`, `he`, `fa`, `ur`, and other RTL languages are RTL). It's applied at runtime with a root-level direction, so it can switch without a reload, everywhere the app runs. In the preview that means the frame document's `dir`/`lang` plus `react-native-web`. On Snack and native, a mechanism verified on SDK 54: a root `View` with `direction`, `I18nManager`, or both. `app.json` sets `expo.extra.supportsRTL: true` when any language is RTL. The push animation in `frame.html` and the shared tab bar follow the direction.
- **Keys.** Each screen's strings live under its id (`home.title`), each component's under its name, and shared words (Save, Cancel, errors) under `common`, written by the foundation step. Tab labels are under `tabs`.
- **Who writes the strings.** The foundation step writes `common` and `tabs` in every language. Each screen and component build returns its code plus its strings in **every** language, in the same call, so there's no separate translation step. A screen's strings replace its whole namespace when it's rebuilt, and removing a screen removes its namespace. Where strings are stored (the plan, a screen column, or project files) is the builder's call, as long as they survive edits, duplication, export, and publishing.
- **Validation** (`lib/agent/validate-screen.ts`, as for colors): in apps with languages, a screen or component is sent back if JSX contains literal user-visible text (outside `t()`) other than numbers, punctuation, or emoji, if it uses a key missing from its returned strings, or if its strings are missing a key in any language. Layout uses start/end styles (`marginStart`, `paddingEnd`, `start`, `end`), not `left`/`right`.
- **Workspace language switcher.** It sits next to the theme switcher and shows the app's languages. Picking one sends it to the preview frames over the preview protocol, the way themes switch, so nothing is rebuilt and nothing reloads. It changes what you see in the workspace, not what the app starts in.
- **Inline editing.** Editing a text element in an app with languages edits that key's value in the **currently previewed language's** locale file, not the screen code. *(Designer's call.)*
- **Export and publishing** include `locales/` and `lib/i18n.ts` unchanged, so ZIP, GitHub, Snack, native builds, and websites all switch languages.

## Verification the builder should cover

- Vitest:
  - `messages/en.json` and `messages/ar.json` have identical key sets.
  - `Accept-Language` matching.
  - `chatLanguage` detection.
  - Arabic interview replies.
  - The RTL-language check.
  - Plan validation (ASCII ids and slug, language list rules).
  - Locale-file key parity and literal-text detection in screens.
  - Locale file generation and namespace replacement.
- Type check passes, and a key missing from `messages/en.json` is a type error.
- Every page and dialog checked in both interface languages at desktop and mobile widths.
- Agent: an Arabic prompt yields Arabic interview questions including the language question, then an Arabic plan with ASCII ids and slug. An app planned as `["ar", "en", "de"]` previews in all three from the workspace switcher, switches in-app, and flips to RTL in Arabic. An English prompt behaves exactly as before, apart from the language question.
- A pre-change project still opens, previews, edits, and exports unchanged.
- The exported ZIP of an `["ar", "en"]` app switches language and direction in Expo Go.

## Left to the builder

- Message key names and grouping, the cookie name, and `Accept-Language` matching.
- The status event's exact shape, as long as old events display.
- The RTL mechanism on Snack and native, after verifying on SDK 54.
- Where app strings are stored, within the constraints above.
- Font variable wiring in Tailwind 4.
- Order of work within each subsystem.
