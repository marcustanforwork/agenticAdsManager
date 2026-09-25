# What changed from v2 to v3, and why

| | |
|---|---|
| **Date** | 2026-09-25 |
| **Reviewed** | `docs/archive/proposal-v2.1.md` and `docs/archive/blueprint-v2.1.md` (both generated on 2026-09-14) |
| **Result** | `docs/plan/PROPOSAL.md` and `docs/plan/BLUEPRINT.md`, v3.0; updated to v3.1 (§H) and v3.2 (§I) the same day after Marcus's replies |
| **Method** | Read both documents in full. Checked every mechanism for "what happens if…", cross-checked the two documents against each other, and re-checked external facts against current sources (2026-09-25). |

**Headline.** The v2 design is sound, and its core ideas stay:
- the supervised hand;
- the pack seam;
- phase gates;
- layered safety;
- Postgres as the only memory;
- SnapPool first.

The review found:
- **5 problems that would have caused real harm or blocked a milestone**: AI-supplied evidence numbers, halt blocking emergency pauses, ceilings described as a hard stop, a missing undo action, and the Google conversion-upload path that no longer exists for new developers;
- **several things that would not have worked as written**, mostly around attribution, the dashboard and the database;
- **about 15 contradictions and stale references**;
- **a dozen outdated external facts**.

It also adds the **session memory system, git workflow and skills** that make the build continuable across sessions.

**Where your OK is needed:** items marked **(needs OK)** are recommendations that change or extend one of your earlier decisions. They are collected at the end (§G), and in `docs/memory/QUESTIONS.md` Q1. Everything else fixes errors, and counts as adopted unless you object.

Severity: **Critical** = would cause wrong changes, money loss, or a blocked milestone · **Important** = would break or confuse a component · **Minor** = inconsistency or tidy-up.

---

## A. Safety and correctness

| # | Severity | What was wrong in v2 | What v3 does | Where |
|---|---|---|---|---|
| A1 | Critical | Evidence thresholds were checked against numbers **the AI wrote** (`Finding.evidence`). A hallucinated "500 impressions" would pass the gate that exists to stop noise. | The AI returns finding types, targets and *references* only. The core computes impressions, clicks, spend and outcomes from the database, and applies thresholds to those. | PROPOSAL §6.5 · BLUEPRINT §3.7, M06 · D-021 |
| A2 | Critical | The AI could name a target that doesn't exist or belongs to another product, and could emit a raw executable payload (`suggestedAction: WriteOp`) with budgets in it. | The core checks the target exists and belongs to the product, maps the finding type to the action, and computes amounts itself, clamped by the guards. Negative-keyword text must equal a real search term, and match type is EXACT or PHRASE only. | BLUEPRINT §3.7, §5.11 · D-022 |
| A3 | Critical | The undo of "add negative keyword" is "remove negative keyword", but that action didn't exist in `WriteOp`. The allowlist also said *delete/remove blocked* and *enable blocked*, while undoing a pause *is* enabling. | Explicit **undo-only** actions (`resume_entity`, `remove_negative_keyword`, `mark_abandoned`). The gateway accepts them only on undo proposals. | PROPOSAL §6.2 · BLUEPRINT §3.6 · D-023 |
| A4 | Important | An undo had no freshness check. Undoing a change after someone had edited the entity could overwrite their edit. | An undo's fingerprint is the state our change left behind; if the entity has moved on, the undo is refused as stale. | BLUEPRINT §3.6, §6 · D-023 |
| A5 | Critical | Crash recovery "retries if absent". For **creates** that could make duplicate campaigns. | Every create carries an idempotency tag, and the gateway searches for the tag before any retry. | PROPOSAL §6.10 · BLUEPRINT §3.6 · D-036 |
| A6 | Critical | A v2 test *required* `/pause-all` to be **refused** on a halted product, which blocks the emergency action exactly when you'd need it. | Halt stops the **agent**. Marcus's own spend-reducing actions (pause, pause-all) still run on a halted product. | PROPOSAL §5.4 · BLUEPRINT M09, M11 · D-025 |
| A7 | Important | Operator pauses waited for the 5-minute apply loop. | Confirmed pauses wake the gateway immediately, at top priority. | PROPOSAL §5.4 · BLUEPRINT §5.4 · D-051 (needs OK) |
| A8 | Critical | Ceilings were called a "hard stop", but the system can't stop platforms spending up to existing budgets (Google may spend up to 2× a daily budget on a given day). | The ceilings are defined precisely: they block increases and creates, alert at 80% and 100%, and can optionally auto-pause. The **real backstop is platform-side**: a Meta account spending limit, checked by the trust check. | PROPOSAL §6.9 · D-026 |
| A9 | Important | There was no terminal state for "verify failed **and** the automatic undo failed". | `needs_attention`: the product is halted, Marcus is alerted, and he resolves it explicitly. | BLUEPRINT §3.9 · D-029 |
| A10 | Important | Proposal statuses disagreed between the zod enum and SQL (`applying`, expiry…), and there were no defined transitions. | One state machine with a transition table enforced in the DB layer, and a test for every edge. | BLUEPRINT §3.9 · D-029 |
| A11 | Important | An approval was bound only to a version number. | It is also bound to a hash of the exact action, and each version can be decided only once (unique constraint). | PROPOSAL §6.3 · BLUEPRINT §3.8 · D-029 |
| A12 | Critical | Money was `bigint` inside JSON payloads (jsonb, hashes, Telegram, AI outputs). `JSON.stringify` throws on BigInt, and JSON numbers lose precision. | In JSON, money is a decimal string of micros, converted at the boundaries only. | BLUEPRINT §3.1 · D-027 |
| A13 | Important | A Google **shared** budget could be changed as if it belonged to one campaign, which would silently affect several. | Shared budgets are blocked, and so are Meta lifetime budgets. | PROPOSAL §6.4 · BLUEPRINT M14 |
| A14 | Important | "Only the gateway can decrypt write tokens" was a code convention inside one process that also talks to the AI and Telegram. | The gateway runs as **its own container** and holds the only write master key, so the worker physically cannot decrypt write credentials. The write clients also live in separate packages. | PROPOSAL §6.1, §6.13 · BLUEPRINT §2, §5.1 · D-043 (needs OK) |
| A15 | Important | Telegram trusted a chat id, so anyone in a group chat could tap Approve. With several replicas, two bots would fight over Telegram polling. | Updates are accepted only from Marcus's user id, in a private chat. Only the leader replica polls. Callback data fits Telegram's 64-byte limit. Messages use HTML formatting. | BLUEPRINT §5.2, §5.15 · D-037 |
| A16 | Important | Nothing stopped a Claude development session or CI from receiving production credentials. | Environments are separated, and two write switches (env + DB flag) must both be on. | PROPOSAL §11 · D-035 |
| A17 | Important | Personal data (emails for matching) had no rules and could reach prompts, traces or fixtures. | Hashing happens inside the pack adapter. The AI and Langfuse get aggregates only. Fixtures are scrubbed. | PROPOSAL §8, §9 · BLUEPRINT §5.18 |

## B. Things that would not have worked as written

| # | Severity | What was wrong in v2 | What v3 does | Where |
|---|---|---|---|---|
| B1 | Critical | Google conversion upload through the Google Ads API (`ConversionUploadService`) **has been blocked since 2026-06-15** for developer tokens that weren't already using it. Yours will be new. | Uploads go through the **Data Manager API** (`events:ingest`, OAuth scope `datamanager`, no developer token). | PROPOSAL §7 · BLUEPRINT M13 · D-028 |
| B2 | Critical | "Meta: fbclid via CAPI match" for attribution. Meta offers **no** way to look up which campaign an fbclid came from. | Platform IDs go into every ad's URL parameters and are captured at landing. Google gclids are looked up via `click_view`. | PROPOSAL §8 · BLUEPRINT §5.12 |
| B3 | Critical | Capturing click and platform IDs on SnapPool's signup and the Tally form was never listed as a prerequisite. Without it, attribution and feedback cannot work at all. | Setup tasks T6 and T12, plus an `id_capture` trust check. | PROPOSAL §8, §16 |
| B4 | Critical | Signups would be uploaded via CAPI without checking whether SnapPool's pixel already reports them. That double-counts conversions and teaches bidding the wrong thing. | One counting source per stage and platform, with shared event ids. Recommendation: SnapPool reports signups itself, and the agent uploads only the delayed stages. | PROPOSAL §8 · D-047 (needs OK) |
| B5 | Important | Test and internal signups would be uploaded as real conversions. | An `isTest` flag excludes them from uploads and KPIs. | PROPOSAL §8 · BLUEPRINT §3.5 |
| B6 | Important | Meta rejects a **whole batch** if any website event in it is older than 7 days. | Upload daily and skip events older than 6.5 days. | PROPOSAL §7, §8 |
| B7 | Important | The dashboard couldn't do what v2 asked. It could import only `contracts` and `db`, yet had to call "the settings service in core" and "the same core functions as Telegram". Its DB role blocked the proposal UPDATE that editing needs and the INSERT that undo requests need. The fact-base form needed the pack's schema, but packs weren't importable. | **Operator requests.** Every surface records intent, and the worker validates and acts, so there is exactly one validator. Pack manifests are published to the DB as JSON Schema for the dashboard's forms. | PROPOSAL §5.4 · BLUEPRINT §5.4, M10 · D-024 |
| B8 | Important | `proposals.cycle_id` was NOT NULL, but operator proposals have no cycle. | Nullable, with `origin` = agent / operator / policy. | BLUEPRINT §4 |
| B9 | Important | The proposal ran the trust gate *before* sync ("stage 0"), yet it needs the sync's trust signals; the blueprint had sync first. | Sync first, then the trust check. | PROPOSAL §5.2 · D-020 |
| B10 | Important | The worker was to commit briefs to a `briefs` git branch. That needs a token on the SER9 that can push to the repo holding the worker's own code, plus a local clone, which contradicts "no local state". | Briefs are stored in Postgres and shown on the dashboard. Backups use Neon history plus `pg_dump`. | PROPOSAL §9 · BLUEPRINT M16 · D-032 |
| B11 | Important | STRATEGY, PLAYBOOK and LEARNINGS were repo files baked into the Docker image, so editing one meant a redeploy. "LEARNINGS appended after outcomes" had no defined author. | They live in the DB, are edited on the dashboard, and keep history. The repo files are starting templates. | PROPOSAL §9 · D-044 (needs OK) |
| B12 | Important | "Pause keyword" needs keyword-level evidence, but `metrics_daily` only stored campaign and ad-group rows (and used a `coalesce` unique-index workaround). | One `ad_entities` table and per-entity daily metrics at **every** level. | BLUEPRINT §4 · D-038 |
| B13 | Important | Neon's pooled connection (PgBouncer in transaction mode) breaks LISTEN/NOTIFY and session advisory locks, which the queue and leader election rely on. | The worker and gateway use the direct connection; the dashboard uses the pooled one. | BLUEPRINT §5.1 |
| B14 | Minor | `accounts.role` duplicated `credentials.role`, forcing two account rows per real account. | One row per account, with credentials per role (`read` / `write` / `feedback`). | BLUEPRINT §4 · D-038 |
| B15 | Minor | `GuardConfig` required spend ceilings, but ceilings are per-product settings that may be unset. | Ceilings moved to `ProductSettings.spend` (nullable = unset = budget actions blocked). | BLUEPRINT §3.3 |
| B16 | Minor | "Packs may only remove actions" had no field to do it with. | `disabledActions` in both the pack manifest and the settings. | BLUEPRINT §3.3–3.4 |
| B17 | Minor | `products.status` included an undefined `paused`. | `active` / `halted` / `dormant`, each defined. | BLUEPRINT §4 |
| B18 | Minor | Tables were referenced but never defined: `settings_audit`, `source_copy`, `clicks`. | `settings_history`, `source_copy` (M15) and `google_clicks`. | BLUEPRINT §4 |
| B19 | Minor | Cycle idempotency used a *transaction-scoped* advisory lock, which is released when the transaction ends. | A unique index on (product, kind, date) for scheduled cycles. | BLUEPRINT §5.6 |
| B20 | Minor | The write token and developer token were read "from env" (S03/S13), contradicting "tokens only in the vault". | Account tokens live in the vault; app-level secrets (developer token, OAuth client, app secret) live in Doppler. | PROPOSAL §6.13 |
| B21 | Minor | "Google has one OAuth scope, so no token-level read/write split". That's incomplete: a Google login with *read-only* account access gives a real split, and uploads now need a separate scope anyway. | Two Google logins: read-only for sync, standard for writes and uploads. | PROPOSAL §6.1, §16 T5 · D-046 (needs OK) |

## C. Contradictions and stale text

| # | What was wrong | Fixed to |
|---|---|---|
| C1 | systemd vs Docker: C2 and the §4 diagram said systemd, C17 said container, S04 said "systemd is S07", and the S07 goal said systemd while its build said Docker. | Docker Compose everywhere |
| C2 | The "six-stage cycle" listed 7 stages; "seven independent layers" didn't match the 8+ listed; "the seven rules" had 10 bullets. | Accurate lists, with no counts that can drift |
| C3 | The allowlist had no "pause campaign", although `/pause` and `/pause-all` pause campaigns. | Added |
| C4 | G8 said `saas-snappool` was the pack added with zero core changes, but SnapPool is now built first. | The **property** pack is the G8 test |
| C5 | Left over from reordering Meta before Google: S02 "Same surface as S02"; S04's cut note put Google's search terms in S02. | Fixed |
| C6 | The S02/S03 sizes were swapped between the headers and the budget table. | Fixed (M02 500k, M03 550k) |
| C7 | S03/S04 acceptance used `property-sg`, which is on hold. | SnapPool |
| C8 | Rows in the proposal's tech-stack table were malformed (the dashboard row had 5 cells, the operating-surface row had 3). | Table rebuilt |
| C9 | The change table was numbered out of order (C12 came after C19). | Decisions renumbered D-001… in `docs/memory/DECISIONS.md` |
| C10 | File names didn't match: the documents referred to `BLUEPRINT.md` and `ads-agent-proposal-v2.md`, but the files were `adsAgentBlueprint.md` and `ads-agent-proposal.md`. | `docs/plan/PROPOSAL.md` and `docs/plan/BLUEPRINT.md`; originals in `docs/archive/` |
| C11 | `products/<folder>` used pack ids, while product slugs are `snappool` / `property-sg`. | Slugs |
| C12 | Stage 4 said "human decision in Telegram", but the dashboard approves too. | Both |
| C13 | The Phase 2 gate counted precondition failures as failures, but refusing a stale change is the *correct* behaviour. | Counts wrong changes and unexplained verify failures only |
| C14 | References to skills that don't exist in Claude Code (`/mnt/skills/public/frontend-design`, a `langfuse` skill), and to `gh pr create`, which isn't available in cloud sessions. | Removed; the process is tool-agnostic |
| C15 | "Trust confidence 0–1 with a floor of 0.7" was never defined. | Named pass/warn/fail/no-signal checks |

## D. Outdated external facts (checked 2026-09-25; sources in `docs/memory/GOTCHAS.md`)

| # | v2 said / assumed | Current fact | Effect on the plan |
|---|---|---|---|
| D1 | Google offline conversion upload via the Ads API | The Data Manager API, since 2026-06-15, for new tokens | M13 redesigned (B1) |
| D2 | Test access now; apply for Basic to reach real accounts | **Explorer access** (Feb 2026) reaches real accounts with no application, 2,880 ops/day | Live work can start sooner (T5) |
| D3 | "v25.1 current" | v25.2 is out (v25 released 2026-07-22, sunsets Aug 2027). `google-ads-api` moved to v25.1 on 2026-09-17 and supports one API version per release. | Pin the library and the API version together |
| D4 | Node 22 LTS | Node 24 is the active LTS (maintenance from 2026-10-20); Node 26 becomes LTS on 2026-10-28 | Node 24; decide on 26 in M00 |
| D5 | AI SDK `generateObject` | Deprecated in AI SDK 6, replaced by `generateText` + `Output.object` | M06 |
| D6 | Dashboard on Vercel (implicitly the free tier) | Vercel's Hobby plan forbids commercial use | **Settled:** Marcus already has Vercel Pro, so the dashboard runs there (D-054) |
| D7 | Neon (cost not considered) | The free plan has 100 compute-hours a month and sleeps when idle. An always-on worker uses about 730. | **Settled:** Marcus is already on Neon's paid plan (D-055) |
| D8 | Special ad categories not mentioned | Meta's special ad categories (Housing etc.) now apply beyond the US, including Asia | The property pack declares HOUSING (confirmed by Marcus, D-062) |
| D9 | Google MCP read-only, 3 tools | Confirmed. It also had a July 2026 fix for OAuth credentials being written to logs. | Supports keeping MCP out of the core path (D-039) |
| D10 | Meta MCP "since July 2026" | Launched April 2026; developer availability July 2026; writes need `ads_management` | No change; D-018 narrowed |
| D11 | `.eslintrc.cjs`, `vitest.workspace.ts`, zod 3 idioms | ESLint flat config; Vitest `projects`; zod 4 (`z.iso.datetime`, two-argument `z.record`) | M00 verifies and uses current idioms |
| D12 | — | Meta CAPI: a batch is rejected if any website event is older than 7 days | B6 |
| — | Meta Marketing API validation option (`execution_options`) | **Could not verify**, because Meta's docs are blocked by this environment's network proxy | Marked "verify in M12" |

## E. Clarity and simplification

| # | Change | Where |
|---|---|---|
| E1 | A one-page summary, a glossary, and a "how to read this" note | PROPOSAL §0–1 |
| E2 | Blueprint "sessions" renamed **milestones** (M00–M16, same numbers). Acceptance split into **cloud** (Claude can prove it) and **live** (Marcus runs it). In v3.1, every milestone or milestone part is sized to one session, and the token budget with its checkpoints is restored (§H). | BLUEPRINT §0 · D-033, D-056 |
| E3 | The analyst's drill-down uses typed read-only **database look-ups** instead of the official MCP servers: deterministic, replayable, no extra credentials, no quota, no Python sidecar | PROPOSAL §10 · BLUEPRINT §5.10 · D-039 (needs OK) |
| E4 | **Detectors first**: fixed rules produce candidates, and the AI reviews, ranks and explains them | PROPOSAL §5.2 · BLUEPRINT §5.9 · D-040 (needs OK) |
| E5 | The **strongest model does the analysis** (v2 had a cheap model analysing and a frontier model writing prose, which is backwards); the cost at this volume is a few dollars a month | PROPOSAL §10 · D-041 (needs OK) |
| E6 | All per-product settings in **one validated document** with version history, instead of three JSON columns (`spend_limits` had become a grab-bag) | BLUEPRINT §3.3 · D-031 |
| E7 | New sections: environments and who can do what; conversion tracking; costs | PROPOSAL §8, §11, §14 |
| E8 | Per-action proposal expiry: budget changes 72 h, other actions 7 days | BLUEPRINT §5.11 · D-052 (needs OK) |
| E9 | Phase gates made measurable: 👍/💡 buttons on briefs, an exact agree-rate definition, and a Phase 2 gate that counts only real failures | PROPOSAL §12 · D-053 (needs OK) |
| E10 | Meta budget changes default to at most ±20%, because larger jumps commonly restart the learning phase | PROPOSAL §6.4 · D-049 (needs OK) |
| E11 | Copy variants in two tiers: **fragments** (no new claims, guaranteed) and **reword** (mechanical checks, with Marcus's approval as the final check), being honest that free rewording can't be proven mechanically | PROPOSAL §6.12 · D-045 (needs OK) |
| E12 | Conversion-upload auto-approval stays **off** until the Phase 2 gate passes, with daily caps and volume alerts | PROPOSAL §8 · D-048 (needs OK) |

## F. New: how the work itself is run

| # | Addition | Where |
|---|---|---|
| F1 | A **memory system** in the repo, so any session (cloud or local) continues where the last one stopped: `NOW` (auto-loaded), `LOG`, `DECISIONS`, `GOTCHAS`, `QUESTIONS`, and one file per milestone | `docs/memory/`, `docs/milestones/`, `docs/process/SESSIONS.md` |
| F2 | A **git workflow**: branches, commits, PRs, continuing unmerged work, CI, tags, repo settings | `docs/process/GIT-WORKFLOW.md` |
| F3 | **Skills** for starting and ending sessions, starting and closing milestones, preflight checks, changing the plan and verifying external facts, plus a catalogue of domain skills to create as the code appears | `.claude/skills/`, `docs/process/SKILLS.md` |
| F4 | **Hooks**. SessionStart finds the newest memory, even on an unmerged branch or a stale local clone. Stop reminds the session to record progress and push. | `.claude/hooks/`, `.claude/settings.json` |
| F5 | A PR template and a CI check that code PRs update the memory files | `.github/` |

---

## G. Decisions that need Marcus's OK

Reply "all OK", or name the ones you disagree with, in `docs/memory/QUESTIONS.md` Q1 or in chat. Until you answer, sessions treat these as the working plan, but won't build anything that depends on a disputed item.

| Decision | Recommendation | Alternative (the v2 position, or the obvious other option) |
|---|---|---|
| D-039 | The analyst uses typed database look-ups; official MCPs deferred | MCP drill-down in the analyse stage (v2 C3) |
| D-040 | Fixed detectors produce candidates; the AI reviews them | The AI finds everything (v2) |
| D-041 | The strongest model for analysis | A cheap model for analysis (v2) |
| D-042 | Named pass/warn/fail trust checks | A 0–1 confidence score with a floor (v2) |
| D-043 | The gateway as a separate container holding the only write key; write clients in separate packages | Gateway as a module inside the worker, with subpath exports (v2) |
| D-044 | STRATEGY/PLAYBOOK/LEARNINGS in the DB, edited on the dashboard | Repo files, editing needs a redeploy (v2) |
| D-045 | Copy tiers: `fragments` (property) and `reword` (SnapPool) | A single "no new claims" check (v2, which can't be done mechanically for rewording) |
| D-046 | Two Google logins: read-only for sync, standard for writes and uploads | One login, split enforced only by code (v2) |
| D-047 | SnapPool reports signups itself in real time; the agent uploads delayed stages | The agent uploads signups (v2); depends on Q3 |
| D-048 | Upload auto-approval off until the Phase 2 gate; daily caps | Auto-approved from the start (v2) |
| D-049 | Meta budget changes at most ±20% by default | ±30% on both platforms (v2) |
| D-050 | ~~Dashboard on the SER9 via Cloudflare Tunnel~~ **Settled: Vercel Pro (D-054)** | — |
| D-051 | Confirmed operator pauses run immediately | Wait for the 5-minute loop (v2) |
| D-052 | Proposal expiry: budget 72 h, others 7 d | 7 days for everything (v2) |
| D-053 | Measurable gates (brief buttons, agree-rate definition, Phase 2 counting) | Judgement at the time (v2) |

## H. Updates after Marcus's reply (v3.1, 2026-09-25)

| # | Marcus said | What changed |
|---|---|---|
| H1 | He already has **Vercel Pro** | The dashboard runs on Vercel Pro behind Cloudflare Access (D-054, which supersedes D-050). The Tunnel option is removed, and Q6 is answered. The safeguards stay: Access-token verification in middleware (which also closes the raw `*.vercel.app` address), protected preview deployments, and no production DB credentials in previews. |
| H2 | He is already on **Neon's paid plan** | Costs updated (D-055), and Q7 is answered. The always-on worker is fine. |
| H3 | Build sessions start from a **clean context** on **Opus 5.5 at medium effort** (max was for planning only), and each must fit in **400–600k tokens**, including testing, changes, reviews and fixes | v3.0 had said "a milestone may take several sessions" and treated sizes as rough. That's replaced by D-056: **one milestone (or part) = one session = one PR**, estimated at 400–500k so there's room for fixes before a hard stop at 600k. The v2 checkpoint table is restored (SESSIONS §4). The eight milestones that no longer fit are split into a/b parts (below). The plan also tells medium-effort sessions to follow the plan, not redesign it (BLUEPRINT §0). |

**How the milestones were re-sized.** Yardstick (from v2): 500k tokens ≈ 1,500–2,500 lines of TypeScript including tests. The estimates below are rough line counts, including tests.

| Milestone | Estimate after the v3 review | Result |
|---|---|---|
| M01 | ~3,300 lines (27 tables, repositories, queue, leader lock, vault, request processor) | **M01a** schema + repositories (~500k) · **M01b** queue, leader lock, vault, request processor (~450k) |
| M05 | ~3,000 lines (pack SDK, two packs, settings, attribution, manifests, product docs) | **M05a** pack SDK + SnapPool pack + settings (~500k) · **M05b** property pack + attribution + product docs (~450k). This also makes the G8 test cleaner: the second pack arrives in its own session. |
| M06 | ~2,300 lines (AI layer, 8 detectors, analyst input, look-ups, analyse stage) | **M06a** AI layer + registry + detectors (~450k) · **M06b** analyst input, look-ups, analyse stage (~450k) |
| M09 | ~2,300 lines (bot, cards, commands, settings, alerts, entity resolution) | **M09a** bot core + proposal cards (~450k) · **M09b** operator commands (~400k) |
| M10 | ~2,450 lines (Next.js, auth, settings forms, all views) | **M10a** app + sign-in + settings (~450k) · **M10b** review views (~400k) |
| M11 | ~2,800 lines (guards with property tests, pipeline, crash tests) | **M11a** allowlist, guards, fingerprint (~450k) · **M11b** pipeline, recovery, undo, service (~450k) |
| M15 | ~2,000 lines (source copy, format checks, both claim tiers, variant stage) | **M15a** source copy + claim checks (~400k) · **M15b** format checks, variants, proposals (~400k) |
| M16 | ~1,700 lines plus a long runbook | **M16a** evals + model-swap gate (~450k) · **M16b** runbook, backups, doctor (~400k) |
| M00, M02–M04, M07, M08, M12–M14 | 1,400–1,750 lines each | Kept whole, each re-estimated at ~500k |

**Total:** 25 sessions, about 11.6M tokens (v2 had 17 sessions and about 9.05M). The difference comes from the review's safety additions, the headroom left for fixes, and the orientation cost each clean session pays (~30–50k).

## I. Marcus's second round of answers (v3.2, 2026-09-25)

| # | Marcus said | What changed |
|---|---|---|
| I1 | Q1: the v3 recommendations "look okay" | D-039 to D-053 **adopted**. The "needs OK" markers are removed from PROPOSAL. |
| I2 | Q2: the SER9 is Linux with Docker; no login needed; local sessions there once cloud tokens run out | D-058. Local sessions may run Docker for **dev** (project `ads-agent-dev`), never touch production (`ads-agent`) or other projects' containers, and never run global clean-ups. The reboot risk is resolved. |
| I3 | Q3/Q4: SnapPool has no pixel and no Conversions API, and doesn't store click ids. "Think of something; check the SnapPool repo." | Claude read the SnapPool repo (commit `a6c190a`). New spec, **`docs/plan/SNAPPOOL-TRACKING.md`**: SnapPool remembers the ad click in a cookie and saves it, with the user agent and page URL (both required by Meta for website events), on the `/start` request. The agent uploads `Lead` and `CompleteRegistration` (Meta) and `signup` (Google) itself; no pixel for now. **D-060, which needs OK (Q11), supersedes D-047.** The contracts gained feedback **routes** and a `web` context. |
| I4 | Q5: test signups are recognised by email domain | D-059: a `testTraffic.emailDomains` setting, plus the superadmin |
| I5 | Q8: about $500 a month for starters | D-061. **Correction found while checking:** Meta's account spending limit is a **lifetime total, not monthly**, so it needs a monthly reset (or auto-reset where offered). The trust check became `spend_cap_headroom`, and the digest reminds on the 1st. Currency and auto-reset are asked in Q12. |
| I6 | Q9: the Housing category is required | D-062. The "verify for SG" hedges are removed. |
| I7 | Q10: Claude merges only when told to, after CI passes | D-057, in GIT-WORKFLOW §8, `CLAUDE.md` and the `end-session` skill |

**Found in the SnapPool repo that the plan didn't know:**
- **Signup is open on production** (since 2026-09-20), so ads won't hit a closed door.
- **There's no checkout.** SnapPool is in a free beta (signup window to 2026-11-30, free plans honoured to 2027-01-01), so the `paid` stage has no source for now.
- **The funnel is `/start` request → email-verified claim → first photo.** That gives the stage defaults `pool_request` / `signup` / `activated`.
- **Activation usually happens on the event day,** weeks after the ad click. It's for reporting, not for platform feedback.

## What did not change

- The premise: connectors are a commodity, and the judgement lives in packs.
- The agent as *an analyst with a supervised hand*.
- The rule: the core never imports a pack, and a pack never touches a platform.
- The two packs, with SnapPool first and property on fixtures.
- Structured Postgres state, not a semantic memory layer.
- The phase order and the principle "never lower the bar; extend the window".
- The allowlist philosophy: reduce-spend actions first, budgets later, creative last.
- The two control surfaces: Telegram to operate, the dashboard to configure and review.
- Marcus as the content authority.
- The vault, containerised workers, two-phase apply and the dead-man's switch.
- The honest framing of "learning".
