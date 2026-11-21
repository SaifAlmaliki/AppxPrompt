# AppxPrompt: Pitch deck outline and demo video script

Built from the Session 1 workbook and the Business Canvas and Agent Card drafts in this folder. All three should tell the same story.

Labels: **[FILL IN]** needs your real story, number or link. **[MEASURE]** needs a number from your own tests or logs. On every slide, mark estimates as "Estimate" and guesses as "Guess". Judges check this.

How the pitch video fits together (6 minutes at most, face visible the whole time):
- About 4 minutes of you presenting the deck
- The 2-minute demo video, played on slide 4
- The speaker notes below add up to about 520 spoken words, which is about 4 minutes at a calm pace

Judging weights to keep in mind: real value and problem 20%, technical execution 20%, business viability 20%, trust and safety 15%, innovation 15%, pitch 10%.

---

# Part 1: Pitch deck (cover, 12 slides, closing)

## Cover

**Title:** AppxPrompt
**Tagline:** Your business, your own app. Describe it and get a working one.
**Visual:** logo, and one phone showing a generated app for a small business.

**Say (15 seconds):**
"Hi, I'm [FILL IN name]. This is AppxPrompt, an AI agent that turns a small business owner's description into a working mobile app they own."

## Slide 1: Business concept and AI agent

**On the slide:**
- AppxPrompt: a subscription service that gives small businesses their own mobile app
- The agent interviews the owner, plans the screens, builds the app after they approve, and hands it over to publish
- Example: "An app for my abaya shop where customers browse by collection and order in their size" becomes a working app in one session
- Visual: prompt on the left, finished app on a phone on the right

**Say (25 seconds):**
"Our business sells one thing: a small business's own mobile app, for a monthly subscription. The agent does the work an agency would do. It asks the owner about their business, plans the screens, waits for their approval, then builds the app screen by screen. The owner tries it on their phone and publishes it under their own name."

## Slide 2: Problem and solution

**On the slide:** a before and after.

| Today | With AppxPrompt |
|---|---|
| Sells through Instagram and WhatsApp DMs | Customers browse and order in the owner's own app |
| Orders tracked by hand | Orders and bookings stored in the owner's own database |
| The platform owns the audience | The owner owns the app, the code and the customer data |
| Agency app: high cost, months of waiting (**[FILL IN]** a real quote from interviews) | A working app in one session (**[MEASURE]** time) |

Bonus: one real quote from an owner you interviewed. **[FILL IN]**

**Say (35 seconds):**
"Thousands of small businesses in the UAE run entirely on Instagram and WhatsApp. They don't own their storefront or their customer list, and one blocked account can wipe out their sales. When they ask about their own app, agencies quote [FILL IN] and months of work. That's too much just to test an idea. [FILL IN: one real owner's story, for example: 'Last month, an owner we spoke to was quoted ... and gave up.'] AppxPrompt gives them a working app they can test with real customers, in one session."

## Slide 3: Target customers, persona and market

**On the slide:**
- User, payer and decision maker: the business owner (in a small business they're the same person)
- Persona card: **[FILL IN]** a real owner, or "Noura" clearly marked as an example
- TAM, SAM, SOM circles, all marked Guess:
  - TAM: 165,000 UAE SMEs selling through social media, AED 138.6M a year
  - SAM: 10,000 we can reach in English and Arabic, AED 8.4M
  - SOM: 100 paying users in year one, AED 84K
- Source line: UAE Ministry of Economy SME figure (**to check**), Pro price of AED 840 a year

**Say (30 seconds):**
"Our customer is the owner: they use it, they pay for it, and they decide. Retail, beauty, clinics, food, real estate: if they sell or promote services on social media, they fit. We estimate about 165,000 such businesses in the UAE. We'll start with the 10,000 we can reach through SME communities and seller groups, and aim for 100 paying users in our first year."

## Slide 4: How the agent works (demo)

**On the slide:**
- The embedded 2-minute demo video (Part 2 below)
- A small workflow strip: Idea → 3 questions → Plan card → **Owner approves** → Themes and data → Components → Screens, each checked → Preview on phone → Owner publishes
- Built vs planned, in two short lists (from Agent Card section 11)

**Say (10 seconds, before playing):**
"Here's the agent building a real app from start to finish."

*Play the demo video (2 minutes).*

## Slide 5: Technical architecture and safety

**On the slide:** one diagram.
- **Input:** owner's prompt and chat
- **AI:** Claude Sonnet 5.5, run as six agents with the OpenAI Agents SDK (Planner, Foundation Designer, Data Designer, Component Designer, Component Builder, Screen Builder)
- **Tools:** background jobs (CloudHike), live preview (react-native-web, Expo Snack), images (ImageKit), backend (owner's CloudHike account), publishing (owner's Expo account)
- **Result:** a working Expo app
- **Mark in color:** the human approval points (plan confirmation, backend connection, publishing) and the escalation path (questions, refunds, plain error messages)
- **Data box:** sandboxed preview, encrypted tokens, the agent never sees the owner's keys, public apps run on sample data only

**Say (35 seconds):**
"Six specialized agents share the work, powered by Claude. Nothing gets built until the owner approves the plan. Every screen is checked against rules before it's saved, and rewritten once if it fails. Generated code runs in a sandbox, so it can't touch anyone's account. The app's data lives in the owner's own backend, not ours, and publishing always goes through the owner's own Expo account. The agent never asks for passwords and never publishes on its own."

## Slide 6: Performance metrics

**On the slide:** a results table from your own tests. Every number here must be measured.

| Measure | Result |
|---|---|
| Test prompts run | **[MEASURE]** e.g. 20, across 8 sectors |
| Apps built on the first try | **[MEASURE]** % |
| Screens fixed by the automatic rewrite | **[MEASURE]** % |
| Time from prompt to app on a phone | **[MEASURE]** minutes, vs **[FILL IN]** weeks with an agency |
| Cost per 4-screen app | **[MEASURE]** (Estimate today: $0.50 to $0.90) |
| How often the owner steps in | 100% approve the plan; **[MEASURE]** % ask for changes |

Plus one failure and the fix. **[FILL IN]** for example: "Screens used fixed colors and broke theme switching. We added a color check and an automatic rewrite."

**Say (30 seconds):**
"We tested the agent on [MEASURE] prompts across [MEASURE] sectors. [MEASURE]% built on the first try. One thing that broke: [FILL IN]. We fixed it by [FILL IN], and retested. A 4-screen app takes about [MEASURE] minutes and costs us about [MEASURE] to build."

## Slide 7: User validation

**On the slide:**
- Who you spoke to: **[FILL IN]** e.g. "12 owners: 5 retail, 3 beauty, 2 clinics, 2 food"
- 2 or 3 short real quotes
- Survey results: **[FILL IN]** e.g. "X of Y take most orders through Instagram or WhatsApp"
- Feedback to change: **[FILL IN]** e.g. "Owners wanted Arabic, so we built the Arabic interface"
- Pilot interest: **[FILL IN]** names of businesses (with permission) or the number who agreed to a pilot

**Say (25 seconds):**
"We spoke to [FILL IN] owners. [FILL IN: the most common pain, in their words.] Their feedback changed the product: [FILL IN]. [FILL IN] owners have agreed to pilot it."

Note: the Arabic interface is a real change you've already made. If it came from user feedback, say so. If it didn't, don't claim it did.

## Slide 8: Unique value and competition

**On the slide:** a comparison table (check current competitor pricing before you submit).

| | AppxPrompt | Lovable / Bolt | Shopify / Salla / Zid | Agency |
|---|---|---|---|---|
| Real native mobile app | Yes | Mostly web | Template apps | Yes |
| Built for non-technical owners | Interviews first | Aimed at builders | Yes | Done for you |
| Arabic interface | Yes | **[check]** | Yes | Varies |
| Owner keeps the code | ZIP and GitHub | **[check]** | No | Varies |
| Time to first app | **[MEASURE]** | **[check]** | Days | Months |
| Price | Free, then $19 a month | **[check]** | **[check]** | **[FILL IN]** |

**Say (25 seconds):**
"Owners can stay on Instagram, buy a template store, or pay an agency. AI builders exist, but most are made for people who code, and most make web apps. AppxPrompt interviews the owner first, builds a real mobile app, works in Arabic and English, and the owner keeps the code and the accounts."

## Slide 9: Revenue model

**On the slide:**
- Free: 2 projects, 5 screens, 100 one-time credits
- Pro: $19 a month (AED 70), unlimited projects, 10 screens, 1,000 credits, Android and iOS builds
- Credits: 10 per screen, 5 per round of changes, 1 per AI image
- Cost per app: **[MEASURE]** (carried from slide 6)
- Margin note: heavy users are the main cost risk; prompt caching and model choice per step lower it
- Later: an agency plan

**Say (25 seconds):**
"Owners start free and upgrade to Pro for 19 dollars a month. Credits keep costs tied to usage: a screen is 10 credits and a change is 5. One app costs us about [MEASURE] to build, so a typical Pro user is profitable. Our main risk is very heavy users, and we're managing it with caching and cheaper models for simpler steps."

## Slide 10: Go-to-market plan

**On the slide:** a 12-month timeline.
- Months 1 to 2: 10 pilot owners, free apps, case studies filmed
- Months 3 to 4: first SME community partnership, 30 paying users
- Months 5 to 8: Arabic and English video campaign, referral credits, 60 paying users
- Months 9 to 12: agency partner program, 100 paying users
- Channels: direct outreach, SME programs (Dubai SME, Khalifa Fund, Sharjah SME, **to contact**), Instagram and TikTok videos, co-working spaces, business setup consultants
- Budget: **[FILL IN]**

**Say (25 seconds):**
"We start with 10 owners we know. We build their apps for free and film the before and after. Those stories go to SME communities and to social media, in Arabic and English, where our customers already spend their day. Our target is 100 paying users in 12 months."

## Slide 11: Roadmap and milestones

**On the slide:** 4 to 5 phases, with three measurable milestones.
- **Done:** working agent, publishing, backend, Arabic interface, Free and Pro plans
- **Milestone 1 (by [FILL IN date]):** 10 pilot owners with live apps
- **Milestone 2 (by [FILL IN date]):** first-try build success rate of at least [FILL IN]% on 50 test prompts
- **Milestone 3 (by [FILL IN date]):** 100 paying users
- Next features: version history, payments inside generated apps, server code for apps
- Needs: funding for pilot model costs **[FILL IN amount]**, an Arabic content creator, SME program partnerships

**Say (20 seconds):**
"The agent works today. Next, we prove it with 10 pilot owners, push our first-try success rate above [FILL IN] percent, and reach 100 paying users by the Grand Finale. We're looking for [FILL IN] to get there."

## Slide 12: Founder's story and team

**On the slide:** photo, name, role, 2 or 3 relevant skills per person.
- **[FILL IN]** why you care about this problem, in one or two sentences
- **[FILL IN]** each team member, or how you cover gaps as a solo founder
- Long-term vision: every small business in the region owns its digital storefront

**Say (25 seconds):**
"[FILL IN: your personal reason, for example someone you know who runs their business from Instagram.] I built AppxPrompt myself: the agents, the publishing, the Arabic interface. [FILL IN: team, or 'As a solo founder, I'm looking for a partner for sales and partnerships.'] Our goal is for every small business here to own its app, not rent a page."

## Closing slide: Call to action

**On the slide:**
- AppxPrompt: your business, your own app
- QR code to the live prototype
- Judge test account: **[FILL IN]**
- support@appxprompt.com

**Say (15 seconds):**
"Scan the code and build an app for your own business. It takes one conversation. Thank you."

---

# Part 2: Demo video script (2 minutes)

Rules from the submission guide:
- Screen recording of the real agent, with your face in a corner webcam overlay, explaining as you go
- Label sample data and any sped-up waits on screen (e.g. "Sped up 4x", "Sample data")
- Every number must come from your own tests or dashboard
- About 280 spoken words
- English, 1080p, 16:9

Suggested example business: an abaya shop that sells on Instagram (it matches the persona). Use a fresh project, and record the build once in full so you can speed it up honestly.

You already have `appxprompt_demo_16x9_vo.mp4`. Compare it with this storyboard. It probably needs the webcam overlay and the evidence section.

### 0:00 to 0:22. User and problem

**Screen:** you on camera, then an Instagram-style shop page full of DM order messages (use made-up sample messages, labeled "Sample").
**On-screen number:** **[FILL IN]** e.g. "Agency quote: AED X, 3 months" from a real interview.

**Say (about 50 words):**
"I'm [FILL IN], and this is AppxPrompt. Small businesses here sell through Instagram DMs. They don't own their storefront, and an agency app costs [FILL IN] and months of work. Let's build an app for an abaya shop that sells on Instagram, from just a description."

### 0:22 to 0:46. Agent at work

**Screen:** type the idea on the home page. The agent asks its first question with numbered options; answer with a number. Cut through the other two questions. The plan card appears. Click **Confirm & build**, and highlight the button.
**On-screen text:** "The owner approves before anything is built."

**Say (about 55 words):**
"I describe the shop in one sentence. The agent doesn't guess: it asks three short questions, about who the customers are and what they need to do. Then it proposes a plan, with the screens, navigation and design. Nothing gets built until I approve it. I click Confirm and build."

### 0:46 to 1:16. How it works

**Screen:** the build running (label "Sped up"). Code streams in, screens appear one at a time. Then the finished app in the preview: tap through the catalog and the order screen. Switch a theme. Scan the QR code and show the app on a real phone.
**On-screen text:** "Sample data", "Sped up 4x" (use the real factor).

**Say (about 75 words):**
"Six agents share the work. They create the themes and sample data, then shared components, then each screen. Every screen is checked before it's saved, and if it breaks a rule, the agent rewrites it. Here's the app running. I can switch themes instantly, and scan this code to open it on my phone. One thing it won't do: take real payments yet. And the app's data goes to the owner's own backend, never ours."

### 1:16 to 1:40. Evidence

**Screen:** your test results table, then one before and after of a failure you fixed.
**On-screen numbers:** **[MEASURE]** tests run, first-try success %, average build time, cost per app.

**Say (about 55 words):**
"We tested it on [MEASURE] businesses across [MEASURE] sectors. [MEASURE] percent built on the first try. One thing broke: [FILL IN]. We fixed it by [FILL IN] and retested. A 4-screen app takes about [MEASURE] minutes and costs us about [MEASURE] to build."

### 1:40 to 1:52. Why it wins

**Screen:** a two-column card: "Agency: AED [FILL IN], months" vs "AppxPrompt: $19 a month, one session".
**On-screen text:** "Price: Estimate" if your pricing may change.

**Say (about 30 words):**
"Instead of [FILL IN] and months with an agency, the owner gets a working app in one session, for 19 dollars a month, and keeps the code."

### 1:52 to 2:00. Next and try it

**Screen:** QR code and link to the prototype, plus the judge test account.

**Say (about 20 words):**
"Next: 10 pilot shops. Scan the code to try it yourself."

**Total: about 285 words.**

---

# Checklist before you record

- [ ] Fill in every **[FILL IN]** and **[MEASURE]** on slides 2, 3, 6, 7, 8, 9, 11 and 12, or remove that line
- [ ] Every Guess and Estimate is labeled on the slide
- [ ] Demo video shows your face in a corner and labels sample data and sped-up parts
- [ ] Demo is 2:00 or less, pitch video is 6:00 or less
- [ ] Videos are unlisted and open in a private browser window
- [ ] The judge test account works and has enough credits for several builds
- [ ] The deck, portal answers and videos use the same numbers
