# Session 1 workbook: AppxPrompt

Draft answers for the Create AI Agents Championship, Session 1 ("Design an Agent That Matters").

Anything marked **[FILL IN]** needs a real story or number from you. Anything marked **Guess** is a first guess the workbook expects you to test in later sessions. Do not present a Guess as a finding in the pitch.

---

## Step 0: Opportunity statement (optional)

Our opportunity is the large number of small businesses in the UAE that sell only through Instagram, Facebook and WhatsApp. They don't own their customer list, their storefront or their brand, and a custom app from an agency costs too much just to test an idea.

---

## Step 1: Your idea in one sentence

| For whom? | What does the agent do? | So that they... |
|---|---|---|
| small business owners who sell or promote their services on Instagram, Facebook or WhatsApp | turns a plain description of their business into a working mobile app they own: screens, code and backend | can test their idea and reach customers under their own brand in days, without paying an agency for months |

**Full sentence:**

For small business owners who sell or promote their services on Instagram, Facebook or WhatsApp, our agent turns a plain description of their business into a working mobile app they own, so they can test their idea and reach customers under their own brand in days instead of paying an agency for months.

---

## Step 2: The person, the task, and the last time it happened

### A. The person and the task

**Who has the problem?**
Small business owners with no tech team who sell or promote their services through social media today. It doesn't matter what they offer: abayas, perfume, cakes, property listings, salon bookings, or a clinic's services and appointments.

**What task do they struggle with?**
Getting their first app built: turning "I want customers to browse my products and order from my own app" into something real they can test with customers.

**When did it last happen?**
**[FILL IN]** Don't know yet. This is the first thing to find out. Ask one owner you know: "Tell me about the last time you looked into getting your own app or website. What happened?"

### B. What kind of agent is it?

**It acts, a person approves.**

The agent decides which screens the app needs, plans them, and builds them. The owner approves the screen plan before anything gets built, asks for any changes, and decides when (and if) the app gets published.

### C. Why an agent?

**Why does this need an agent, and not a simpler tool?**
Every business needs a different app. A bakery needs a menu and pickup times. A salon needs stylists and booking slots. A property agent needs listings and viewing requests. A clinic needs its doctors, treatments and appointment requests. A fixed template builder makes the owner fit their business into someone else's layout. A chatbot gives them code they can't run. The agent works out which screens and data this particular business needs, asks when something is unclear, builds the screens one at a time, and fixes them when the owner asks for changes.

**What stays with a person?**
- Approving the screen plan before the agent builds anything
- Every change request after the first build
- Publishing to the App Store, Google Play or the web. This always goes through the owner's own Expo account, never automatically.
- One click to connect their own account. After that, the database, sign-in and file storage are prepared for them. They don't set those up or look after them.
- Prices, product details, and anything shown to real customers
- Anything involving customer data
- What the app stores is the owner's decision. The agent designs the database each project needs, and the data lives in the owner's own CloudHike account, so the owner is responsible for the rules that apply to their data.

---

## Step 3: Five boxes of the AI Agents Business Canvas

### A. Problem (Guess)
Small businesses that sell on Instagram and WhatsApp don't control their sales channel. Orders arrive as DMs and get tracked by hand. The algorithm decides who sees their products. They can't easily collect customer data or message their own customers. Building their own app from an agency is expensive and slow, so most never test whether customers would use one.

### B. Ideal Customer Persona (Guess, a made-up example, not a real person)
Noura, 34, runs a home-based abaya business in Sharjah with about 8,000 Instagram followers. Orders come in through DMs and she tracks them in a notebook and WhatsApp. She isn't technical and prefers Arabic. An agency quoted her tens of thousands of dirhams and about three months for an app, so she put it off.

**[FILL IN]** Replace Noura with a real owner once you've talked to one.

### C. Target Audience (Guess)
- **Users and payers:** small business owners and solo founders in the UAE who want their own app, in any sector (retail, e-commerce, food, beauty, real estate, clinics, services).
- **Who else benefits:** their customers, who get a proper place to browse and order instead of sending DMs.
- **Later (not first):** developers who want to build mobile apps faster, and agencies that need quick proofs of concept for clients.

### D. Current Solutions (Guess)
- Instagram and Facebook shops, and the WhatsApp Business catalog
- Website builders such as Shopify, Wix, Salla and Zid. These give the owner a website, not a mobile app, and the layouts are templates.
- Hiring an agency or freelancer. This takes weeks or months and costs thousands of dirhams.
- No-code app builders such as FlutterFlow, Adalo or Bubble. Owners have to learn the tool first.
- Doing nothing and staying on Instagram

### E. Market Opportunity (Guess)
We think a large share of UAE small businesses sell mainly through social media and would like their own app. We have no interviews yet. See Step 4 for numbers to check.

### F. Solution in one sentence (Explained)
An agent that plans the screens with the owner, builds a working app after they approve, lets them try it on their phone by scanning a QR code, and hands over the full code and a publishing path they control. A chatbot would answer questions and stop. A template app builder would make the owner fit their business into a fixed layout.

**What already works (from the prototype):** chat planning with a plan card to approve, screen-by-screen builds, a live preview, editing by chat and inline, five themes, a QR code for Expo Go, a CloudHike backend, AI images, ZIP export, push to GitHub, web publishing, Android and iOS build files, an English and Arabic interface, and Free and Pro plans through Stripe.

---

## Step 4: How big could this be?

### A. What one customer pays
Pro plan: $19 a month, about **AED 70 a month, or AED 840 a year** (from `lib/plans.ts`).

### B. Count your customers (all Guesses, check every source)

| Tier | Customers | Source or assumption | Value a year |
|---|---|---|---|
| TAM: everyone with the problem | 165,000 | About 550,000 SMEs in the UAE (UAE Ministry of Economy figure, **to check**), times a guessed 30% who sell mainly through social media | AED 138.6M |
| SAM: reachable with this agent, channel and language | 10,000 | Owners we could reach online in English and Arabic through SME programs (Dubai SME, Khalifa Fund, Sharjah SME), Instagram seller communities and e-commerce groups. **Guess.** | AED 8.4M |
| SOM: who we can win first | 100 | Paying Pro users we think we can sign in the first 12 months | AED 84,000 |

### C. Your market at a glance
- TAM: AED 138.6M
- SAM: AED 8.4M
- SOM: AED 84K

---

## Step 5: Check yourself

**A. Who has the problem, and how do they handle it today?**
Small business owners who sell on Instagram, Facebook and WhatsApp. Today they take orders through DMs, use the WhatsApp catalog or a template website, or pay an agency for an app.

**B. Why might an agent be useful for this task?**
Every business needs different screens and data. The agent works out what this business needs, asks about what's missing, builds the screens, and changes them on request. A fixed template can't do that.

**C. What should it do on its own, and what stays with a person?**
On its own, the agent plans screens, writes the code, builds the preview, fixes build errors, and prepares the database, sign-in and file storage. The owner approves the plan, requests changes, connects their account with one click, and decides whether to publish. Publishing always uses the owner's own account.

**D. Who will you speak to first, and when?**
**[FILL IN]** Three owners who sell on Instagram that you already know, in the week of 23 to 30 November 2026. See Step 6.

---

## Step 6: Before next session

### A. Plan three more conversations

| Who, or where to find them | What you need to learn | When |
|---|---|---|
| Three Instagram sellers you already know, or friends of friends | "Tell me about the last time you thought about getting your own app or website. What happened?" | **[FILL IN]** before 30/11/2026 |
| A small business owner from an SME community (Dubai SME, Khalifa Fund, Sharjah SME, an Instagram sellers' group) | "How do orders reach you today, and what goes wrong with them?" | **[FILL IN]** |
| A developer or agency that builds apps for small businesses | "Tell me about the last app you quoted for a small business. How long did it take and what did it cost?" | **[FILL IN]** |

### B. Five questions to ask
1. Tell me about the last time you looked into getting your own app or website. What happened?
2. What was the hardest or most annoying part of it?
3. How do customers find your products and order today? What tools or workarounds do you use?
4. What did it cost you last time: a quote you turned down, time, lost orders?
5. What have you tried to make it easier, and why didn't it stick?

Avoid: "Would you use an AI app builder?" and "Would you pay $19 a month?"

### C. A short survey (send after the first conversations)
1. What does your business offer? (Products, Food, Beauty and services, Property, Clinic or healthcare, Other)
2. Where do most of your orders come from? (Instagram, WhatsApp, Facebook, Own website, Other)
3. How many orders do you get in a typical month? (0 to 20, 21 to 100, 101 to 500, More than 500)
4. Have you ever looked into getting your own app or website? (No, Looked but didn't, Got a quote, Built one)
5. If you got a quote, roughly how much and how long? (Under AED 5K, 5K to 20K, 20K to 50K, More than 50K, Not sure)

Base the answer options on what people tell you in conversations. Twenty or more answers start to show a pattern. Don't collect names or phone numbers unless you need them.

### D. Sentence check
Read the Step 1 sentence to someone outside the Championship. Can they say back who it's for and what it does? **[FILL IN]** their reaction.

### E. Your build route
**Code.** AppxPrompt is a custom Next.js app with the OpenAI Agents SDK and Claude. Note that it's hosted on Vercel, not Cloudflare.

### F. Your starting self-score (what you can show today)

| Area | Score | Why |
|---|---|---|
| Real value and problem | Not yet | No interviews or "last time" story yet |
| Technical execution | Some evidence | Working agent, live preview, builds and publishing |
| Trust, safety and oversight | Started | Plan approval before builds, sandboxed preview, owner-controlled publishing; no written test results or data policy yet |
| Innovation and defensibility | Started | Plan-then-build agent, Arabic interface, owner keeps the code; no competitor comparison written yet |
| Business viability | Started | Free and Pro pricing live in Stripe; no paying customers or cost-per-task numbers yet |
| Pitch and communication | Started | A demo video exists (`appxprompt_demo_16x9_vo.mp4`) |

### G. Your habit: log one user observation
After I **finish a conversation with a business owner**, at **20:00**, I write one line: who it was (no names), what they struggled with, when it last happened.

### H. Organize your notes with AI
After your conversations, paste the workbook's prompt into ChatGPT or Claude with your sentence and notes.

---

## Things to prepare before 4 December (from the submission guide)

- **Test access for judges:** a working link and a test account that stays active until the end of the Championship.
- **Testing evidence:** for example, 20 app descriptions across different sectors, how many built successfully on the first try, what broke and how you fixed it.
- **Cost per task:** model tokens for one plan plus one screen build, from your logs.
- **Disclose limits:** for example, the agent can't take real payments without a backend set up, a free plan allows 5 screens, and builds need the background job service.
