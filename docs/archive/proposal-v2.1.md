# Ads Agent — Proposal v2

**Status:** v2.1 — decisions resolved 2026-09-14
**Date:** 2026-09-14 (supersedes v1, 2026-08-24)
**Owner:** Marcus
**Next artefact:** `BLUEPRINT.md` (attached as a separate file; inherits every decision here)

---

## 0. What changed from v1

| # | v1 said | v2 says | Why |
|---|---|---|---|
| C1 | Property-only. "The seam exists; the second pack does not." | **Product-agnostic core + two product packs from day one:** `property-sg` and `saas-snappool`. | You now have a second product with real spend intent. A seam with one implementation is untested; with two it's a real interface. SnapPool is also the cheapest possible second pack — no compliance regime, short conversion cycle. |
| C2 | Scheduling on n8n ("you already run it") | **No n8n.** Worker process on the SER9 (systemd + in-process cron). | You don't run n8n and aren't familiar with it. One language, one deploy target, no untestable orchestration layer. |
| C3 | Google reads via official MCP, deterministic sync through it | **Deterministic sync via typed API clients for both platforms.** Official MCPs (Google + Meta) become *exploratory read tools for the model* during analysis only. | The Read stage is deterministic code; routing it through an MCP server that only wraps GAQL adds a Python sidecar and no safety. MCP earns its place where the model does ad-hoc drill-down. |
| C4 | LiteLLM self-hosted as model gateway | **Vercel AI SDK provider abstraction in-process**, Langfuse for cost/traces. LiteLLM optional later. | Same "model is an env var" property (G6) with one fewer service on the SER9. Structured outputs via zod schemas are the bigger reliability win. |
| C5 | Outcomes wired back for *reporting* | **Outcomes fed back to the platforms** as offline conversions (Google OCI / Enhanced Conversions for Leads, Meta Conversions API). Allowlisted write, low risk. | The platforms optimise to what you feed them. Feeding "qualified viewing" or "paid event" instead of "form fill" is the biggest lever in the whole system. |
| C6 | Proposals applied when approved | **Precondition check at apply time**: gateway re-reads the target, compares to the snapshot the proposal was drafted against, rejects on drift. | A Monday proposal must not apply to a Friday account. This was missing entirely. |
| C7 | Findings from model reasoning | **Evidence thresholds before a finding is valid** (min impressions / clicks / spend / days). Pack-configurable. | Without this the agent proposes noise-driven pauses. Deterministic gate, not prompt guidance. |
| C8 | Eval harness deferred indefinitely | **Replay-fixture eval from Phase 1** (cheap, built on agree/disagree data). Formal harness Phase 5. | Product-agnostic + model-swappable means regressions are inevitable; you need a gate for "did swapping the model or editing a pack make proposals worse". |
| C9 | Compliance lint = CEA rules | **Two check layers:** platform format check (core) + operator-authored required-content / no-new-claims check (per product). See C13 for the responsibility split. | Platform rules are product-agnostic and were unaddressed. |
| C10 | Approval UI on Vercel, Telegram for notify | **Two surfaces, one set of rows.** Telegram is the *operational* surface: proposal cards, on-the-fly pause/undo/budget, halt, concise daily digest while ads are running. The web app is the *dashboard + settings* surface: spend vs ceilings, KPI trends, change log, brief archive, and every per-product setting (ceilings, outcome tiers, required strings, source copy, fact base). Both write the same DB rows; neither holds platform credentials. | You act from the phone; you configure and review from a screen. Settings scattered across bot menus don't scale to more products. |
| C11 | — | **Meta's MCP server rules** (Jul 2026) used as a second, platform-side lock on the Meta account: deny all writes from the MCP connection. | Free belt-and-braces. Your gateway is the only write path either way. |
| C13 | Agent generates "CEA-compliant copy" | **Agent is not the content authority.** Operator supplies base copy, required elements and facts; agent drafts *variants* only; "lint" = mechanical required-content / no-new-claims check. Correctness of advertised content is the operator's responsibility. | Marcus's call, 2026-09-14. Keeps the licensed party as the source of truth and keeps the agent out of regulatory judgement. |
| C14 | Objective + outcome stages hard-coded in the pack | **Per-product `outcome_config`** in the DB (stages, success tiers, primary KPI), editable without a deploy; pack supplies the *adapter* and defaults only. Property: contact-form fill = success. SnapPool: signup = success, paid = hard success. | "Every product CTA is different" — must be adjustable per product. |
| C15 | Property is the pilot; SnapPool near-zero spend | **SnapPool first.** Property pipeline is on hold; Phase 0–1 validate on SnapPool's soft-launch spend. Property pack is still built (it's the seam test) but validated on fixtures until spend resumes. Sora at Lakeside stays as the seed project. | Marcus's priority, 2026-09-14. |
| C16 | Spend ceilings assumed known | **Ceilings are settings**, editable in the web app; budget actions are blocked by the gateway until a product's ceilings are set. | Budget to test is unknown for now. |
| C17 | Worker = systemd on the SER9 | **Containerised worker**, Postgres-backed job queue, startup reconciliation, two-phase apply, external dead-man's switch. Runs on the SER9 today; same image on a cloud container runtime tomorrow with no code change. | Self-recovery on restart; path to cloud + multi-tenant. |
| C18 | Write credentials in the worker's env | **Credential vault**: per-account ciphertext under envelope encryption, master key only in the worker trust zone, just-in-time decryption, audited. OAuth connect flow for future tenants. | "Local" doesn't scale to many users; "trust zone" does. |
| C19 | Stage 6 "Learn" | Renamed **"Record & feed back"** + a plain statement of what improves over time and what does not (§4.1). | The model does not learn between cycles. The docs shouldn't imply it does. |
| C12 | — | **Prompt-injection posture:** search terms, placement names, competitor ad text are untrusted input. Structured outputs only; no free-text instruction from platform data into prompts. | Real attack surface once the agent reads search-term reports. |

Everything else in v1 — the premise, the supervised-hand framing, the five-layer safety model, structured Postgres over vector memory, the phase gates — stands. Sections below are the full v2 text so the blueprint has a single source.

---

## 1. Premise

The connector layer is commoditised. Google's official MCP (read-only, 3 tools) and Meta's hosted ads MCP (write-capable, with account-level rules since July 2026) both exist and are free. A product whose value is "connect an LLM to an ad account" is built on disappearing ground.

What does not commoditise is **judgment inside a product context**: what a good SG new-launch condo campaign looks like and what CEA requires; what a real SnapPool customer looks like versus a curious click. That judgment is encoded in a **product pack**. The core is the same for every pack.

So the system is:

- **Core (portable, product-agnostic)** — connectors, state, analysis loop, guardrails, approval, audit, eval. Knows nothing about property or SaaS.
- **Product packs (the moat, one per product)** — objectives, outcome definition, lifecycle phases, fact base schema, operator-authored copy checks, tighter guard overrides.

Rule: **the core never imports a pack; a pack never touches a platform.** If a feature needs to know it's property, it belongs in the pack. If a pack needs to call Google, the abstraction is wrong.

### 1.1 The two packs, and why they're a good pair

| | `property-sg` | `saas-snappool` |
|---|---|---|
| Success (per `outcome_config`) | **Contact-form fill** = success; qualified viewing / booking as harder tiers if the pipeline records them | **Signup** = success; **paid** (subscription or one-off) = hard success. Tiers editable per product |
| Outcome source | Tally → Airtable (existing pipeline) | SnapPool's own Neon DB (signups, events, uploads, payments) |
| Conversion cycle | Days–weeks, high value, low volume | Minutes–days, low value, higher volume |
| Lifecycle | Launch phases: teaser → VVIP → booking → clearing | Soft launch (free, watermarked) → paid → seasonal (wedding/year-end) |
| Fact base | Project facts: district, MRT, PSF band, unit mix, TOP | Product facts: features, plan limits, pricing, supported event types |
| Compliance | CEA (agent name, reg no., licence no., claims, price rules) — **you are the licensed party** | Ad-platform policy only; claims must match product truth; PDPA/privacy phrasing for photo handling |
| Platforms | Google Search primary, Meta secondary | Meta/Instagram primary, Google Search secondary, TikTok later |
| Spend | **On hold** — pipeline paused; validated on fixtures until it resumes | Small soft-launch spend, ceilings TBD (settings, not code) |
| Priority | Second | **First** — Phase 0–1 are validated here |

They differ on every axis that matters, which is what makes them a good test of the seam. If both packs fit the same `ProductPack` interface without core special-casing, the core is product-agnostic. If they don't, you'll find out in Phase 0, not after a third product.

---

## 2. Goals

### Primary objective

Reduce manual ad-ops load across all of Marcus's products while **never** allowing an autonomous action to move money in a way he did not explicitly approve.

The agent is an **analyst with a supervised hand**, not an autonomous media buyer. That framing is the whole design.

### Concrete goals

| # | Goal | Success signal |
|---|---|---|
| G1 | Weekly account review becomes a generated brief, per product | Brief produced unattended; you read it instead of opening Ads Manager |
| G2 | Waste surfaced unprompted (dud keywords, dead ad sets, mis-paced budgets) | Findings appear before you'd have noticed manually |
| G3 | Every finding becomes a reviewable, executable proposal | Approve/reject in under 60s per item, on mobile |
| G4 | Approved changes executed correctly, reversibly, with full audit trail | Any applied change reversible by ID; zero silent mutations |
| G5 | Drafted copy variants keep every operator-supplied required element and introduce no claim outside the operator's fact base | A variant cannot reach a draft without passing the required-content and no-new-claims checks; the agent never authors claims |
| G6 | Model choice is a config change | Swap model via env var; eval harness confirms no regression |
| G7 | Performance tied to *product-configured outcomes*, not platform conversions | Cost-per-outcome visible per campaign; outcomes fed back to platforms |
| G8 | **Adding a product is a pack, not a fork** | `saas-snappool` added with zero changes to `packages/core` |

### Non-goals (scope discipline)

- **Not** an autonomous media buyer. No unattended live budget changes.
- **Not** multi-tenant *yet*. One operator, own accounts. No billing, no orgs, no RBAC. *But* it is multi-tenant-ready: every table keyed by `product_id`, credentials vaulted per account, worker containerised and queue-driven, so adding tenants is a `tenants` table and a filter — not a rewrite.
- **Not** a creative studio. Copy generation yes; image/video generation no.
- **Not** an MCP server. This is a client and a control plane.
- **Not** a public product yet. Product-shaped seams, internal-only deployment. The dashboard is single-operator behind Cloudflare Access, but every screen is scoped by `product_id` so a per-user scope is a filter change later, not a rewrite.
- **Not** a third pack. Two is enough to prove the interface.
- **Not** the content authority. The agent does not decide what a compliant ad is; it checks that variants preserve what you supplied.

---

## 3. The architectural constraint that shapes everything

| | Google Ads | Meta Ads |
|---|---|---|
| Official MCP | `googleads/google-ads-mcp`, Apache-2.0, self-hosted, **read-only** (3 tools) — still true as of Aug 2026 | `mcp.facebook.com/ads`, hosted, OAuth, **write-capable**; since Jul 2026 supports own-developer-app auth and **account-level "MCP server rules"** governing what agents may do |
| Write path | Google Ads API only (REST/gRPC), yours to build | Marketing API (Graph) or MCP |
| Dry-run | `validate_only=true` on mutate — real server-side validation | No general dry-run; mitigate with create-paused + read-back verification |
| Auth | Developer token + GCP project + OAuth | Business Suite OAuth / system-user token |
| Release cadence | Monthly since Jan 2026; majors ~3–4/yr, ~12-month support. v25.1 current (Aug 2026) | Rolling |

**Consequence:** one uniform connector abstraction that "just works" doesn't exist. Design:

```
Deterministic sync (Read stage):   Google API client  |  Meta Marketing API client   → Postgres
Model exploration (Analyse stage): Google MCP (ro)    |  Meta MCP (rules: deny writes) → read tools only
All writes (Apply stage):          Execution Gateway → Google mutate (validate_only first) | Meta Graph API
```

> **Design rule #1:** No component may call a platform write path except the Execution Gateway. Enforced by package boundaries (write clients live in `internal/write` entrypoints importable only by `@ads/gateway`, eslint `no-restricted-imports`), by credentials (write tokens exist only in the worker's environment), and on Meta additionally by MCP server rules denying writes from the MCP connection.

> **Design rule #2:** The core never imports a pack. Packs are loaded by ID from a registry at runtime and are validated against the `ProductPack` zod schema on load.

---

## 4. System architecture

```
   ┌────────────────────────────────────────┐   ┌────────────────────────────────────────┐
   │ TELEGRAM — operational (grammY, worker)│   │ DASHBOARD — Next.js on Vercel,          │
   │ proposal cards: approve / reject / edit│   │ behind Cloudflare Access                │
   │ on the fly: /pause /pause-all /undo    │   │ per product: spend vs ceilings, KPI     │
   │            /budget                     │   │ trends, trust, open proposals, change   │
   │ agent: /halt /resume-agent /status     │   │ log, drift, brief archive               │
   │ daily digest while ads run; weekly     │   │ SETTINGS: ceilings, trust floor, outcome│
   │ brief; alerts                          │   │ tiers/KPI, digest mode, required strings│
   │ quick settings: ceilings only          │   │ banned phrases, source copy, fact base  │
   └──────────────────┬─────────────────────┘   └──────────────────┬─────────────────────┘
                      │  both write ONLY: approvals, operator proposals, settings (+audit),   │
                      │  products.status — never a platform call, never a credential         │
                      └──────────────────────────────┬───────────────────────────────────────┘
                                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  WORKER (SER9, systemd, TypeScript)                                        │
│                                                                            │
│  cron ──▶ CYCLE: trust gate → read/sync → analyse → draft → brief          │
│                        │           │          │         │                  │
│                        ▼           ▼          ▼         ▼                  │
│                  trust_signals  campaigns   findings  proposals             │
│                                 metrics_daily         (payload+reversal+   │
│                                 entity_snapshots       precondition hash)  │
│                                                                            │
│  cron ──▶ APPLY: pull approved proposals ──▶ EXECUTION GATEWAY             │
│                                               allowlist → pack overrides   │
│                                               → magnitude/cooldown guards  │
│                                               → precondition re-read       │
│                                               → dry-run → apply            │
│                                               → read-back verify           │
│                                               → reversal registry          │
│                                               → change_log                 │
│                                                        │                   │
│  PACK REGISTRY: property-sg | saas-snappool            ▼                   │
│  (objectives, outcomes, lifecycle, facts,     Google Ads API (mutate)      │
│   copy checks, guard overrides)              Meta Marketing API           │
│                                                                            │
│  MODEL LAYER: Vercel AI SDK (model = env var) ──▶ Langfuse (traces, cost,  │
│               structured outputs (zod)             datasets, evals)        │
│               MCP read tools for analyst: google-ads-mcp, mcp.facebook.com │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │
                                    ▼
                 ┌──────────────────────────────────────────────┐
                 │  Neon Postgres (Drizzle) — single DB,        │
                 │  every table scoped by product_id            │
                 └──────────────────────────────────────────────┘

  OUTCOME ADAPTERS (per pack):  Airtable (property leads)  |  SnapPool Neon (signups/events/payments)
  OUTCOME FEEDBACK (core):      Google offline conversions  |  Meta Conversions API
```

### The six-stage cycle

Every cycle, every product, same sequence, no stage skipped.

**0. Trust gate.** Is the data good enough to act on? Conversion tracking firing, attribution gap within tolerance, outcome adapter reachable and recent, platform metrics not restating wildly. Below threshold → the cycle produces a *diagnostic brief only*. No findings, no proposals.

**1. Read / sync.** Typed API clients pull account structure and a trailing metrics window (default 28 days, upserted — platforms restate conversions for days). Snapshot every entity we might act on. Reconcile with state store: anything changed outside the system (Ads Manager edits, platform auto-adjust) is surfaced as drift, never overwritten silently.

**2. Analyse.** Model reasons over reconciled state + pack context + change history + outcomes. Read-only; may call MCP read tools for drill-down within a per-cycle tool-call budget. Output is a **structured list of findings** (zod schema), each with evidence references. A finding whose evidence fails the pack's thresholds is dropped *before* the model sees it again — deterministic, not prompted.

**3. Draft.** Each surviving finding becomes a proposal: what, why, expected effect, exact executable payload, exact reversal payload, precondition hash (snapshot of target), evidence refs. Durable row, diffable, reviewable on your schedule.

**4. Approve.** Human decision in Telegram: approve / reject / edit-and-approve, bound to the proposal's version hash. Rejection reasons are captured — they become eval data.

**Operator-initiated actions** (`/pause`, `/pause-all`, `/budget`, `/undo`) are the same thing from the other direction: the command *creates* a proposal (with snapshot, reversal, precondition), the confirm tap is its approval, and it enters stage 5 like any other. There is no second write path for humans.

**Halt** (`/halt <product>|all`) is different: it sets `products.status = 'halted'` and the worker skips cycles and the apply loop for that product. It stops the agent, not the ads.

**5. Apply.** Gateway pipeline (§5). Never invoked by the model. Never invoked by the web app.

**6. Record & feed back.** Outcome adapters pull new outcomes; core attributes them to campaigns via click IDs; feeds them back to platforms (offline conversion upload, allowlisted write); records proposal → outcome deltas and the decision memory the next analysis will read.

### 4.1 What "learning" means here — and what it doesn't

The model does not learn. Every cycle is a fresh prompt; no weights change. What improves over time, most trustworthy first:

1. **The platforms learn.** Offline-conversion feedback (stage 6) trains Google's and Meta's bidding on *your* success definition. This is genuine adaptive optimisation and works regardless of the LLM.
2. **The deterministic layer learns.** Thresholds, cooldowns, attribution and pacing read from a growing record. More data → fewer noise-driven findings. No model involved.
3. **The prompt remembers.** `AnalystInput` carries *decision memory*: recent rejections per finding type with reasons, outcome deltas of past applied changes, `LEARNINGS.md`. This is retrieval, not learning — it stops the model repeating mistakes it can see, within a context budget, and it can over-index on examples. Treat it as steering.
4. **You learn, via evals.** Agree/disagree rate and outcome deltas per finding type show which types to trust; you tune thresholds, prompts and pack content. The human is the learning loop.

Later and deferred: a deterministic *policy adjuster* that proposes threshold changes from outcome deltas (human-approved, like any proposal). Fine-tuning on (input → accepted finding) pairs needs volume a single operator won't produce; it becomes plausible only with tenants.

Honest framing for the pitch: *the LLM is a reasoning engine over an improving record, not a learner.* The system gets better because the record, the platforms, and your rules get better.

---

## 5. Safety model (concrete)

Seven independent layers. Each alone is insufficient.

### 5.1 Action allowlist (core; packs may only *remove* actions, never add)

| Action | v1 | Rationale |
|---|---|---|
| Add negative keyword | Allowed | Reduces spend, near-zero downside |
| Pause keyword / ad group / ad set / ad | Allowed | Reduces spend, reversible |
| Upload offline conversion / CAPI event | Allowed | Feeds the optimiser; doesn't move spend directly |
| Adjust campaign daily budget | Allowed, **guarded** (Phase 3) | The main lever; magnitude-limited |
| Create campaign / ad set / ad | Allowed, **paused-only** (Phase 3) | Created disabled; enabling is a separate human act in Ads Manager |
| Enable a paused entity | **Blocked** | Only a human enables spend |
| Bid strategy / target CPA change | **Blocked** | High blast radius, poorly reversible |
| Edit live ad creative | **Blocked** | Policy + compliance risk |
| Audience / targeting change | **Blocked** in v1 | Revisit after Phase 3 data |
| Any delete / remove | **Blocked** | Irreversible |

Enforced as a typed config in the gateway. Not prompt text.

### 5.2 Magnitude guards (core defaults; packs override tighter)

- Max ±30% per budget action; min meaningful delta (≥ SGD 5 or ≥ 5%, whichever larger)
- 7-day cooldown per entity per action type
- Budget-neutral by default within a product: increases offset by decreases unless flagged `net_increase`
- Per-product daily and monthly spend ceilings (hard stop, from `products.spend_limits`)
- Max N applied changes per product per day

### 5.3 Evidence thresholds (new)

A finding is invalid unless its evidence meets pack thresholds, e.g. `property-sg`: ≥ 500 impressions AND ≥ 30 clicks AND ≥ 7 days before "pause keyword"; `saas-snappool`: lower click floors, higher day floors during soft launch. Enforced in core, configured in pack.

### 5.4 Precondition at apply (new)

Gateway re-reads the target entity, hashes the fields the proposal depends on, compares to the hash stored at draft time. Mismatch → `precondition_failed`, proposal returns to review with the diff shown. No stale applies.

### 5.5 Dry-run enforced

Google: every mutate runs with `validate_only=true` first; the committed request is byte-identical. Meta: no server-side dry-run for most operations → the gateway (a) creates paused, (b) reads back immediately and verifies the applied state matches the payload, (c) if not, triggers reversal automatically and flags.

### 5.6 Reversal registry

Prior state captured before any write. Every applied change gets a `revision_id` and a stored reversal payload. `ads revert <revision_id>` works from a cold start with no model in the loop. Built in the gateway session, not retrofitted.

### 5.7 Copy checks — two layers, fail closed, operator-authored

The agent never authors advertising claims. Copy generation means: operator supplies **source copy**, **required elements** (for property: registered name, CEA reg no., agency name, estate agent licence no.; for SnapPool: whatever disclosures Marcus decides), and a **fact base**; the model produces *variants* (rewordings, headline/description splits, length-fitted versions). Two mechanical checks then run:

- **Platform format check (core):** RSA limits (15 headlines ≤ 30 chars, 4 descriptions ≤ 90 chars, punctuation/caps rules), Meta text limits, URL validity, platform banned-word lists.
- **Required-content / no-new-claims check (per product, operator config):** every required string present verbatim; every claim in a variant maps to a fact key in the operator's fact base or appears in the operator's source copy; operator-listed banned phrases absent.

No variant reaches a draft without passing both. What the rules *are* is the operator's decision and responsibility — the system only enforces that drafts don't drift from them. Created ads are always paused; enabling is a human act in Ads Manager.

### 5.8 Untrusted input posture (new)

Search-term reports, placement names, competitor ad text, and user-uploaded outcome notes are **data, never instructions**. They are passed to the model inside typed structures, never interpolated into system prompts, and the model's output is a zod-validated object — a "finding" that says "ignore previous instructions" is a malformed finding and is dropped. The allowlist bounds the blast radius regardless.

---

### 5.9 Telegram command surface (v1)

| Command / button | What it does | Path |
|---|---|---|
| Approve / Reject / Edit (card buttons) | Decide a proposal; reject asks for a reason; edit takes a reply (`budget 45`, `keyword -"free"`) and bumps the version | `approvals` row → apply loop → gateway |
| `/pause <campaign\|adset\|ad>` | Operator pause; shows snapshot, confirm tap | operator proposal → gateway (reversal recorded) |
| `/pause-all <product>` | Pause every active campaign of a product; single confirm | batch of operator proposals |
| `/undo <rev>` | Revert any system-applied change, including your own pauses | gateway `revert` |
| `/budget <campaign> <amount>` (Phase 3) | Operator budget change; same ±30% / ceiling guards as agent proposals | operator proposal → gateway |
| `/halt <product\|all>` / `/resume-agent` | Stop / restart the agent for a product; no ad is touched | `products.status` |
| `/status`, `/proposals`, `/changes`, `/brief [product]`, `/drift` | Read views | DB reads |
| `/ceiling <product> daily\|monthly <amount>` | Emergency-grade quick setting from the phone; everything else lives in the dashboard | settings service (validated, audited) |
| **Daily digest** (automatic, ~6 lines, per product, only while that product has live spend) | Yesterday's spend vs daily ceiling, MTD vs monthly, outcomes by stage, cost per primary KPI, open proposals, anything the trust gate or drift flagged. Silent when nothing is running. Mode per product: `auto` (default) / `always` / `off` | read-only, sent after the daily sync |

Not in v1, deliberately: enabling an entity the agent never paused; deletes; bid strategy; audience changes. Those stay in Ads Manager.

### 5.10 Two-phase apply (crash-safe writes)

The dangerous window is between the platform call and the `change_log` append. So:

1. Gateway sets `proposals.status = 'applying'`, stores `idempotency_key = proposalId:version` and the `before` snapshot **before** calling the platform.
2. Platform call.
3. Read-back verify → `change_log` append → `status = 'applied'`.

On startup (or lease expiry), any proposal in `applying` is reconciled: read the target back; if the intended state is present, finalise as applied; if absent, retry (pauses and budget sets are idempotent in effect; duplicate negative-keyword adds map to "already done"; CAPI dedups on `event_id`). Nothing is ever left half-recorded.

### 5.11 Credential vault (single user now, tenants later)

- `credentials` table: `account_id`, `ciphertext`, `data_key_ciphertext`, `key_version`, `rotated_at`. Envelope encryption: each account's tokens are encrypted with their own data key; data keys are encrypted with a **master key** that exists only in the worker's environment (Doppler `worker` config now; a KMS later). The dashboard and bot tiers never hold it.
- Decryption is just-in-time inside the process that needs it (sync reads the read token; only the gateway module decrypts the write token) and every decryption writes a `credential_access` audit row.
- Tenants connect via OAuth (Google Ads consent, Meta business login); the callback stores the refresh token straight into the vault. Nobody types a token into a form; users revoke from their own platform settings.
- Scopes: Meta splits cleanly (`ads_read` for sync, `ads_management` for gateway — two grants, two rows). **Google Ads OAuth has one scope**, so the read/write split there is enforced by the gateway and package boundaries, not by the token. Say so in the runbook; don't pretend otherwise.
- Serving third-party accounts additionally requires Google Standard Access and Meta app review for `ads_management`. Both are slow; start when tenants are decided, not when they arrive.

## 6. Memory & state

**Structured Postgres, not a semantic memory layer.** Campaign IDs, budgets, timestamps and actions are deterministic queries. Ground truth is re-injected each cycle; nothing depends on context-window recall.

Core tables (all with `product_id`):

```
products            slug, name, pack_id, currency, timezone, spend_limits (jsonb, editable), outcome_config (jsonb, editable), status
accounts            product_id, platform, external_id, credentials_ref, role (read|write), status
campaigns           product_id, account_id, external_id, name, status, budget_micros, phase, entity_ref
ad_groups           campaign_id, external_id, name, status            (Meta: ad sets)
entity_snapshots    product_id, platform, entity_type, external_id, taken_at, snapshot (jsonb), hash
metrics_daily       campaign_id, ad_group_id?, date, impressions, clicks, spend_micros, platform_conv, restated_at
search_terms        ad_group_id, date, term, impressions, clicks, spend_micros, conv         (Google)
entities            product_id, kind, external_key, facts (jsonb, validated by pack schema)  (was: projects)
outcomes            product_id, external_id, click_id, click_platform, stage, value_micros, occurred_at, fed_back_at
cycles              product_id, started_at, finished_at, stage_reached, trust_status, model_cost_micros
findings            cycle_id, type, target_ref, evidence (jsonb), passed_threshold, summary
proposals           product_id, cycle_id, finding_id, action, target_ref, payload, reversal_payload,
                    precondition_hash, rationale, expected_effect, status, version
approvals           proposal_id, proposal_version, decision, actor, channel, reason, decided_at
change_log          proposal_id, revision_id, applied_at, before, after, actor, verified
trust_signals       product_id, account_id, date, tracking_ok, attribution_gap, outcome_adapter_ok, confidence
jobs                kind, product_id, payload, run_at, leased_until, attempts, status          (queue)
credentials         account_id, ciphertext, data_key_ciphertext, key_version, rotated_at    (vault, §5.11)
credential_access   credential_id, accessed_at, by_module, purpose                          (audit)
drift_events        product_id, entity_ref, detected_at, field, expected, observed, acknowledged_at
```

Alongside, per product, three markdown files read into context each cycle, edited by you:

- `products/<slug>/STRATEGY.md` — standing objectives, budget philosophy, what you will and won't do
- `products/<slug>/PLAYBOOK.md` — the pack's human-readable playbook (the pack code is the enforced version)
- `products/<slug>/LEARNINGS.md` — what actually worked, appended after outcomes are known

---

## 7. The product pack interface

This is the seam. Two things live in different places on purpose:

- **Per-product config (DB, editable in the web app, no deploy):** `outcome_config` — the outcome stages, which are "success" vs "hard success", which is the primary KPI, optional value per stage — and `spend_limits`. Every product's CTA is different; this is where that difference lives.
- **Pack (code):** *where* outcomes come from (the adapter), lifecycle phases, fact schema, evidence thresholds, copy guidance, tighter guard overrides, analyst context, and **defaults** for `outcome_config` used when a product is created.

```ts
interface OutcomeConfig {                    // stored in products.outcome_config
  stages: { id: string; label: string; tier: 'soft' | 'success' | 'hard'; valueMicros?: bigint }[];
  primaryKpi: { stage: string; direction: 'lower_is_better' };   // cost per <stage>
  feedbackStage: string;                     // which stage is uploaded to platforms as the conversion
}

interface ProductPack {
  id: 'property-sg' | 'saas-snappool' | string;
  version: string;
  outcomes:      { adapter: OutcomeAdapter; defaults: OutcomeConfig };   // fetchSince(ts) → OutcomeEvent[] with click IDs
  lifecycle:     { phases: PhaseSpec[]; detect(ctx): PhaseId };
  facts:         { schema: ZodSchema; requiredForCopy: string[] };
  thresholds:    EvidenceThresholds;        // per finding type
  copyChecks:    { requiredStrings: string[]; bannedPhrases: string[] }; // operator-authored; defaults only, overridable per product
  copy:          { tone: string };
  guardOverrides?: Partial<GuardConfig>;    // may only tighten core defaults (enforced)
  analystContext: string;
  briefSections?: BriefSectionSpec[];
}
```

Defaults: `property-sg` → stages `form_fill (success)`, `qualified_viewing (hard)`, `booked (hard)`, primary = cost per `form_fill`, feedback = `form_fill`. `saas-snappool` → `signup (success)`, `activated (success)`, `paid (hard)`, primary = cost per `signup` during soft launch, switchable to `paid` from the settings screen.

## 8. Tech stack

| Layer | Choice | Rationale | Rejected / deferred |
|---|---|---|---|
| Language | **TypeScript, Node 22 LTS** | Vercel target for the web app; AI SDK + Drizzle + zod are TS-first; guards must be typed and unit-tested; matches SnapPool's stack | Python — fine for the loop, worse for UI/edge and splits the codebase. C#/.NET — your strength, ecosystem mismatch |
| Repo | **pnpm workspaces + Turborepo monorepo** | Product-agnostic needs *enforced* package boundaries: `core`, `gateway`, `connector-google`, `connector-meta`, `pack-sdk`, `packs/*`, `apps/worker`, `apps/web` | Single package — boundaries become conventions, and conventions erode |
| Agent loop | **Custom TS** | Small loop (trust/read/analyse/draft). Guardrails are plain testable code | LangGraph / CrewAI — overweight, and hide the guard path |
| Model access | **Vercel AI SDK** (`ai` + provider packages, incl. `openai-compatible` for local vLLM/NIM) with `generateObject` + zod | Model as env var, in-process, no proxy hop; structured outputs are the reliability win | LiteLLM — keep as optional proxy if you later want spend caps across many keys. Claude Agent SDK — locks G6 to one vendor |
| Model routing | Cheap model for analysis; frontier for multi-step draft synthesis and copy; both env-configurable per stage | Cheap models match frontier on single-turn tool calls; gap is long-chain coherence | Single model — overpays or underperforms |
| Database | **Neon Postgres + Drizzle** | Typed schema, migrations, same platform as SnapPool (separate project) | Airtable as system of record — stays as a *source* for property outcomes only |
| Google reads | **Direct Google Ads API** via a maintained TS client (`google-ads-api`, verify it tracks v25; else typed REST + GAQL) | Deterministic sync; one auth path for read and write | Official MCP for sync — a Python sidecar to wrap GAQL, no gain |
| Google writes | Same client, `validate_only` first, wrapped by the gateway | Owning the write path = owning the guards | Third-party hosted write MCPs — someone else's backend in the money path |
| Meta reads/writes | **Direct Marketing API** (Graph) with system-user token, scoped `ads_read` for sync, `ads_management` only in gateway env | Typed, no MCP client in the money path | Community Meta MCP servers |
| MCP (model-side) | **Official Google MCP (ro) + official Meta MCP with rules = deny writes**, exposed to the analyst only, per-cycle tool-call budget | Where MCP earns its place: ad-hoc drill-down by the model | MCP in the deterministic sync path |
| TikTok | **Deferred**, but the connector interface is designed so it's a third `connector-*` package | Matters for SnapPool eventually, not now | — |
| Worker runtime | **Docker image**, `docker compose` on the SER9 with `restart: unless-stopped` today; same image on Fly.io / Cloud Run / Cloudflare Containers later. Config from env + Postgres only, no local state | Portability and restart safety without a second codebase | systemd bare process (fine, but not portable); **Cloudflare Workers for the loop** — wrong runtime for multi-minute cycles, child processes and DB pools (right for the dashboard edge) |
| Scheduling + queue | **Postgres-backed `jobs` table** (`FOR UPDATE SKIP LOCKED`, leases, retries with backoff); `croner` in one replica enqueues, any replica works. `cycles` + advisory locks for idempotency | Scale-out = more replicas; no broker to run | n8n; Vercel cron; Redis/BullMQ (another service) |
| Crash recovery | **Startup reconciliation**: resume cycles with `finished_at IS NULL` from `stage_reached`, expire stale leases, finalise or retry `applying` proposals (two-phase apply, §5.10); **external dead-man's switch** (healthchecks.io ping after each daily sync) | The bot can't tell you the host is down | Relying on Telegram alerts alone |
| Credentials | **Vault table** with envelope encryption (§5.11): per-account data key, master key only in the worker trust zone (env / KMS), decrypt just-in-time in memory, audited; OAuth connect flow for tenants | Same posture for one user or a thousand | Raw tokens in env (v1); secrets in the dashboard tier |
| Operational surface | **Telegram bot (grammY) inside the worker** — proposal cards, on-the-fly pause/undo/budget, halt, status, daily digest while ads run, weekly brief, alerts; single chat-id allowlist; every action re-validates version + expiry and needs a confirm tap | Doing settings in bot menus — fine for ceilings in an emergency, wrong for everything else |
| Dashboard + settings | **Next.js on Vercel behind Cloudflare Access** (decided); JWT verified in middleware; DB role limited to `approvals` insert + settings columns; every setting change audited | Public web surface with write credentials; settings in code | Mobile approval < 60s is the UX requirement; app never holds platform credentials | Email-only; web app that executes writes |
| Notifications | Same bot: briefs, new-proposal cards, alerts (trust, drift, applied, precondition/verify failures, halts) | One channel | Email |
| Secrets (operational) | **Doppler** (`worker`, `web`): DB URLs, bot token, Langfuse keys, and the **vault master key** in `worker` only | One source, scoped per runtime; platform tokens are *not* here — they're in the vault | Shared `.env` across runtimes |
| Observability | **Langfuse** (cloud free tier or self-host on SER9) via OTel from the AI SDK; datasets + evals for the harness | Debug a bad proposal after the fact; cost per product; eval home | console.log |
| Testing | **Vitest + fast-check** (property tests on guards) + recorded API fixtures + Google test account | Guards are the product; they get the strongest tests | — |
| Dev env | Claude Code on the SER9, dual-CLAUDE.md, gh CLI | Existing | — |

### Operational constraints

- **Google Ads API cadence:** monthly minors, ~3–4 majors/yr, ~12-month support. Pin the version; calendar a quarterly upgrade check; integration test on the test account.
- **Basic Access quota: 15,000 ops/day per developer token.** A GAQL query is one op. Daily sync × 2 products × entity types + model drill-down will approach it. Cache in the state store; the analyst's MCP budget counts against it.
- **Developer token / Meta app review** are gates. Basic Access is fine for own accounts. Productising (other people's accounts) needs Standard Access + Meta app review — start early if that's ever the plan.
- **Metrics restatement:** platforms restate conversions for up to ~7 days (Meta attribution windows, Google conversion lag). Sync re-pulls a trailing 28-day window and upserts; never treat yesterday as final.
- **Currency/timezone:** SGD, `Asia/Singapore`, Google micros everywhere internally. Product-level config so a future USD product doesn't need a rewrite.
- **Meta has no sandbox with real delivery.** Test the Meta write adapter on a real account with paused-only creates and a SGD 1 daily budget test campaign.

---

## 9. Phasing

Each phase has a stop condition. **SnapPool is the validation product** — property is on hold, so its pack is built and tested on fixtures, and the seam (G8) is proven in the other direction: the property pack must load and pass tests with zero core changes. Both packs are registered from Phase 0.

Because SnapPool's soft-launch spend is small, run a small always-on Meta campaign (whatever ceiling you set) from Phase 0 — it's both the launch traffic and the signal the agent needs. Evidence thresholds will keep the agent brief-only until volume exists; that's correct behaviour, not a bug.

**Phase 0 — Read-only, both products (S00–S07)**
Typed sync for Meta + Google → Postgres → trust gate → analysis with evidence thresholds → weekly brief per product to Telegram. No write code exists.
*Stop condition:* the SnapPool brief tells you something about the soft-launch campaign you'd have missed, in two of the first four weeks, **and** the property pack loads against Sora at Lakeside fixtures with zero core changes.

**Phase 1 — Proposals + approval, zero execution (S08–S10)**
Findings become proposals with payload/reversal/precondition. Telegram cards with approve/reject/edit; `/pause` and `/undo` land here too (as proposals you apply manually in Phase 1, executed by the gateway from Phase 2). You apply approved ones manually. Agree/disagree tracked; rejections become replay-eval fixtures.
*Stop condition:* ≥ 70% agree rate over 3 weeks on SnapPool proposals, with at least 15 proposals in the sample. If volume is too low to reach 15, raise the campaign ceiling or extend the window — do not lower the bar.

**Phase 2 — Gateway, low-risk writes (S11–S13)**
Allowlist, guards, precondition, dry-run/read-back, reversal registry, revert CLI. First live writes: pauses, negative keywords (Google), outcome feedback (Meta CAPI first, Google OCI second). No budget changes.
*Stop condition:* 20 applied changes with zero precondition/verify failures and one successful cold-start revert drill.

**Phase 3 — Guarded budget writes + create-paused (S14)**
Budget adjustments within magnitude guards, budget-neutral batching, monthly pacing against the ceilings you set in settings. Gateway refuses budget actions for any product whose ceilings are unset.
*Stop condition:* 4 weeks with no guard bypass and no manual reversal needed.

**Phase 4 — Copy variants + checks (S15)**
Platform format check + operator-authored required-content / no-new-claims check + variant generation from operator source copy. SnapPool rules first; property rules entered as config from the elements you listed, exercised on fixtures.
*Stop condition:* SnapPool variants pass checks and land as paused creates; a variant with a dropped required string is blocked.

**Phase 5 — Eval harness + ops hardening (S16)**

**When property resumes:** no new phase — set its ceilings in settings, un-pause the accounts, and it enters the same loop. That's the point of G8.

**Deferred:** multi-tenant, billing, TikTok connector, third pack, image/video creative, targeting changes.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Model proposes confidently wrong changes | Evidence thresholds (deterministic) + Phase 1 agree/disagree gate before any write path |
| Stale proposal applied to changed account | Precondition hash re-check at apply; drift → back to review |
| Meta's write-capable MCP bypasses gateway | Meta MCP rules = deny writes; gateway is the only holder of `ads_management` token; package boundaries lint-enforced |
| Telegram account compromised | Bot holds no platform credentials; chat-id allowlist; worst case is a pause or a halt — no command can enable spend the agent didn't itself pause (`/undo` only reverts system changes); budget commands bounded by the same magnitude guards |
| Prompt injection via search terms / competitor copy | Structured I/O only; untrusted text never enters system prompts; allowlist bounds blast radius |
| Google API breaking change | Version pin + quarterly upgrade check + integration test on test account |
| Drafted variant drops a required element or invents a claim | Fail-closed required-content / no-new-claims check, rules authored by you; variants only from your source copy; created ads always paused |
| Noise-driven proposals during SnapPool's low-volume launch | Evidence thresholds keep the agent brief-only until volume exists; Phase 1 sample-size floor (15 proposals) is a hard gate |
| Phase 1 stalls for lack of volume | Small always-on Meta campaign from Phase 0; extend the window rather than lower the bar |
| Second pack forces core special-cases | G8 is an explicit gate: pack added with zero core changes, or the interface is wrong and gets fixed in core |
| Over-building before validation | Phase stop conditions above |
| SER9 outage / restart mid-cycle | Containerised worker with restart policy; startup reconciliation; two-phase apply; external dead-man's switch; nothing stateful on disk |
| Expecting the model to "learn" the account | §4.1 — improvement comes from platform feedback, the growing record, decision memory, and eval-driven tuning; not from the model |
| Agent LLM cost creep | Per-product cost in Langfuse; per-cycle tool-call budget; cheap model for analysis |

---

## 11. Decisions log and remaining setup

Resolved 2026-09-14:

| Question | Decision |
|---|---|
| Product intent | Two products, `product_id` seam everywhere |
| Orchestration | Worker on the SER9; no n8n |
| Platform scope | Both from Phase 0; Meta built first (SnapPool's primary channel) |
| Control surfaces | Telegram = operational (cards, on-the-fly control, daily digest, brief, alerts); web dashboard behind Cloudflare Access = settings + review. Same rows underneath |
| Content responsibility | Operator authors copy, required elements and facts; agent drafts variants and enforces checks only |
| Outcome definition | Per-product `outcome_config`, editable; property = form fill; SnapPool = signup, paid = hard |
| Spend ceilings | Settings, editable in web app; budget writes blocked until set |
| Pilot | SnapPool first; Sora at Lakeside seeds the property pack on fixtures |

Setup tasks that block sessions (Marcus, outside Claude Code):

1. **Meta** (blocks S02): create a Meta developer app with the Marketing API product; in Business Settings create two system users — `ads-agent-read` (`ads_read`, "View performance" on the SnapPool ad account) and `ads-agent-write` (`ads_management`, "Manage campaigns"); generate both tokens into Doppler. Apply the Meta MCP server rules (deny all writes) once the MCP connection exists.
2. **Google** (blocks S03; ~days of lead time): create a Manager Account (MCC), link the existing property account and a new SnapPool account under it; apply for a developer token in the MCC's API Center (Test Access is granted immediately; apply for Basic Access to reach real accounts); create a separate *test* manager account with a test client account for S13's integration suite.
3. **SnapPool schema** (blocks S05): table/column names for signups, events, uploads, subscriptions and one-off payments in the SnapPool Neon DB, plus a read-only connection string.
4. **Property required elements** (blocks S15, low urgency while on hold): the exact strings — registered name, CEA reg no., agency name, estate agent licence no. — and any banned phrases.

## 12. What happens next

`BLUEPRINT.md` — repo structure, schema DDL, interface contracts (`ProductPack`, `PlatformConnector`, `ExecutionGateway`), test requirements per guard, and a session-by-session decomposition sized for Claude Code Opus at 400–600k tokens per session including tests, review and fixes.
