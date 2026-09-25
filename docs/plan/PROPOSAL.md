# Ads Agent — Proposal (v3)

| | |
|---|---|
| **Version** | v3.0 — 2026-09-25 |
| **Replaces** | v2.1 of 2026-09-14 (kept unchanged in `docs/archive/proposal-v2.1.md`) |
| **Owner** | Marcus decides. Claude maintains the text (see the `update-plan` skill). |
| **Companion docs** | `BLUEPRINT.md` = *how* to build it · `CHANGES-v3.md` = what this review changed and why |
| **Status** | Draft for Marcus's review. Items marked **(needs OK)** are Claude's recommendations. They count as decided only after Marcus confirms them. Confirmations are tracked in `docs/memory/QUESTIONS.md`. |

> **How to read this.** §0 is the one-page version. §1 is a glossary that defines every term once; if a word in the plan seems vague, look there. The rest explains *what* we are building and *why*. The blueprint explains *how*, and `docs/memory/NOW.md` says where the build currently stands.

---

## 0. One-page summary

**What it is.** A private assistant that looks after Marcus's Google Ads and Meta ad accounts, one product at a time.
- **Every day** it downloads the numbers, checks the data can be trusted and sends a short digest.
- **Every week** it writes a report, points out wasted money and suggests specific changes.
- **Nothing changes** in an ad account until Marcus approves that exact change.
- **Approved changes** are made by one tightly guarded component, the *gateway*. It re-checks everything, makes the change, confirms it took effect, records it, and can undo it later.

**What it is not.** It is not an autopilot. It never turns spending on by itself and never makes large or repeated budget changes. It never writes advertising claims: Marcus owns all ad content and all spending limits.

**Products.** There are two to start. **SnapPool** is the pilot and has live ad spend now. **Property SG** is on hold. It will be built and tested on recorded sample data so it is ready when spending resumes. Everything product-specific lives in a plug-in called a **pack**. The core system knows nothing about property or SaaS, so adding a product means adding a pack, not rewriting the core.

**How it stays safe (the short version):**
1. **One door.** Only the gateway can change an ad account. It runs as its own process, holds the only write keys and never talks to the AI.
2. **Marcus approves every change**, and each approval is tied to the exact version he saw.
3. **Hard limits in code:** which actions exist at all, how big a change may be, how often, and the product's spending ceilings.
4. **Fresh-state check.** Before changing anything, the gateway confirms the account still looks the way it did when the change was suggested.
5. **Everything is recorded with its undo.** An undo works even if the AI and most of the system are broken.
6. **The AI never supplies the numbers that decisions depend on.** Numbers come from the database. The AI reviews, prioritises and explains.

**Build order.** There are six phases. Each ends with a test on real data before the next one starts:
- 0: read-only reports
- 1: suggestions and approvals (the system changes nothing yet)
- 2: low-risk changes (pauses, blocked search terms, conversion uploads)
- 3: budget changes
- 4: ad-copy variants
- 5: evaluation and hardening

The build is split into 17 milestones, M00–M16.

**What Marcus needs to do first:** answer `docs/memory/QUESTIONS.md` and start the account setup in §16. The Google and Meta setup steps take days of lead time.

---

## 1. Glossary

| Term | Meaning in this project |
|---|---|
| **Product** | A business line that advertises, such as SnapPool. It has its own settings, ad accounts and outcomes. It is identified by a slug: `snappool` or `property-sg`. |
| **Pack** | The code plug-in holding a product's specifics: what counts as a customer outcome, lifecycle phases, what facts exist, evidence thresholds, copy rules and any stricter limits. Pack ids are `saas-snappool` and `property-sg`. The core never imports a pack. |
| **Core** | Everything that is the same for every product: syncing, checks, analysis, proposals, approvals, the gateway and the audit trail. |
| **Platform** | An ad network: Google Ads or Meta (Facebook and Instagram). TikTok may come later. |
| **Ad account** | An account on a platform, such as a Google Ads customer ID or a Meta `act_…` ID. A product can have several. |
| **Ad entity** | Anything inside an ad account that we read or change: a campaign, an ad group (called an *ad set* on Meta), an ad, a keyword or a budget. |
| **Offering** | The thing being advertised: a condo project, or the SnapPool product itself. Its **fact base** lists true facts about it, such as prices, features, district or MRT station. |
| **Cycle** | One run of the routine for one product. A daily cycle does sync → trust check → detectors → digest. A weekly cycle adds analysis → drafting → brief. |
| **Sync** | Downloading account structure plus the last 28 days of numbers into our database. |
| **Trust check** | A set of named pass/warn/fail checks, such as "is conversion tracking firing?". If any check fails, the cycle only produces a diagnostic report. It makes no suggestions. (v2 called this the "trust gate".) |
| **Detector** | A fixed rule that spots a known problem, for example "spent SGD 40 in 14 days with zero signups". It produces *candidate findings*. |
| **Analyst** | The AI step. It reviews the candidates, confirms or dismisses them, ranks them and explains them, and can add findings of known types. It cannot supply numbers. |
| **Finding** | "Something worth your attention" about one ad entity. Its evidence is computed from our database. |
| **Evidence threshold** | The minimum amount of data (impressions, clicks, spend, days) before a finding may become a proposal. Set per pack, so the system does not act on noise. |
| **Proposal** | One concrete, executable change, such as "pause ad set X". It comes with its reason, its expected effect, its exact undo, a fingerprint of the entity's current state and an expiry time. |
| **Approval** | Marcus's decision on one version of a proposal: approve, reject (with a reason) or edit-and-approve. |
| **Operator request** | Anything Marcus asks for from Telegram, the dashboard or the command line: approve, pause, undo, change a setting and so on. Every request becomes a database row, and the worker validates it before acting. |
| **Gateway** | The only component that can change an ad account. It re-checks everything, applies the change, verifies it and records it. |
| **Guard** | A hard limit the gateway enforces, such as the maximum budget change, a cooldown, or the ceilings. Guards are code, not instructions to the AI. |
| **Fingerprint (precondition)** | A hash of the fields a proposal depends on, taken when the proposal is drafted. If the live entity no longer matches, the gateway refuses and marks the proposal *stale*. |
| **Apply / verify** | Apply means the gateway makes an approved change on the platform. Verify means it reads the entity back to confirm the change took effect. |
| **Revision / change log** | Every applied change gets a revision id (`rev_…`), a before-and-after record and a stored undo. |
| **Undo (revert)** | Applying a change's stored undo through the gateway. It needs no AI and works from a cold start. |
| **Drift** | A change made outside this system, in Ads Manager or by the platform itself. Drift is reported and never silently overwritten. |
| **Halt** | Stops the **agent** for a product: no cycles and no agent-suggested changes. The ads keep running, and Marcus's own pauses still work. |
| **Pause** | Stops an **ad entity** on the platform, which stops its spend. |
| **Outcome** | A real business result recorded in the product's own system, such as a SnapPool signup or payment, or a property enquiry. |
| **Outcome stage / tier** | A step in the product's funnel (signup → activated → paid). Each stage has a tier: soft, success or hard. Stages are configured per product. |
| **Primary KPI** | The cost per outcome stage we optimise for, such as cost per signup. |
| **Feedback (conversion upload)** | Sending outcomes back to Google and Meta so their bidding optimises for real results. |
| **Spend ceiling** | Marcus's daily and monthly spending limit for a product. It blocks budget increases and triggers alerts. It is **not** a cap the platforms enforce (see §6.9). |
| **Digest / brief** | The digest is the ~6-line daily Telegram message: numbers only, no AI. The brief is the weekly report: numbers from the database, wording by the AI. |
| **Dashboard** | The web app where Marcus configures products and reviews activity. |
| **Settings** | Per-product configuration that changes without a code change: ceilings, outcome stages, KPI, required ad text, digest mode and so on. |
| **Source copy** | Ad text written by Marcus. The AI only produces *variants* of it. |
| **Micros** | Money stored as whole numbers of millionths, so SGD 1.50 = 1,500,000. Money never uses floating-point numbers. |
| **Fixture** | A recorded API response, scrubbed of secrets and personal data, used in tests. |
| **Replay eval** | Re-running the analyst on saved past inputs to check that a new model or prompt has not made results worse. |
| **Phase / phase gate** | A stage of the rollout, and the real-data test that must pass before the next phase starts. |
| **Milestone (M00–M16)** | A unit of build work defined in the blueprint. A milestone may take several Claude sessions. (v2 called these "sessions" S00–S16; the numbers are unchanged.) |
| **Session** | One Claude Code conversation, in the cloud or on a local machine. Continuity between sessions comes from `docs/memory/` in this repo. |
| **SER9** | Marcus's mini PC, which runs the worker and gateway in Docker. |
| **Worker** | The long-running program that runs cycles, the Telegram bot and the request processor. It holds no write keys. |

---

## 2. Why this exists

Connecting an AI to an ad account is no longer valuable on its own, because the platforms now provide that themselves:
- **Google's official MCP server** (`googleads/google-ads-mcp`) is free and read-only, with 3 tools.
- **Meta's official ads MCP server** (`mcp.facebook.com/ads`) launched in April 2026 and opened to developers in July 2026. It can make changes when granted `ads_management`.

A product built only on "connect an LLM to an ad account" stands on disappearing ground.

What does not become a commodity is **judgement in a specific product's context**:
- what a good Singapore new-launch condo campaign looks like, and what CEA rules require;
- what a real SnapPool customer looks like, compared with a curious click.

That judgement lives in a **pack**. The core stays the same for every product.

The system therefore has two layers:
- **Core** (the same for every product): connectors, state, the analysis loop, guards, approval, audit and evaluation. It knows nothing about property or SaaS.
- **Packs** (one per product, the valuable part): objectives, the definition of an outcome, lifecycle phases, the fact schema, copy checks and stricter limits.

**The rule:** the core never imports a pack, and a pack never talks to an ad platform. If a feature needs to know "this is property", it belongs in the pack. If a pack needs to call Google, the design is wrong.

---

## 3. Goals

### Primary objective

Cut Marcus's manual ad-management work across all his products, while **never** letting an automatic action move money in a way he did not explicitly approve.

The agent is **an analyst with a supervised hand**, not an autonomous media buyer. That framing drives the whole design.

### Concrete goals

| # | Goal | How we'll know it works |
|---|---|---|
| G1 | The weekly account review becomes a generated brief, per product | The brief arrives unattended. Marcus reads it instead of opening Ads Manager. |
| G2 | Waste is surfaced without being asked for: dud keywords, dead ad sets, mis-paced budgets | Findings appear before Marcus would have noticed them himself |
| G3 | Every finding can become a reviewable, executable proposal | Approving or rejecting one takes under 60 seconds on a phone |
| G4 | Approved changes are made correctly, reversibly and with a full audit trail | Any applied change can be undone by its revision id. Nothing is ever changed silently. |
| G5 | Ad-copy variants keep every required element and add no claim beyond Marcus's facts | A variant cannot become a proposal unless it passes the copy checks (§6.12). The agent never authors claims. |
| G6 | Choosing the AI model is a configuration change | The model can be swapped via an environment variable, and the replay eval confirms nothing got worse |
| G7 | Performance is measured against the product's own outcomes, not platform-reported conversions | Cost per outcome is visible per campaign, and outcomes are fed back to the platforms |
| G8 | **Adding a product means adding a pack, not forking the code** | The second pack (`property-sg`) is added with **zero** changes to the core |

### Non-goals (what we deliberately won't do)

- **Not** an autonomous media buyer. There are no unattended live budget changes.
- **Not** multi-tenant *yet*: one operator and his own accounts, with no billing, organisations or role-based permissions. It is built so that adding tenants later is a `tenants` table and a filter, not a rewrite. Every table is keyed by product, credentials are stored per account and the worker is containerised.
- **Not** a creative studio. It writes copy variants, but no images or video.
- **Not** an MCP server. This is a client and a control panel.
- **Not** a public product yet. The dashboard is single-user behind Cloudflare Access.
- **Not** a third pack. Two packs are enough to prove the interface.
- **Not** the authority on ad content. The agent does not decide what a compliant ad is. It checks that variants preserve what Marcus supplied.

---

## 4. The two products

They differ on nearly every axis, which is exactly why they make a good test. If both fit the same pack interface without special cases in the core, the core really is product-agnostic.

| | `snappool` (pack `saas-snappool`) | `property-sg` (pack `property-sg`) |
|---|---|---|
| **Priority** | **First.** Phases 0–1 are validated on its live spend. | Second. Built and tested on recorded data until spending resumes. |
| **What counts as success** (defaults, editable) | **Signup** = success; **activated** = success; **paid** (subscription or one-off) = hard success | **Contact-form fill** = success; **qualified viewing** and **booked** = hard success, if the pipeline records them |
| **Where outcomes come from** | SnapPool's own Neon database, read-only | Tally form → Airtable (the existing pipeline, currently paused) |
| **Conversion cycle** | Minutes to days, low value, higher volume | Days to weeks, high value, low volume |
| **Lifecycle phases** | Soft launch (free, watermarked) → paid → seasonal (wedding season, year-end) | Teaser → VVIP → booking → clearing |
| **Fact base** | Features, plan limits, pricing, supported event types | Project facts: district, MRT, PSF band, unit mix, developer, TOP date, launch dates |
| **Compliance** | Ad-platform policy only. Claims must match the product. PDPA-appropriate wording about photo handling. | CEA rules: agent name, registration number, agency name, licence number, rules on claims and prices. **Marcus is the licensed party.** Meta's *Housing* special ad category very likely applies; it limits targeting (verify for SG, see §7). |
| **Platforms** | Meta/Instagram first, Google Search second, TikTok later | Google Search first, Meta second |
| **Spend** | Small soft-launch budget. Ceilings are still to be set (they're settings, not code). | On hold |
| **Seed data** | Live account | "Sora at Lakeside" project, as recorded fixtures |

---

## 5. How it works

### 5.1 The big picture

```
                 Marcus
     phone ─────────┴──────── laptop
       │                        │
┌──────▼──────────────────┐  ┌──▼─────────────────────────────────┐
│ TELEGRAM BOT            │  │ DASHBOARD (web, behind Cloudflare  │
│ approve / reject / edit │  │ Access)                            │
│ /pause /pause-all /undo │  │ spend vs ceilings, KPI trends,     │
│ /halt /status /ceiling  │  │ proposals, change log, briefs,     │
│ digest, brief, alerts   │  │ ALL settings, fact base, docs      │
└──────┬──────────────────┘  └──┬─────────────────────────────────┘
       │ both surfaces only read, and write "operator requests"
       └───────────────┬────────┘
                       ▼
┌────────────────────────────────────────────────────────────────┐
│ WORKER container (SER9) — read-only credentials, NO write keys │
│  scheduler ─▶ CYCLE per product:                               │
│     sync ─▶ trust check ─▶ detectors ─▶ analyst (AI)           │
│          ─▶ draft proposals ─▶ digest / brief                  │
│  request processor: validates every operator request           │
│  outcome adapters (per pack) ─▶ attribution ─▶ feedback        │
│  AI via Vercel AI SDK (model per stage = env var) ─▶ Langfuse  │
│  packs: saas-snappool | property-sg                            │
└──────────────┬─────────────────────────────────────────────────┘
               │ approved proposals (database rows + a wake-up)
               ▼
┌────────────────────────────────────────────────────────────────┐
│ GATEWAY container (SER9) — the ONLY holder of write keys;      │
│ no AI, no Telegram, no untrusted text                          │
│  check approval ─▶ allowlist ─▶ guards ─▶ fingerprint re-check │
│  ─▶ validate ─▶ mark "applying" ─▶ apply ─▶ read back          │
│  ─▶ change log (+ stored undo) ─▶ notify                       │
└──────────────┬─────────────────────────────────────────────────┘
               ▼
  Google Ads API · Google Data Manager API · Meta Marketing API · Meta Conversions API

  All state lives in Neon Postgres. Every table is scoped by product.
```

### 5.2 The cycle, step by step

A **cycle** runs per product on a schedule. Steps 1–3 run every day; steps 4–5 run weekly. Step 6 sends the daily digest every day and the brief once a week.

| # | Step | What happens | AI involved? |
|---|---|---|---|
| 1 | **Sync** | Download the account structure and the last 28 days of numbers. Numbers are re-downloaded because platforms revise recent days. Take a snapshot of each entity. Any difference from last time that we did not cause is recorded as *drift*. | No |
| 2 | **Trust check** | Run named checks: tracking is firing, outcome data is fresh, attribution gap, the account's timezone matches the product's, and the data is recent. Each check can pass, warn or fail, and knows when there is simply too little traffic to judge. **If any check fails, the cycle stops here and produces a diagnostic brief only.** | No |
| 3 | **Detect** | Fixed rules look for known problems and produce *candidate findings*. Examples: spend with zero outcomes, costly search terms that never convert, ad sets with no delivery, pacing against the ceiling, cost spikes, tracking gaps. | No |
| 4 | **Analyse** (weekly) | The analyst AI sees the candidates plus a compact, typed view of the account. It may look things up with read-only database queries. It confirms or dismisses each candidate, ranks them, explains why they matter now, and may add findings of *known types*. **Then the core takes over.** It checks each finding's target really exists, computes the evidence numbers from the database, and drops any finding below the pack's evidence thresholds. | Yes |
| 5 | **Draft** (weekly) | Each surviving finding with an allowed action becomes a **proposal**. The core picks the exact action from the finding type, and works out the exact undo, the fingerprint and the expiry. The AI only writes the rationale and the expected effect. | Wording only |
| 6 | **Report** | A **daily digest** (numbers only, sent only while a product is spending) and a **weekly brief**. In the brief, the numbers come from the database and the AI writes the text around them. Every number in the text is checked against the database, and if any don't match, the brief falls back to a plain template. | Weekly wording only |

Then, whenever Marcus decides:

| # | Step | What happens |
|---|---|---|
| 7 | **Approve** | Marcus approves, rejects (with a reason) or edits-and-approves in Telegram or on the dashboard. The approval binds to the proposal's version *and* the fingerprint of its action. Rejection reasons become test cases for the replay eval. |
| 8 | **Apply** | The gateway runs its pipeline (§6). The AI is never involved, and neither surface can call it directly. |

And separately, every day:

| # | Step | What happens |
|---|---|---|
| 9 | **Outcomes and feedback** | Each pack's outcome adapter pulls new outcomes, and the core attributes them to campaigns (§8). Outcomes at the product's feedback stage become conversion-upload proposals. While Phase 2 is being proven, Marcus approves them. Afterwards they can be auto-approved by a setting, with daily caps. Uploads go out through the gateway like any other change. |

### 5.3 The rhythm

| When (Singapore time) | What |
|---|---|
| Daily 06:00 | Sync, trust check and detectors for every active product. After that: outcomes, attribution and feedback drafting. |
| After the daily sync | Daily digest, per product, only if it has live spend (setting: `auto` / `always` / `off`) |
| Monday 07:00 | Weekly cycle: analyse, draft, brief |
| Continuously | The gateway applies approved proposals, woken instantly by a database notification, with a poll every 30 s as a fallback |
| Every ~10 minutes | "I'm alive" heartbeats from the worker and the gateway to an external monitor. If they stop, Marcus is told by email or SMS from outside the SER9. |

### 5.4 Marcus's own actions

Marcus's commands go through the **same path** as the agent's suggestions. `/pause`, `/pause-all`, `/budget` and `/undo` each create an operator request. The worker turns it into a proposal (with snapshot, undo and fingerprint), Marcus's confirm tap is the approval, and the gateway applies it. There is no second, unguarded way to change an account.

- **Emergencies are fast.** Once Marcus confirms a pause, the gateway is woken immediately. It does not wait for a schedule.
- **Halt is different.** `/halt <product|all>` sets the product's status to `halted`: no cycles run and **agent** proposals wait. It stops the agent, not the ads.
- **Pausing during a halt.** Marcus's own spend-reducing actions (pause, pause-all) **still work while a product is halted**. You often halt because something looks wrong, and that is exactly when you want to pause things. Everything else waits until `/resume-agent`.
- **Undo of a pause** re-enables spending. The undo is allowed only for pauses this system made, only if the entity is still paused, and only within the spend ceilings.

### 5.5 What "learning" means here, and what it doesn't

The AI model does not learn. Every cycle starts from a fresh prompt, and no weights change. What improves over time, most trustworthy first:

1. **The platforms learn.** Conversion feedback (step 9) trains Google's and Meta's bidding on *your* definition of success. This is genuine optimisation and works regardless of which AI model we use.
2. **The fixed rules learn from data.** Thresholds, cooldowns, attribution and pacing read from a growing record, and more data means fewer findings driven by noise.
3. **The prompt remembers.** The analyst's input includes a *decision memory*: recent rejections per finding type with their reasons, the measured results of past changes, and the product's LEARNINGS document. This is look-up, not learning. It stops the model repeating a mistake it can see, but it is limited by context size and can over-weight examples, so treat it as steering.
4. **Marcus learns, via evals.** Agree rates and measured outcomes per finding type show which types to trust. Marcus then tunes thresholds, prompts and pack content. The human is the learning loop.

Deferred ideas:
- A fixed *policy adjuster* that proposes threshold changes from measured outcomes, approved like any other proposal.
- Fine-tuning, which needs a volume of data one operator will not produce.

**The honest pitch:** *the AI is a reasoning engine over an improving record, not a learner.*

---

## 6. Safety model

The safety model is a set of **independent layers**. No single layer is trusted on its own. For each layer: what it stops, where it is enforced, and how it is tested.

### 6.1 One way to change an account

- **Stops:** any part of the system other than the gateway changing an ad account, whether through a bug, prompt injection or a compromised component.
- **Enforced by:**
  - **Code structure.** The write clients live in their own packages (`connector-google-write`, `connector-meta-write`), and only the gateway package may depend on them. An automated boundary check fails the build otherwise.
  - **Separate processes and keys.** The gateway runs as its own container and is the only process holding the write master key. The worker, which talks to the AI and to Telegram, *cannot* decrypt write credentials even if its code tried. **(needs OK: D-043)**
  - **Platform-side limits.** On Meta, the sync uses a system user granted `ads_read` only. On Google, the sync uses a Google login with *read-only* access to the ad account. **(needs OK: D-046)**
- **Tested by:** the boundary check has a negative test (a deliberate illegal import must fail); and there is a test that a worker-side decrypt of a write credential fails.

### 6.2 Action allowlist

Which actions exist at all is a typed setting inside the gateway, not text in a prompt. A pack or a product's settings may **remove** actions, never add them.

| Action | Status | Why |
|---|---|---|
| Add a negative keyword (block a search term) | Allowed (Phase 2) | Reduces spend. Almost no downside. |
| Pause a campaign / ad group / ad set / ad / keyword | Allowed (Phase 2) | Reduces spend. Reversible. |
| Upload conversions (feedback) | Allowed (Phase 2) | Feeds the platforms' optimisation and doesn't move spend directly. **Cannot be undone on Meta**, so extra safeguards apply (§8). |
| Change a daily budget | Allowed with guards (Phase 3) | The main lever, so the size of each change is limited |
| Create a campaign / ad set / ad | Allowed **paused only** (Phase 3–4) | Created switched off. Switching it on is a human act in Ads Manager. |
| Switch on (resume) something | **Undo only** | Only as the undo of a pause this system made, requested by Marcus |
| Remove a negative keyword | **Undo only** | Only as the undo of a negative this system added |
| Change bid strategy / target CPA | Blocked | Large blast radius and hard to reverse |
| Edit a live ad's creative | Blocked | Policy and compliance risk |
| Change audience or targeting | Blocked for now | Revisit after Phase 3 data |
| Delete anything | Blocked | Irreversible |

### 6.3 Approval tied to exactly what Marcus saw

- **Stops:** approving one thing and applying another; approving stale suggestions; double taps.
- **Enforced by:**
  - Each approval stores the proposal version and a hash of its exact action. The gateway re-checks both.
  - Proposals expire: budget changes after 72 hours, everything else after 7 days.
  - Each version can be decided only once.
  - Telegram only accepts taps from Marcus's user id, in a private chat.
- **Tested by:** tests for stale versions, expired proposals, double taps and unknown users.

### 6.4 Guards: size and frequency limits

Defaults live in the core. A pack or a product's settings may only make them **stricter**, and a looser override is rejected when it is saved.

| Guard | Default |
|---|---|
| Maximum budget change per action | ±30%. On **Meta** the default is ±20%, because bigger jumps commonly restart the platform's learning phase. **(needs OK: D-049)** |
| Minimum meaningful change | SGD 5 or 5%, whichever is larger |
| Cooldown | 7 days per entity per action type |
| Budget-neutral by default | Within a product, an increase applies only after enough offsetting decreases have been applied, unless the proposal is explicitly flagged as a net increase |
| Spending ceilings | See §6.9 |
| Maximum applied changes per product per day | 10 |
| Shared budgets | A Google budget shared by several campaigns cannot be changed by this system |

These guards are tested with property-based tests: thousands of random inputs checking rules like "blocks if and only if the change exceeds the limit".

### 6.5 Evidence from the database, thresholds from the pack

- **Stops:** acting on noise, and acting on numbers the AI got wrong or made up.
- **Enforced by:**
  - The AI returns finding *types*, *targets* and *references*, never the numbers.
  - The core computes impressions, clicks, spend, outcomes and days for the target from the database, and applies the pack's thresholds to those numbers.
  - A finding about an entity that doesn't exist in our database is dropped.

  Example threshold: in `property-sg`, "pause keyword" needs at least 500 impressions, 30 clicks and 7 days of data. `saas-snappool` uses lower click floors but more days during the soft launch.
- **Tested by:** a test where the AI claims big numbers for a tiny entity, which must fail the threshold; and a test with an unknown target, which must be dropped.

### 6.6 Fresh-state check (fingerprint)

- **Stops:** a Monday proposal being applied to a Friday account.
- **Enforced by:** just before applying, the gateway re-reads the entity from the platform and hashes the fields the action depends on. It compares that hash with the one stored when the proposal was drafted. If they differ, the proposal becomes **stale**: nothing is applied, and Marcus sees what changed. Undos are checked the same way: the entity must still be in the state our change left it in.

### 6.7 Validate before applying

- **Google:** every change is first sent with `validate_only=true`, and the real request must be byte-for-byte identical to the validated one.
- **Meta** has no general dry-run. The gateway:
  1. validates locally and checks permission on the target;
  2. uses Meta's validation option on endpoints that support it (to be verified in M12);
  3. applies the change;
  4. reads the entity back straight away;
  5. undoes the change automatically if the read-back doesn't match, and alerts Marcus.

  Anything the system creates is created **paused**.

### 6.8 Change log and undo

- **How it works:** before every change, the prior state is saved. Every applied change gets a revision id, a before/after record and a stored undo.
- **Undo is always available:** `ads-gw revert <rev>` works from a cold start with only the database, with no AI and no pack.
- **Irreversible actions:** conversion uploads are the only irreversible action (see §8).

### 6.9 Spending ceilings, and the real backstop

Ceilings are per-product settings: a daily and a monthly limit. They are enforced in three ways:
1. **Blocking increases.** A budget increase or paused create is blocked if the product's ceilings are **unset**. It is also blocked if the sum of active daily budgets after the change would exceed the daily ceiling, or if month-to-date spend plus projected spend would exceed the monthly ceiling.
2. **Alerts.** An alert fires at 80% of the monthly ceiling. At 100% there is an alert plus a pause proposal. That pause is applied automatically only if the product setting `autoPauseOnMonthlyBreach` is on (**off by default**).
3. **Honest limits.** The system is **not** a hard spending cap. Platforms may spend above a daily budget on individual days (Google allows up to 2× on a day), and the system only controls what *it* changes. **The real backstop is platform-side:** set a Meta **account spending limit** on each ad account (Marcus, setup task T4). Google campaigns are bounded by their budgets, and the trust check warns if a Meta account has no spending limit.

### 6.10 Crash-safe applying

The dangerous moment is between "the platform accepted the change" and "we recorded it". So:
1. Before calling the platform, the gateway marks the proposal `applying` and stores an idempotency key and the before-snapshot.
2. It then calls the platform, reads back, writes the change log, and marks the proposal `applied`.

On restart, every proposal still marked `applying` is reconciled:
- the intended state is present → it is recorded as applied, without calling the platform again;
- the intended state is absent → the change is retried;
- the state can't be determined → the proposal is marked `needs attention`, the product is halted and Marcus is alerted.

Retries are safe because every action is idempotent:
- pauses and budget changes set an absolute value;
- a duplicate negative keyword counts as "already done";
- conversion uploads carry unique event ids;
- **creates carry an idempotency tag**, and the gateway searches for the tag before retrying.

### 6.11 Untrusted input (prompt injection)

Some text comes from outside and is **data, never instructions**:
- search terms
- ad and placement names
- competitor ad text
- anything else that comes from a platform or a customer

It reaches the AI only inside a typed data block, never inside the instructions. The AI's output must match a strict schema. The AI can only produce findings of known types about entities that exist, and it cannot choose the action or the numbers. In the worst case, injected text produces a bad suggestion, which Marcus rejects. Also, **the process that can spend money never talks to the AI.**

### 6.12 Ad copy checks

The agent never authors advertising claims. Marcus supplies three things: **source copy**, **required elements** and a **fact base**.
- *Required elements* for property: registered name, CEA registration number, agency name and licence number.
- *Required elements* for SnapPool: whatever disclosures Marcus decides.

The AI produces **variants** of the source copy. There are two tiers, set per product **(needs OK: D-045)**:
- **Fragments** (default for property). Variants are assembled only from fragments Marcus has approved, with fixed safe edits such as trimming, casing and punctuation. "No new claims" is then *guaranteed by construction*.
- **Reword** (proposed for SnapPool). The AI may reword freely, but mechanical checks block the variant if it:
  - introduces any number, price, percentage, date or capitalised name not found in the facts or the source copy;
  - uses superlatives such as "best", "#1", "guaranteed" or "only" that aren't in the source copy;
  - includes a banned phrase;
  - is missing a required string.

  This tier **cannot mechanically prove** there are no new claims, so Marcus's approval of each variant is the final check.

Both tiers also run the **platform format check**: Google RSA limits (15 headlines of up to 30 characters, 4 descriptions of up to 90), Meta text limits, URL validity and banned-word lists. The checks **fail closed**: if in doubt, block. Created ads are always paused.

### 6.13 Credential vault

- **How tokens are stored:** each account's tokens are encrypted with their own data key, and the data keys are encrypted with a master key (*envelope encryption*).
- **Two master keys, two roles:** the worker holds the **read** master key and the gateway holds the **write** master key.
- **Decryption:** credentials are decrypted just-in-time, in memory, and every decryption writes an audit row.
- **Future tenants:** they will connect via OAuth, and the callback writes their tokens straight into the vault.
- **Secrets not in the vault:** app-level secrets (Google developer token, OAuth client secret, Meta app secret) are not account tokens. They live in Doppler, scoped to the process that needs them.
- **Platform access for third-party accounts:** serving other people's accounts later needs Google Standard/Basic access and Meta app review for `ads_management`. Both are slow, so start when tenants are decided.

### 6.14 Kill switches

| Switch | Effect | Who |
|---|---|---|
| `/halt <product>` / `/halt all` | Agent stops: no cycles, and agent proposals wait. Marcus's pauses still work. | Marcus (Telegram or dashboard) |
| Global writes switch | The database flag `writes_enabled` **and** the env var `GATEWAY_WRITES_ENABLED` must both be true, or the gateway refuses every write | Marcus |
| Automatic halt | If an auto-undo fails after a bad verify, that product is halted and Marcus is alerted | Gateway |
| Break glass | Revoke the Meta system user token and the Google OAuth grant in the platforms' own settings | Marcus (runbook) |

### 6.15 Environments

Claude's development sessions (cloud or local) and CI **never hold production write credentials**. Details are in §11.

---

## 7. Platform realities

Facts in this section were checked on 2026-09-25 (sources in `docs/memory/GOTCHAS.md`). Anything marked *verify* must be re-checked in the milestone that depends on it; the `verify-external-facts` skill covers how.

| | Google Ads | Meta Ads |
|---|---|---|
| **Official AI connector** | `googleads/google-ads-mcp`: read-only, 3 tools (list accounts, GAQL search, field metadata). Had a security fix in July 2026 that stopped OAuth credentials being written to logs. | `mcp.facebook.com/ads`: hosted, and can write with `ads_management` |
| **How we read** | Google Ads API via the `google-ads-api` Node library. The library supports **one** API version per release and lags Google by 1–2 months (it moved to v25.1 on 2026-09-17; Google is at v25.2). | Marketing API (Graph), system user with `ads_read` |
| **How we write** | Google Ads API mutate, with `validate_only` first | Marketing API with a system user granted `ads_management` |
| **How we upload conversions** | **Data Manager API** (`datamanager.googleapis.com/v1/events:ingest`, OAuth scope `datamanager`, no developer token). Since **2026-06-15** the old Google Ads API upload method is blocked for developer tokens that weren't already using it, and ours is new. The conversion action must be of the "import from clicks" type. | Conversions API (CAPI). A batch is **rejected entirely** if any event is older than 7 days (website events), so upload at least daily. Test with `test_event_code` first. |
| **Dry-run** | `validate_only=true` performs real server-side validation | No general dry-run. Some endpoints may support a validation option (*verify in M12*); otherwise read back and auto-undo. |
| **Access / quotas** | **Explorer access** works against real accounts without an application (since Feb 2026), with a cap of 2,880 operations/day. **Basic** allows 15,000/day. **Standard** is unlimited. Applications have had backlogs. Our sync needs well under 500/day. | Rate limits depend on the app's access tier (*verify in M02*) |
| **Money units** | Micros everywhere | Budgets are in the currency's minor units (cents for SGD). Insights report spend as decimal strings. Converted to micros exactly, with no floating point. |
| **Versioning** | Monthly minor releases, 3–4 majors a year, each supported ~12 months (v25 sunsets Aug 2027). Pin the version and check quarterly. | Versioned Graph API. Pin the version and check deprecation dates (*verify in M02*). |
| **Sandbox** | A test manager account with test client accounts | **No sandbox with real delivery.** Test writes on a real account with a tiny paused campaign; test CAPI with `test_event_code`. |
| **Special categories** | Housing ads have their own policies (*verify for SG*) | **Special ad categories** (Housing etc.) now apply in Asia too. Creating a campaign requires declaring `special_ad_categories`. The property pack declares `HOUSING` (*verify for SG*), which restricts targeting. |

**Other constraints:**
- **Restatement.** Platforms revise conversions for days: about 7 days for Meta attribution windows, and longer for Google conversion lag and imported conversions. The sync re-pulls 28 days and overwrites, and a brief never treats yesterday as final.
- **Timezones.** Platforms report days in the ad account's timezone. The trust check fails if an account's timezone differs from its product's (`Asia/Singapore`). A Meta ad account's timezone cannot be changed after creation.
- **Automation risk.** Unofficial third-party MCP tools have got ad accounts flagged or banned. We use only the official APIs with our own app.

---

## 8. Conversion tracking and feedback

Feeding real outcomes back to the platforms is the biggest lever in the whole system (v2 decision D-005). It is also where a quiet mistake does the most damage: wrong conversions teach the platforms to find the wrong people. These rules apply:

1. **Capture IDs at the moment of landing.** SnapPool and the property form must store the following on each signup or lead:
   - click IDs: `gclid`, `gbraid`/`wbraid`, `fbclid`, and the `_fbc`/`_fbp` cookies;
   - platform IDs from the landing URL: Google `{campaignid}`/`{adgroupid}` and Meta `{{campaign.id}}`/`{{adset.id}}`/`{{ad.id}}`, added as URL parameters on every ad;
   - `utm_*` parameters.

   **Meta offers no way to look up which campaign an `fbclid` came from**, so URL parameters are the only reliable attribution for Meta. *Setup task T6 (SnapPool) and T12 (Tally form).* Without these IDs, attribution and feedback cannot work, and the trust check will warn.
2. **Count each conversion once.** For each stage and platform, pick **one** source:
   - Browser tag or pixel plus a server event carrying the **same event id**, so the platform de-duplicates them; **or**
   - Server upload only.

   Never count one conversion through two uncoordinated paths. **Recommendation (needs OK: D-047):** SnapPool reports **signups** itself, in real time (pixel + server event with a shared event id). Real-time reporting matches best. The agent uploads the **delayed stages** (activated, paid) and property's offline stages. *Question Q3 asks what SnapPool already sends.*
3. **Exclude test and internal signups.** Each outcome carries an `isTest` flag. Test outcomes are never uploaded and never counted in KPIs. *Question Q5: how to identify them.*
4. **Respect time limits.** Meta rejects a whole batch if any website event is older than 7 days, so the agent uploads daily and skips events older than 6.5 days. Google imports must arrive within the conversion window after the click (*verify in M13*).
5. **Treat uploads as irreversible.** Meta uploads cannot be undone, and Google offers only retractions. Therefore:
   - auto-approval stays **off** until Phase 2 has been proven **(needs OK: D-048)**;
   - there are daily caps, and an alert fires if volume is unusual;
   - personal data is hashed (SHA-256, normalised as each platform requires) inside the pack's adapter. Raw emails and phone numbers never leave the adapter.
6. **Privacy (PDPA).** Uploading hashed customer data to Google and Meta must be covered by each product's privacy policy. This is Marcus's responsibility; the system only minimises what it handles.

---

## 9. Data and memory

**Postgres is the single source of truth**, and nothing relies on what an AI "remembers":
- campaign IDs, budgets, timestamps and actions are exact database queries;
- the current state is re-loaded every cycle.

The main tables are listed below. Full definitions are in `BLUEPRINT.md` §4.

| Area | Tables | Holds |
|---|---|---|
| Products and settings | `products`, `settings_history`, `product_docs`, `pack_manifests` | Each product's pack, status and settings (one validated document with full version history); its STRATEGY/PLAYBOOK/LEARNINGS text; each pack's published schema for the dashboard |
| Accounts and credentials | `accounts`, `credentials`, `credential_access` | Ad accounts; encrypted tokens per role (read / write / feedback); an audit row for every decryption |
| What's in the accounts | `ad_entities`, `ad_entity_snapshots`, `metrics_daily`, `search_terms`, `drift_events`, `google_clicks` | Every campaign, ad group, ad, keyword and budget; snapshots stored only when something changed; daily numbers for every entity at every level |
| What's being sold | `offerings` | The fact base per project or product |
| Outcomes | `outcomes` | Real results with click IDs, platform IDs, hashed contact data, a test flag, attribution, and when each was uploaded to each platform |
| The agent's work | `cycles`, `trust_checks`, `findings`, `proposals`, `proposal_versions`, `approvals`, `change_log`, `briefs` | Everything the agent did and why, every decision Marcus made, every change applied, every report sent |
| Plumbing | `jobs`, `operator_requests`, `notifications`, `system_flags`, `api_usage` | The job queue, Marcus's requests, the outgoing message queue, global switches, API quota use |

**Product documents.** Each product has three short documents that Marcus edits and the analyst reads every cycle:
- **STRATEGY**: standing objectives and budget philosophy;
- **PLAYBOOK**: the pack's human-readable playbook;
- **LEARNINGS**: what actually worked.

They live **in the database and are edited on the dashboard**, with version history, so editing them needs no redeploy. The files in `products/<slug>/` in the repo are only the starting templates. **(needs OK: D-044)**

**Personal data.** Only what attribution and feedback need is stored, and contact details are stored only as hashes. Prompts to the AI and traces in Langfuse contain **aggregates only**, never individuals. Fixtures are scrubbed when recorded.

---

## 10. Tech stack

| Layer | Choice | Why | Rejected or deferred |
|---|---|---|---|
| Language / runtime | **TypeScript on Node 24 LTS**. Move to Node 26 after it becomes LTS on 2026-10-28, if all dependencies support it (decide in M00). | The AI SDK, Drizzle and zod are TypeScript-first, guards must be typed and unit-tested, and it matches SnapPool's stack | Python (splits the codebase); C#/.NET (Marcus's strength, but the ecosystem doesn't fit) |
| Repo | **pnpm workspaces + Turborepo** monorepo | Product-agnostic code needs *enforced* package boundaries | A single package, where boundaries become conventions that erode |
| Agent loop | **Custom TypeScript** | A small loop; guards are plain, testable code | LangGraph / CrewAI (too heavy, and they hide the guard path) |
| AI access | **Vercel AI SDK 6**: `generateText` with `Output.object({ schema })` and zod 4 schemas. Model per stage = env var (`provider:model`). | Model-swappable (G6), in-process, structured outputs | `generateObject` (deprecated in AI SDK 6); LiteLLM (optional later); Claude Agent SDK (locks G6 to one vendor) |
| Model choice | **Strongest available model for analysis** (the hard part). A cheaper model may do the brief and rationale wording once replay evals show no loss. Cost at this volume is a few dollars a month. **(needs OK: D-041)** | Analysis quality decides whether Phase 1 passes | v2's "cheap model for analysis" |
| Analyst look-ups | **Typed, read-only database queries** with a per-cycle call budget. **(needs OK: D-039)** | Deterministic and replayable (evals work), no extra credentials, no API quota, no Python sidecar | Official Google/Meta MCP servers, deferred until the analyst provably needs data the sync doesn't hold |
| Database | **Neon Postgres + Drizzle**. The worker and gateway use the **direct** connection, because advisory locks and LISTEN/NOTIFY don't work through Neon's pooler. The dashboard uses the pooled connection. | Typed schema and migrations; same platform as SnapPool (separate project) | Airtable as the system of record (it stays a *source* for property outcomes only) |
| Google | **Google Ads API** via `google-ads-api` (pinned together with the API version); **Data Manager API** (REST) for conversion uploads | Deterministic reads; we own the write path | Official MCP for sync; third-party hosted write tools |
| Meta | **Marketing API** (Graph) + **Conversions API**, with system users | Typed; no MCP in the money path | Community Meta MCP servers (account-ban risk) |
| TikTok | Deferred. The connector interface is designed so it becomes a third connector package. | Matters for SnapPool eventually | — |
| Processes | **Docker Compose on the SER9**, one image with `worker` and `gateway` services (plus `dashboard` if hosted on the SER9), `restart: unless-stopped`. No local state. **(needs OK: D-043)** | Restart safety; a real security boundary for write keys; the same image can later run on a cloud container service | A bare systemd process (not portable); Cloudflare Workers for the loop (wrong runtime for multi-minute cycles) |
| Scheduling / queue | **Postgres `jobs` table** (`FOR UPDATE SKIP LOCKED`, leases, retries with backoff). One worker replica wins a **leader lock** and runs the scheduler and the Telegram poller; any replica runs jobs. | Scaling out means adding replicas, with no message broker | n8n; Vercel cron; Redis/BullMQ |
| Recovery | Startup reconciliation; two-phase apply; heartbeats to **healthchecks.io** (worker and gateway every ~10 min, plus a daily-sync check) | The bot can't tell you the host is down | Telegram alerts alone |
| Credentials | **Vault** with two master keys (read / write), §6.13 | Same posture for one user or a thousand | Raw tokens in env |
| Operating surface | **Telegram bot (grammY)** inside the worker. HTML message formatting. Only Marcus's user id, only in a private chat. | Acting from the phone in under 60 s | Settings menus in the bot (only ceilings and digest mode are allowed there) |
| Dashboard | **Next.js behind Cloudflare Access.** The middleware verifies the Access token and fails closed. Its database role can only read, and insert operator requests. Hosting: **the SER9 via Cloudflare Tunnel** (recommended) or **Vercel Pro**. Vercel's free Hobby plan forbids commercial use. **(needs OK: D-050)** | Configure and review from a screen | A web app that executes writes or holds platform credentials |
| Secrets | **Doppler** with separate configs for `worker`, `gateway` and `dashboard`, plus a `dev` config. It holds DB URLs, the bot token, AI and Langfuse keys, app-level platform secrets and the vault master keys (read key in `worker`, write key in `gateway` only). | One source, scoped per process | A shared `.env` across processes |
| Observability | **Langfuse** (cloud free tier or self-hosted) via the AI SDK's telemetry, with no personal data; **pino** structured logs | Debug a bad proposal after the fact; cost per product; home for evals | console.log |
| Testing | **Vitest + fast-check** (property tests for guards); **real Postgres** in tests (a CI service container; cloud sessions have Postgres 16 installed); recorded fixtures; Google test account; Meta `test_event_code` | The guards are the product, so they get the strongest tests | Mock-only database tests |
| Development | **Claude Code**, in cloud sessions (no secrets) and local sessions (SER9 or laptop). Memory lives in this repo (`docs/memory/`), with a git workflow (`docs/process/`) and project skills (`.claude/skills/`). | Any session can continue where the last one stopped | Memory kept only in chat history or on one machine |

---

## 11. Environments, secrets, and who can do what

| Where | Holds | Can | Cannot |
|---|---|---|---|
| **Cloud Claude session / CI** | Code, fixtures, a throwaway local Postgres | Build, run all tests, open PRs | Read or change any ad account; see any production secret |
| **Local Claude session** (SER9 or laptop) | Code, plus the Doppler `dev` config if Marcus provides it | Everything a cloud session can. With Marcus's explicit go-ahead: record fixtures with **read-only** credentials, run live smoke tests on **test** accounts. | Use the production `worker` or `gateway` configs; hold write credentials |
| **Production worker** (SER9 container) | Read master key, AI/Telegram/Langfuse keys, DB | Sync, analyse, draft, report, process requests | Decrypt write or feedback credentials |
| **Production gateway** (SER9 container) | Write master key, DB | Apply approved proposals, undo, reconcile | Talk to the AI or Telegram; do anything without an approval (except policy-approved feedback uploads, once enabled) |
| **Dashboard** | Access check, DB role limited to reading plus inserting operator requests | Show everything; record Marcus's requests | Change settings or proposals directly; hold any platform token |

Two switches must both be on before the gateway writes anything: `GATEWAY_WRITES_ENABLED=true` (env) and `writes_enabled` (database flag). In dev and CI the env switch is always false.

---

## 12. Phases and gates

Each phase ends with a **gate**: a test on real data that must pass before the next phase's first milestone starts. The calendar gaps between phases are deliberate. They are where the product is actually validated.

| Phase | What it adds | Milestones | Gate before the next phase | How it's measured |
|---|---|---|---|---|
| **0: Read-only** | Sync, trust check, detectors, analyst, daily digest, weekly brief. No write code exists. | M00–M07 | (a) The SnapPool brief told Marcus something he'd have missed in **2 of the first 4 weeks**; (b) the property pack loads and passes its tests on fixtures with **zero core changes** | (a) Buttons on each brief: 👍 *useful* / 💡 *new to me*, stored with the brief; (b) the diff of the property-pack commit shows no lines changed in the core |
| **1: Suggest** | Proposals, approvals in Telegram and on the dashboard, Marcus's own requests. **The system applies nothing**; Marcus applies approved items by hand. | M08–M10 | **≥ 70% agree rate over 3 weeks with ≥ 15 agent proposals.** Too few proposals? Raise the campaign ceiling or extend the window. **Never lower the bar.** | Agree = approve or edit-and-approve; disagree = reject. Expired proposals don't count, but if more than 20% expire the gate fails (suggestions aren't being reviewed). Marcus's own requests are excluded. |
| **2: Low-risk changes** | The gateway; live pauses, negative keywords and conversion uploads | M11–M13 | **≥ 20 live changes** (pauses and negatives) with **zero wrong changes** and **zero unexplained verify failures**, plus **one successful cold-start undo drill** | Change log. Stale refusals are *correct* behaviour and don't count against the gate. |
| **3: Budgets** | Guarded budget changes, paused creates, pacing | M14 | **4 weeks** with no guard bypass, no agent budget change Marcus had to undo because it was wrong, and no ceiling breach caused by the agent | Change log + alerts |
| **4: Copy** | Variants of Marcus's copy, with checks | M15 | SnapPool variants pass the checks and arrive as paused-ad proposals; a variant missing a required string is always blocked | Tests + cards |
| **5: Harden** | Evals, the model-swap gate, runbook, `ads doctor` | M16 | — | — |

**Running spend during Phase 0.** Run a small, always-on SnapPool Meta campaign from Phase 0, within whatever ceiling Marcus sets. It is launch traffic and the signal the agent needs at the same time. The evidence thresholds will keep the agent brief-only until there is enough volume. That's correct behaviour, not a bug.

**When property resumes:** no new phase is needed. Set its ceilings, connect its accounts and change its status from `dormant` to `active`, and it enters the same loop. That's the point of G8.

**Deferred:** multi-tenant, billing, TikTok, a third pack, image and video creative, targeting changes.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| The AI proposes confidently wrong changes | Fixed detectors first; evidence computed from the database; thresholds; the Phase 1 agree-rate gate before any write code |
| A stale proposal is applied to a changed account | Fingerprint re-check at apply time; stale proposals return to Marcus |
| The AI invents numbers or entities | The AI never supplies numbers; targets must exist; brief numbers are checked against the database |
| Something other than the gateway changes an account | Separate write packages plus a boundary check; the gateway is a separate process holding the only write key; platform-side read-only identities for sync |
| Marcus's Telegram account is compromised | The bot holds no platform credentials. Only Marcus's user id is accepted. The worst case is a pause, a halt or an undo of a system change; no command can switch on spend the system didn't pause, and budget commands have the same guards. |
| Prompt injection via search terms or competitor copy | Typed data blocks, strict output schemas, known finding types only, and no AI in the process that can spend |
| **Google conversion-upload path changes** (it happened on 2026-06-15) | Uploads use the Data Manager API. The `verify-external-facts` skill re-checks platform facts at every milestone that depends on them. |
| **Conversions are double-counted or fake** (test signups, pixel plus upload) | One counting source per stage and platform; shared event ids; the `isTest` flag; daily caps; auto-approval off until Phase 2 is proven |
| **No click or platform IDs are captured**, so attribution is blind | Setup tasks T6 and T12; a trust-check warning when capture drops |
| Meta's Housing category limits property targeting | Declared in the property pack; the playbook is written with it in mind (verify for SG) |
| Google API breaking change | Version pinned together with the library; quarterly upgrade check; integration test on the test account |
| A copy variant drops a required element or invents a claim | Fail-closed checks; the fragments tier for property; Marcus approves every variant; ads are created paused |
| Too few proposals during SnapPool's low-volume launch | Always-on campaign from Phase 0; extend the window rather than lower the bar |
| The second pack forces special cases into the core | G8 is an explicit gate: zero core changes, or the interface gets fixed in the core |
| Building too much before validating | Phase gates |
| The SER9 goes down or restarts mid-cycle | Containers with a restart policy; startup reconciliation; two-phase apply; external heartbeats; nothing stateful on disk. *Check that Docker starts on boot without anyone logging in (Q2).* |
| Expecting the model to "learn" the account | §5.5 |
| Costs creep | Per-product AI cost in Langfuse; a per-cycle look-up budget; §14 |
| **Plan and code drift apart; a session loses the thread** | The plan is kept in the repo and changed only via the `update-plan` skill; memory files are updated every session; the SessionStart hook finds the newest memory even on unmerged branches |
| A Claude session gets production credentials | Environment separation (§11); both write switches must be on |

---

## 14. Costs to expect

These are rough, excluding ad spend. Check current pricing before committing.

| Item | Expected | Note |
|---|---|---|
| AI model calls | A few USD/month | 2 products × weekly analysis × ~60k input tokens, plus short wording calls. Scales with products and cycles. |
| Neon Postgres | Small monthly bill likely | The free plan gives 100 compute-hours/month and sleeps after 5 idle minutes. An always-on worker keeps the database awake (~730 h/month), so expect the usage-based paid plan. **(Q7)** |
| Dashboard hosting | USD 0 on the SER9 via Cloudflare Tunnel, or ~USD 20/month on Vercel Pro | Vercel's free Hobby plan forbids commercial use **(Q6 / D-050)** |
| Cloudflare Access | Free tier | Up to 50 users |
| Langfuse | Free tier likely enough | Or self-host on the SER9 |
| Doppler, healthchecks.io | Free tiers likely enough | |
| Google Ads API, Data Manager API, Meta APIs, Telegram | Free | |
| Claude Code sessions | Per Marcus's plan | Each milestone is roughly 0.4–0.6M tokens (BLUEPRINT §9) |

---

## 15. Decisions

All decisions, with reasons and alternatives, are recorded in `docs/memory/DECISIONS.md`.

- **Standing (Marcus, 2026-09-14):** D-001 to D-019. The two-pack core, no n8n, typed sync, the AI SDK, feedback to platforms, fingerprint checks, evidence thresholds, replay evals, Marcus as content authority, Telegram plus dashboard, per-product outcome config, SnapPool first, ceilings as settings, containerised worker, vault, honest "learning", and the stack.
- **v3 fixes (Claude, 2026-09-25):** D-020 to D-038. These correct errors, contradictions and outdated facts. They count as adopted, but Marcus can object to any of them.
- **v3 recommendations needing Marcus's OK:** D-039 to D-053. Listed in `QUESTIONS.md` Q1.

---

## 16. Setup tasks for Marcus

These are done outside Claude Code. Each lists the milestone it blocks. Google and Meta steps have lead times, so start them early.

| # | Task | Blocks | Notes |
|---|---|---|---|
| T1 | **GitHub repo settings:** protect `main` (require a PR and passing checks, no force-push); squash-merge only; auto-delete merged branches | Before M00 merges | `docs/process/GIT-WORKFLOW.md` §9 |
| T2 | **Neon:** a project for the agent with `prod` and `dev` branches | M01 live steps | Separate from SnapPool's project |
| T3 | **Doppler:** a project with `dev`, `worker`, `gateway` and `dashboard` configs; generate the two vault master keys (read, write) | M01 live steps | Never give Claude sessions the `worker`/`gateway` configs |
| T4 | **Meta:** a developer app with the Marketing API. In Business Settings create system users `ads-agent-read` (`ads_read`, "View performance" on the SnapPool ad account) and `ads-agent-write` (`ads_management`, "Manage campaigns"). Generate a Conversions API token for SnapPool's dataset. **Set an account spending limit** on the SnapPool ad account. Load the tokens with the CLI (M01) into the vault, not into Doppler. | M02 (read), M12 (write, feedback) | Check the system-user limit and the app's rate-limit tier |
| T5 | **Google:** a manager account (MCC) with the property account and a new SnapPool account under it. Get a developer token from the MCC's API Center: **Explorer access** works on real accounts immediately; also apply for **Basic**. Create an OAuth client in a GCP project. Create **two Google logins**: one with *read-only* access to the ad accounts (for sync) and one with *standard* access (for writes and uploads) **(D-046)**. Set up a separate *test* manager account with a test client account. | M03 (read), M13 (write) | Days of lead time |
| T6 | **SnapPool:** (a) table/column names for signups, activations, subscriptions and one-off payments, plus a read-only connection string; (b) confirm, or add in SnapPool's code, that each signup stores click IDs, platform IDs from the URL and `utm_*` (§8, rule 1); (c) list what tracking already fires (pixel, CAPI, Google tag) and for which events; (d) how to identify test/internal signups | M05 | (b) and (c) are in SnapPool's codebase, not this repo |
| T7 | **Telegram:** create the bot with BotFather and send Marcus's numeric user id | M07 | |
| T8 | **healthchecks.io:** three checks (worker alive, gateway alive, daily sync) | M07 | |
| T9 | **Langfuse:** a project and API keys | M06 | |
| T10 | **Dashboard hosting and Cloudflare:** decide D-050; set up a Cloudflare-managed domain and an Access application (and a Tunnel, if hosting on the SER9) | M10 | |
| T11 | **Google conversions:** enable the Data Manager API in the GCP project; create "import from clicks" conversion actions for the feedback stages; turn on auto-tagging | M13 | |
| T12 | **Property (when it resumes):** hidden fields on the Tally form for click IDs, platform IDs and `utm_*` | Property go-live | |
| T13 | **Property required elements:** exact registered name, CEA registration number, agency name, licence number, plus any banned phrases | M15 (property rules) | Low urgency while on hold |
