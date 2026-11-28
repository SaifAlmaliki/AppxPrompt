# AppxPrompt: AI Agent Business Canvas and Agent Card

Draft answers for the Create AI Agents Championship submission portal (opens 4 December 2026, closes 4 January 2027). The portal asks these questions, and the pitch deck and videos should tell the same story.

How to read the labels:
- **Built** means it works in the code today.
- **Guess** is an assumption to test. Don't present it as a finding.
- **Estimate** is a calculated number that hasn't been measured yet.
- **[FILL IN]** needs a real story, number or link from you.
- **[MEASURE]** needs a number from your own tests or logs.

---

# Part 1: AI Agent Business Canvas

## 1. Problem (feeds slides 1 and 2)

**What specific problem does your agent solve?**
Small businesses that sell or promote their services on Instagram, Facebook and WhatsApp don't own their sales channel. Orders and bookings arrive as DMs and get tracked by hand. The algorithm decides who sees their posts. They can't easily keep a customer list or message their own customers. Getting their own app means paying an agency a lot of money and waiting months, so most owners never find out whether their customers would use one.

**Who experiences it, and how often?**
Owners of small shops, home businesses, salons, clinics, restaurants, real estate agencies and service businesses with no tech team. They deal with the DM and order problem every day. The "should we have our own app?" decision comes up whenever they want to grow. (Guess)

**What does this problem cost in time or money?**
Guess, to check in interviews:
- An agency or freelancer quote for a simple app: tens of thousands of dirhams and two to three months
- Hours each week answering the same DMs ("price?", "available?", "where are you?")
- Lost orders when a DM is missed
- Platform risk: a blocked or hacked Instagram account can wipe out the whole sales channel overnight

**What evidence confirms the problem exists?**
**[FILL IN]** None collected yet. Target: at least 10 conversations with owners and a 20+ response survey before 4 January. Record who it was (no names), what happened, and when it last happened.

## 2. Market Opportunity (feeds slide 3)

**How large is the addressable market?**
Guess, all sources to check:

| Tier | Customers | Source or assumption | Value a year |
|---|---|---|---|
| TAM | 165,000 | About 550,000 SMEs in the UAE (UAE Ministry of Economy, **to check**) times a guessed 30% who sell mainly through social media | AED 138.6M |
| SAM | 10,000 | Owners we can reach online in English and Arabic through SME programs and seller communities in the UAE | AED 8.4M |
| SOM | 100 | Paying Pro users in the first 12 months | AED 84,000 |

Price used: Pro at $19 a month, about AED 70 a month or AED 840 a year.

**What evidence shows demand for the solution?**
**[FILL IN]** Possible sources: survey results, sign-ups since launch, apps built on the platform, apps made public on the home page, Pro conversions. Use only real numbers from your dashboard.

**What are your TAM, SAM and SOM estimates?**
See the table above. AED 138.6M, AED 8.4M and AED 84K, all Guesses.

**Which market segment will you target first?**
Small business owners in the UAE who already sell or take bookings through Instagram and WhatsApp, in any sector. They already have customers and products, so they get value from their own app quickly.

## 3. Solution (feeds slides 1 and 2)

**What task does the agent complete end to end?**
It turns a plain description of a business into a working mobile app. It interviews the owner, proposes a screen plan, builds the app after they approve it, and hands over something they can try on their phone, publish, and download as their own code.

**Why use an agent instead of an app or chatbot?**
Every business needs a different app, so the steps change each time. The agent decides which questions to ask, which screens and data the business needs, which shared components to build, and how to fix a screen that breaks its rules. A template builder makes the owner fit into a fixed layout. A chatbot gives them code they can't run or publish.

**What triggers it and what result does it deliver?**
- **Trigger:** the owner types an idea on the home page, for example "An app for my abaya shop where customers browse by collection and order in their size."
- **Result:** a working Expo (React Native) app with screens, sample data, five themes, and sign-in. They can tap through it in the browser, open it on their phone with a QR code, publish it as a website or Android and iOS build files, download it as a ZIP, or push it to GitHub.

**What is already working in your prototype?** (Built)
- Interview of at least three questions, one at a time, that continues until the agent is about 95% sure, then a screen plan the owner must confirm. The plan names where the app's content comes from and which outside services it needs
- Outside services and keys (live behind a feature flag): the agent researches a service's official docs, works out the credentials it needs, and opens a "Connect a service" dialog. Keys are encrypted and only the owner sees them
- Server functions for generated apps (built, first production test pending): they run only in an isolated sandbox per project, and each new one is tried once with a sample request and fixed automatically before the owner sees it
- No technical setup steps for owners: when the app needs accounts, saved data, uploads, email or server functions that use app data, the agent opens "Connect Backend" itself, and setup runs on its own once the owner connects
- Owner-only failure details in the Activity tab, and a "Fix it" button that sends the failure to the agent, which explains the cause in plain words and fixes the function
- Screens that depend on a server function call it when they open, and show a "Sample" badge until real data arrives
- Screens built one at a time in background jobs, with live progress
- Live preview in a sandboxed frame, plus a code view
- Editing by chat and by clicking any element
- Five themes per app, switched without rebuilding
- Shared component library
- AI images through ImageKit
- Real backend through CloudHike: database, sign-in and storage in the owner's own account
- QR code to test on a phone in Expo Go
- ZIP export and push to GitHub
- Publishing to the web and Android and iOS build files through the owner's own Expo account
- English and Arabic interface, with right-to-left layout
- Free and Pro plans with credits, through Stripe

## 4. Current Solutions (feeds slides 2 and 8)

**How do users solve this problem today?**
They stay on Instagram, Facebook and WhatsApp, set up a template website, or pay an agency or freelancer to build an app.

**What tools, processes or workarounds exist?**
- Instagram and Facebook shops, and the WhatsApp Business catalog
- Website builders such as Shopify, Wix, Salla and Zid
- Agencies and freelancers
- No-code app builders such as FlutterFlow, Adalo and Bubble
- AI app builders such as Lovable, Bolt and Rork

**Where do these alternatives fall short?**
- Social platforms: the owner doesn't own the audience, the data or the brand experience
- Website builders: a website, not a mobile app, and template layouts
- Agencies: expensive and slow for testing an idea
- No-code builders: owners have to learn the tool first
- Most AI builders target developers and are English only

**What would make users switch?** (Guess)
Seeing a working app for their own business on their own phone in one session, for the price of a monthly subscription, in Arabic or English, with the code and accounts in their own name.

## 5. Target Audience (feeds slide 3)

**Who benefits directly from the agent?**
Small business owners, and their customers, who get a proper place to browse, order and book instead of sending DMs.

**Who uses it, and who pays for it?**
The owner uses it and pays for it. In a small business the owner also makes the purchasing decision, so user, payer and decision maker are the same person.

**Which industries or communities are targeted?**
Any small business that sells or promotes services online: retail, e-commerce, food, beauty, clinics, real estate, fitness and services. Later: developers and agencies that need fast proofs of concept.

**How will you reach your first users?**
Direct outreach to owners we already know, SME programs and communities in the UAE, Instagram seller groups, and short Arabic and English videos showing a real business getting its app. See section 9.

## 6. Ideal Customer Persona (feeds slide 3)

**Describe your ideal user and their daily tasks.**
Guess, a made-up example: Noura, 34, runs a home-based abaya business in Sharjah with about 8,000 Instagram followers. Each day she posts new pieces, answers DMs about prices and sizes, takes orders in WhatsApp, and tracks them in a notebook.

**[FILL IN]** Replace Noura with a real owner you've spoken to.

**What frustrations or constraints do they face?**
She isn't technical and prefers Arabic. Orders get lost in DMs. She worries about her account being blocked. An agency quote for an app was too high to justify before she knew customers would use it.

**How frequently would they use the agent?**
Guess: intensively for the first week (building and changing the app), then a few times a month to add products, screens or offers.

**What proof do you have from real users?**
**[FILL IN]** None yet.

## 7. Key Differentiators (feeds slide 8)

**What makes your solution hard to replace?**
- The owner gets a real native mobile app, not a website, and can publish it to the stores under their own Expo account
- They own the code (ZIP or GitHub) and the backend (their own CloudHike account), so there's no lock-in
- An Arabic interface built for UAE and GCC owners
- The agent interviews and plans before it builds, so a non-technical owner isn't left with a blank editor
- AppxPrompt tests and fixes its own server code, and learns per service: each new server function is tried before handover, and lessons from failures are saved to the service's notes, so the next app using that service starts right
- No technical setup steps for owners: the agent opens the backend connection itself when the app needs it

**What unique data, workflow or capability helps?**
- The plan-then-build workflow, with the owner's approval required before credits are spent
- A rule check on every generated screen, with one automatic rewrite when a screen breaks a rule
- Edits by chat or by clicking an element, where only the affected screens are rebuilt
- Themes and shared components, so one change updates the whole app
- A self-test before handover for server functions, and a one-click "Fix it" in Activity, so the owner doesn't debug server code

**How is it better than existing alternatives?**
Estimate, to confirm with tests: minutes to a first working app instead of weeks with an agency, for a monthly subscription instead of a large one-time fee.

**How will you demonstrate measurable value?**
**[MEASURE]** Time from first prompt to a working app on a phone, for 20 test businesses across sectors. Compare with agency quotes collected in interviews.

## 8. Competitors (feeds slide 8)

**Who are your direct and indirect competitors?**
- **Direct:** AI app builders such as Lovable, Bolt, Rork and FlutterFlow's AI features
- **Indirect:** Shopify, Wix, Salla and Zid; agencies and freelancers; staying on Instagram and WhatsApp

**What are their strengths and limitations?**
Fill this in after you check each competitor's current product and pricing. Starting points (Guess):

| | Strengths | Limitations for our customer |
|---|---|---|
| Lovable, Bolt | Fast, popular, strong for web apps | Mostly web apps, aimed at people comfortable with code |
| Rork | AI mobile app builder | English first, aimed at builders more than shop owners |
| Shopify, Salla, Zid | Payments, inventory, trusted by sellers | Websites and template apps, little custom flow |
| Agencies | Fully custom, done for you | Expensive and slow for a first test |

**How do features, costs and outcomes compare?**
**[FILL IN]** after checking current pricing. Put AppxPrompt's Free plan and $19 Pro plan next to each.

**What is your sustainable competitive edge?**
Focus on non-technical small business owners in the UAE and GCC: Arabic interface, an agent that interviews first, real mobile apps, and the owner keeps the code and the accounts.

## 9. Go-to-Market Plan (feeds slides 10 and 11)

**How will you acquire your first customers?**
Build free apps with 10 owners we know (any sector), film their before and after, and use those as case studies.

**Which channels and partnerships will you use?**
- Direct outreach to owners we know and their referrals
- UAE SME programs and communities, such as Dubai SME, Khalifa Fund and Sharjah SME (**to contact**)
- Instagram and TikTok videos in Arabic and English showing a real business getting its app
- Co-working spaces and business setup consultants that work with new license holders
- Later: agencies that resell AppxPrompt to their small business clients

**What is your 6 to 12 month launch plan?**
- **Months 1 to 2:** 10 pilot owners, interviews, fixes from their feedback
- **Months 3 to 4:** case study videos, first SME community partnership, 30 paying Pro users
- **Months 5 to 8:** Arabic content campaign, referral credits, 60 paying users
- **Months 9 to 12:** agency partner program, 100 paying users (the SOM)

**How will you measure adoption and retention?**
Sign-ups, the share of new projects that reach a built app, apps opened on a phone, apps published, Free to Pro conversion, and Pro users still paying after three months.

## 10. Commercial Model (feeds slide 9)

**Who pays, for what unit and at what price?** (Built)
The business owner pays a subscription:
- **Free:** 2 projects, 5 screens each, 100 one-time credits, web publishing, ZIP and GitHub
- **Pro:** $19 a month (about AED 70), unlimited projects, 10 screens each, 1,000 credits a month, Android and iOS builds

Credits: a new screen is 10, a server function costs credits like a screen, a round of changes is 5, an AI image is 1. Chatting, planning and theme switches are free.

**What does one completed task cost, incl. retries?**
Estimate, to replace with real numbers from your logs. Model: Claude Sonnet 5.5 at about $2 per million input tokens and $10 per million output tokens.
- Interview and plan (about 5 turns): about $0.10 to $0.15
- Foundation (themes and sample data) and components: about $0.10
- Each screen: about $0.08, or about $0.16 if it needs the one automatic rewrite
- **A 4-screen app: about $0.50 to $0.90**, before hosting, jobs and image costs

**[MEASURE]** Log the input and output tokens for 20 real builds and report the average and the worst case.

**How do usage and customer volume affect margin?**
Estimate. A Pro user who spends all 1,000 credits builds about 25 small apps, which could cost $12 to $20 in model usage, close to the $19 price. Most users won't use every credit, but this is the main risk to margin. Ways to manage it: prompt caching (cached input is much cheaper), a smaller model for the interview, and adjusting credit prices once real costs are known. Hosting and database costs grow slowly with users.

**How will you fund or sustain the solution?**
Pro subscriptions, then an agency plan. **[FILL IN]** Self-funded today? Say so, and name any grants or programs you plan to apply for.

## 11. Operational and Agent Model (feeds slides 4 to 6)

**Which models, tools and data does it use?** (Built)
- **Model:** Claude Sonnet 5.5 through Anthropic's OpenAI-compatible API, run with the OpenAI Agents SDK
- **Web research:** Tavily search, plus a safe page reader, so the agent can read an outside service's official docs
- **Server functions:** a server builder agent writes them, and Vercel Sandbox (`@vercel/sandbox`) runs them in isolation
- **App:** Next.js 16, React 19, PostgreSQL with Drizzle
- **Jobs, sign-in and storage:** CloudHike
- **Generated apps:** Expo and React Native, previewed with react-native-web and Expo Snack
- **Images:** ImageKit
- **Publishing:** Expo Application Services
- **Payments:** Stripe
- **Monitoring:** Sentry

**What are the workflow and approval points?**
Interview (until the agent is about 95% sure), then the plan card, which the owner must confirm. If the app needs an outside service, the agent opens a dialog and the owner enters their own keys. After that, every change is a chat request from the owner. Connecting a backend, deploying it, accepting the email policy and publishing are all owner actions. See the Agent Card below.

**How are user data and access protected?** (Built)
- Generated code runs in a sandboxed frame that can't reach the site's cookies or storage
- Expo, GitHub and CloudHike tokens are encrypted on the server and never sent to the browser
- The agent never gets raw access to the owner's CloudHike account, so it can't read their secrets or other projects
- Only the owner can change a project; shared projects are view-only
- Public apps run on sample data only, so visitors can't reach the owner's backend
- Deleting a project removes its rows and uploaded files
- Keys for outside services (API keys, the owner's own OAuth client ID and secret, OAuth refresh tokens) are encrypted in the database, and only the owner sees or changes them. The dialog lists exactly which hosts each key is sent to
- Keys pasted into the chat are removed before they're saved, also removed from error reports, and old chat history got a one-time cleanup
- Server functions (built, first production test pending) run only in an isolated sandbox per project, never on AppxPrompt's own servers. Network access is limited to the connected services' hosts, keys are delivered over stdin only, and two start-up self-checks refuse to run if anything is off
- Only the owner's preview and Expo Go can call server functions, with a short-lived pass. Shared viewers and public visitors never see server code
- Failure details (hosts called, their answers, timeouts, blocked hosts, and the error with any keys scrubbed out) are shown only to the owner in the Activity tab. People using the app see only a generic message
- The web page reader only reads public pages, blocks internal addresses, and treats page text as reference, not instructions

**What tests, failures and retests prove reliability?**
**[MEASURE]** Run 20 standard and hard test prompts across sectors (shop, clinic, salon, restaurant, real estate, Arabic prompt, vague prompt, very large idea). For each, record: built on first try or not, screens that failed the rule check, screens fixed by the automatic rewrite, time to finish, and credits used. Include at least one failure and the fix. The project also has automated tests (`npm test`) for the language files.

## 12. Key Partners and Scale (feeds slide 11)

**Which partners or platforms are essential?**
Anthropic (model), CloudHike (jobs, sign-in, storage and app backends), Expo (preview on phones and publishing), Stripe (payments), ImageKit (images), Vercel (hosting, and the sandbox that runs server functions), Tavily (web search for the agent).

**What dependencies and risks could block growth?**
- Model cost and changes at Anthropic
- Publishing uses Expo's internal GraphQL API, which isn't documented and could change
- Phone preview needs Expo Go for SDK 54
- iOS publishing needs the owner's own Apple developer account
- Background jobs depend on CloudHike Jobs
- Server functions depend on Vercel Sandbox, and the first production test is still pending. Per-user daily sandbox caps and a platform-wide ceiling are planned before opening widely

**How will you handle more users and requests?**
Every build step already runs as its own background job, so builds don't depend on one long server request. Credits limit cost per user. Next: prompt caching and model choice per step to lower cost.

**What resources and milestones come next?**
- Three milestones for the next 6 to 12 months: 10 pilot owners with real apps; 100 paying users; a measured first-try build success rate above a target you set **[FILL IN]**
- Resources: funding for model costs during pilots, an Arabic content creator, and partnerships with SME programs

---

# Part 2: Agent Card

## 1. Defined task
Turn a small business owner's description of their business into a working mobile app they can test on their phone and publish.

## 2. Trigger
The owner types their idea on the AppxPrompt home page (they can attach images, PDFs or text files) and creates a project. The agent starts on its own when the workspace opens.

## 3. Workflow
1. Reads the idea and asks at least three questions, one at a time, and keeps asking until it is about 95% sure: who it's for, what they must be able to do, which parts need their own screen, where the app's main content comes from (for example a live feed from an API, an admin list, or user content), and which outside services power key features. The first plan is refused in code until the agent reports at least 95% confidence with no open decisions, up to a safety cap of ten questions. After that, open items appear as stated assumptions. The owner can still say "just build it"
2. Proposes a screen plan as a card: screens, navigation, design direction, the content source, each outside service, and assumptions. Sample data is labelled as sample
3. Revises the plan from the owner's feedback until they confirm it
4. If the app needs an outside service (an AI model, calendar, payments, social posting), researches the service's official docs, works out the exact credentials and opens a "Connect a service" dialog for the owner (live behind a feature flag)
5. Charges credits for the build, then designs the foundation: five themes and the app's sample data
6. Plans and writes server functions alongside the screens, when the app needs them (built, first production test pending). They follow fixed rules: calls must finish within 30 seconds, slow jobs are started and collected later, errors the user should see are reported plainly, replies are small, and nothing is kept in memory. Each new function is then tried once in the sandbox with a cheap sample request, and fixed automatically, up to two rounds, using the failure details. Functions that send messages or spend money are skipped. This test costs the owner no credits
7. Designs and builds a library of shared components
8. Builds each screen in a background job, streaming the code live
9. Checks each screen against the rules (compiles, has a default export, uses only allowed imports, theme colors, and known data). If a check fails, it rewrites the screen once
10. Shows the running app in the preview. The owner can scan a QR code to open it on their phone
11. Takes change requests by chat or by clicking an element, and rebuilds only the affected screens and components
12. When the app needs accounts, saved data, uploads, email or server functions that use app data, opens the "Connect Backend" step itself and leaves a reminder card in the chat. Once the owner connects, setup runs automatically in their CloudHike account. Helps them publish when they ask
13. If a server function fails later, the owner clicks "Fix it" in the Activity tab. The agent gets the failure with keys scrubbed, explains the cause in plain words, and fixes the function. It also saves the lesson to the service's notes, so the next app using that service starts right

## 4. Tools and integrations
- Claude Sonnet 5.5 through the OpenAI Agents SDK
- Agent tools: `propose_plan`, `confirm_plan`, `update_app`, `set_theme`, `setup_backend`, `request_backend`, `register_service`, `add_service_lesson`
- Tavily web search and a safe page reader, to research outside services (live behind a feature flag)
- A server builder agent that writes server functions, and Vercel Sandbox (`@vercel/sandbox`) to run them (built, first production test pending)
- CloudHike: jobs, sign-in, storage, and app backends
- Expo Snack for phones, Expo Application Services for publishing
- ImageKit for AI images
- GitHub for pushing code
- Stripe for plans and credits

## 5. Data sources
- The owner's prompt, their chat messages, and the names of files they attach
- The current plan, screens, themes, data structure and components of their project
- The owner's plan and credit balance
- Backend status (connected or not)
- Fixed rules and lists of allowed packages and components
- Public web pages, only to research the official docs of an outside service the owner asks for (live behind a feature flag). Page text is treated as reference, not instructions

The agent does not read other users' projects, and it never sees the values of the owner's keys.

## 6. Shape
Six agents:
- **Planner:** talks with the owner, interviews, plans, and handles change requests through its tools
- **Foundation Designer:** creates the themes and sample data
- **Data Designer:** changes the app's data when a new screen needs to store something new
- **Component Designer:** decides the shared component library
- **Component Builder:** writes each shared component
- **Screen Builder:** writes each screen's code

## 7. Human approval points
- Confirming the screen plan before any build or credit charge
- Every change after the first build (the owner's request is the approval)
- Connecting CloudHike, which the owner does themselves (the agent opens the step and leaves a reminder card, but the owner clicks and signs in). The agent never asks for keys or passwords in the chat.
- Connecting an outside service: the owner enters their own keys in the "Connect a service" dialog. They bring and pay for their own accounts, and AppxPrompt provides none
- Deploying the backend, which the agent names and says is billed to the owner's account
- Accepting CloudHike's email policy before email is turned on
- Publishing to the web, Android or iOS, through the owner's own Expo account
- Making an app public, and sharing it with someone by email

## 8. When unsure or it fails
- **Unclear request:** asks one question at a time until it is about 95% sure, or picks sensible choices and lists them as assumptions in the plan (after ten questions, or when the owner says "just build it")
- **Key pasted in the chat:** the key is removed before the message is saved, and the owner is pointed to the dialog
- **Server function sandbox fails a start-up check:** it refuses to run, and calls answer "unavailable"
- **A new server function fails its self-test:** it's fixed automatically, up to two rounds. If it still fails, the Code tab shows "Test failed" (other states: "Tested", "Not tested yet") and the owner can use "Fix it" in Activity
- **A turn is running out of time:** planner turns stop before the platform's 300-second limit and always save a reply, saying what was and wasn't done
- **Several services need keys:** the key dialogs queue, one per service
- **Request it can't build exactly:** builds the closest version that works and says what's different
- **Screen breaks the rules:** rewrites it once automatically. If it still won't run, the screen is marked failed and the unbuilt credits are refunded
- **Out of credits or over a plan limit:** says so plainly and shows the upgrade prompt, without claiming the work happened
- **Build stops or a job fails:** the workspace notices and marks the build failed, and retrying charges only what's still unbuilt
- **Backend setup fails:** explains why in plain words, without showing credentials
- **The model writes a tool call as text instead of calling the tool:** a filter catches it, hides it from the chat, and the planner asks the model again

## 9. Data handling
- Projects, chats and screens are stored in PostgreSQL; attached files in CloudHike Storage
- Expo, GitHub and CloudHike tokens are encrypted on the server and never sent to the browser
- Generated code runs in a sandboxed frame without access to the site's cookies or storage
- Keys for outside services are encrypted in the database and visible only to the owner. Keys pasted in the chat are removed before saving and from error reports
- Server functions run only in an isolated sandbox per project, and the owner-only Activity tab lists calls (time, function, result, service, duration) and, for failures, the hosts called, their answers and the error with keys scrubbed. Request bodies, headers and queries aren't stored
- Lessons saved to a service's notes never contain key values
- An app's own data lives in the owner's CloudHike database, not in AppxPrompt's
- Public apps show sample data only
- Deleting a project removes its rows and uploaded files
- Errors are monitored with Sentry
- **[FILL IN]** Data retention period, where the database is hosted, and how a user can ask for their account to be deleted

## 10. Cost per task
Estimate for a 4-screen app, to replace with measured numbers:
- Interview and plan: about $0.10 to $0.15
- Foundation and components: about $0.10
- Four screens: about $0.32, or up to $0.64 if every screen needs the rewrite
- AI images, jobs and hosting: **[MEASURE]**
- **Total: about $0.50 to $0.90 per app**
- Credits charged to the owner: 40 for a 4-screen app

## 11. Built and planned
**Built:**
- Interview until the agent is about 95% sure, plan approval and screen-by-screen builds
- Live preview, code view and QR code for phones
- Editing by chat and by clicking, with themes and shared components
- AI images
- CloudHike backend: database, sign-in and storage
- ZIP export, push to GitHub, web publishing, and Android and iOS build files
- English and Arabic interface
- Free and Pro plans with Stripe
- Outside services and keys: web research of official docs, a "Connect a service" dialog, encrypted keys (live behind a feature flag)
- Server functions in an isolated sandbox, with a fair-use cap, an owner-only Activity tab, and an optional per-user allow-list for staged rollout that isn't in use (built, first production test pending). Each server function costs credits like a screen
- Server functions tested before handover (one sample request, up to two automatic fixes, no credits charged), with a Tested / Test failed / Not tested yet badge in the Code tab
- Failure diagnostics for the owner in the Activity tab, and "Fix it": the agent explains the cause and fixes the function, then saves the lesson to the service's notes for the next app
- A proactive backend: the agent opens Connect Backend when the app needs it, and setup runs after connecting
- Turn time budget: planner turns stop before the platform limit and always save a reply. Server-fed screens call their function on open and show a "Sample" badge until real data arrives

**Planned:**
- AI agents inside generated apps (for example a booking assistant), whose instructions the owner edits in an Agent tab and end users can't see
- Publishing server functions to the owner's own EAS Hosting with their keys, so published apps call their own servers
- Per-user daily sandbox caps and a platform-wide ceiling, before opening widely
- Version history and restoring an earlier version
- Real payments inside generated apps
- Offline support in generated apps
- **[FILL IN]** anything else you plan before the Grand Finale

## 12. Limitations
- Builds at most 10 screens per app (5 on Free), and plans 3 by default unless the owner asks for more
- Generated apps can't take real payments yet
- Published apps don't run server functions yet: they work in the owner's preview and Expo Go, and publishing them is planned. Background jobs and Redis aren't wired to generated apps either
- The owner brings and pays for their own accounts and keys for outside services, and is responsible for their limits and spending. AppxPrompt provides none
- No offline mode in generated apps: writes need a connection
- No version history yet
- Phone preview needs Expo Go for SDK 54
- iOS publishing needs the owner's own Apple developer account
- The owner decides what their app stores. The agent designs the database each project needs, and the data lives in the owner's own CloudHike account, so the owner is responsible for the rules that apply to it.
- The agent only sees the names of attached files, not their contents
- Model output can vary, so the same prompt can produce different apps

## 13. Links
- **Working prototype:** **[FILL IN]** live URL
- **Judge test account:** **[FILL IN]** email and password, with enough credits, active until the end of the Championship
- **Demo video (2 minutes):** **[FILL IN]** unlisted link (draft file: `appxprompt_demo_16x9_vo.mp4`)
- **Test results:** **[FILL IN]** link to your test log
- **Technical documentation:** README, `docs/app-builder-roadmap.md`, `docs/appxprompt-architecture.html`
- **Support:** support@appxprompt.com
