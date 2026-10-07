# Decisions

Every decision that shapes the plan, with its reason and the alternative it replaced. **Append-only.** To change a decision, add a new one that supersedes it (the `update-plan` skill). Newest at the bottom.

**Entry format**
```
### D-NNN — <title>
- **When / who / status:** YYYY-MM-DD · Marcus | Claude (fix) | Claude (needs OK) · adopted | proposed | superseded by D-xxx
- **Decision:** …
- **Why:** …
- **Instead of:** …
- **See:** doc § / milestone
```

**Status meanings**
- **adopted:** in force.
- **proposed:** Claude's recommendation; the plan is written this way, but it waits for Marcus's OK (the open question is in `QUESTIONS.md`).
- **superseded:** replaced by the decision named.

---

## Standing decisions carried over from v2 (Marcus, 2026-09-14)

For the original wording, see `docs/archive/proposal-v2.1.md` §0 and §11. The "v2 Cx" references point there.

### D-001 — Product-agnostic core with two packs from day one
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C1)
- **Decision:** One core that knows nothing about products, plus the packs `property-sg` and `saas-snappool`.
- **Why:** A seam with only one implementation is untested; with two, it's a real interface.
- **See:** PROPOSAL §2, §4 · G8

### D-002 — No n8n; the worker runs on the SER9
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C2; the runtime is refined by D-015)
- **Decision:** A single TypeScript worker with its own scheduling. No orchestration tool.
- **Why:** Marcus doesn't run n8n. One language and one deploy target.

### D-003 — Deterministic sync through typed API clients
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C3; its MCP part is narrowed by D-039)
- **Decision:** The Read stage uses typed Google and Meta API clients, not MCP.

### D-004 — AI through the Vercel AI SDK, model per stage via env, Langfuse for traces
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C4; the API form is updated by D-030)
- **Decision:** In-process model abstraction; structured outputs validated with zod; Langfuse for traces and cost. LiteLLM is optional later.

### D-005 — Outcomes are fed back to the platforms as conversions
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C5; the path is updated by D-028, the safeguards by D-047 and D-048)
- **Why:** Platforms optimise towards what you feed them. This is the biggest lever in the system.

### D-006 — Fingerprint (precondition) check at apply time
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C6; extended to undos by D-023)

### D-007 — Evidence thresholds before a finding can become a proposal
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C7; hardened by D-021)

### D-008 — Replay evals from Phase 1; the full harness in Phase 5
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C8)

### D-009 — Marcus is the content authority; the agent drafts variants only
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C9 + C13; the check tiers are refined by D-045)
- **Decision:** Marcus supplies the source copy, the required elements and the facts. The agent produces variants, and mechanical checks enforce the rules.

### D-010 — Two control surfaces over the same data
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C10; the mechanism is refined by D-024)
- **Decision:** Telegram is for operating (cards, pause, undo, halt, digest, alerts). The web dashboard behind Cloudflare Access is for configuring and reviewing. Neither holds platform credentials.

### D-011 — Platform text is untrusted data, never instructions
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C12)

### D-012 — Outcome configuration is per product and editable without a deploy
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C14)
- **Decision:** Stages, tiers, the primary KPI and the feedback stage live in settings; packs provide the defaults. Property: form fill = success. SnapPool: signup = success, paid = hard success.

### D-013 — SnapPool first; property on hold and validated on fixtures
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C15)
- **Decision:** Phases 0–1 are validated on SnapPool's soft-launch spend. The property pack is built and tested on "Sora at Lakeside" fixtures.

### D-014 — Spend ceilings are settings; budget actions are blocked until they're set
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C16; the meaning is made precise by D-026)

### D-015 — Containerised worker, Postgres queue, startup reconciliation, two-phase apply, external dead-man's switch
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C17; the gateway is split out by D-043)

### D-016 — Credential vault with envelope encryption; OAuth connection for future tenants
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C18; the two master keys come from D-043)

### D-017 — Honest "learning": the platforms, the record, the rules and the evals, not the model
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C19)

### D-018 — Meta MCP rules deny writes
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 C11; narrowed by D-039)
- **Decision:** If any MCP client is ever connected to the Meta ad account (including Marcus's own AI tools), apply Meta's account rules so that it cannot write.

### D-019 — Stack
- **When / who / status:** 2026-09-14 · Marcus · adopted (v2 §8; versions updated by D-030)
- **Decision:** TypeScript, pnpm + Turborepo, Neon + Drizzle, Docker on the SER9, grammY, Next.js, Doppler, Langfuse, Vitest + fast-check.

---

## v3 fixes (Claude, 2026-09-25). Adopted, but Marcus may object to any of them.

These correct errors, contradictions and outdated facts found in the review. Details are in `docs/plan/CHANGES-v3.md`.

### D-020 — Sync comes before the trust check
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:** The cycle order is sync → trust check → detect → analyse → draft → report.
- **Why:** The trust check needs the sync's fresh signals. v2's proposal ran it first, while v2's blueprint ran it second.
- **See:** PROPOSAL §5.2 · CHANGES B9

### D-021 — Evidence numbers come from the database, never from the AI
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:** The AI returns finding types, targets and references. The core computes the evidence and applies the thresholds to it.
- **Why:** Otherwise a hallucinated number could pass the evidence gate.
- **Instead of:** v2's `Finding.evidence`, written by the model.
- **See:** PROPOSAL §6.5 · BLUEPRINT §3.7, M06 · CHANGES A1

### D-022 — The AI proposes types and targets; the core builds the action
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - The core validates that the target exists and belongs to the product.
  - It maps each finding type to its action and computes amounts, clamped by the guards.
  - Negative keywords must equal a real search term, with EXACT or PHRASE match only.
- **Instead of:** v2's model-authored `suggestedAction: WriteOp`.
- **See:** BLUEPRINT §3.7, §5.11 · CHANGES A2, A13

### D-023 — Undo-only actions, and a fingerprint check on undo
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - `resume_entity`, `remove_negative_keyword` and `mark_abandoned` exist only as stored undos.
  - An undo runs only if the entity is still in the state our change left it in.
- **See:** PROPOSAL §6.2 · BLUEPRINT §3.6 · CHANGES A3, A4

### D-024 — Every surface records "operator requests"; the worker validates and acts
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - Telegram, the dashboard and the CLIs create `operator_requests`, and a single processor validates and applies them.
  - Pack manifests (including the fact schemas as JSON Schema) are published to the DB for the dashboard's forms.
  - The dashboard's DB role is read-only plus INSERT on `operator_requests`.
- **Why:** v2's dashboard couldn't import `core` or the packs, yet had to call them, and its DB role blocked edits and undo requests.
- **See:** PROPOSAL §5.4 · BLUEPRINT §5.4, M10 · CHANGES B7

### D-025 — Halt stops the agent, not Marcus's pauses
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:** A halted product runs no cycles or agent proposals, but Marcus's spend-reducing actions (pause, pause-all) still execute.
- **Instead of:** a v2 test that required `/pause-all` to be refused on a halted product.
- **See:** PROPOSAL §5.4 · CHANGES A6

### D-026 — What ceilings do, stated honestly; the platform-side limit is the real backstop
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - Ceilings block budget increases and creates when they're unset or would be exceeded.
  - They alert at 80% and 100% of the monthly ceiling.
  - An automatic pause on breach is optional and off by default.
  - A Meta account spending limit is the hard cap. The trust check warns if it isn't set.
- **Why:** The system can't stop platforms spending up to budgets that already exist.
- **See:** PROPOSAL §6.9 · CHANGES A8

### D-027 — Money in JSON is a decimal string of micros
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Why:** `JSON.stringify` throws on BigInt, and JSON numbers lose precision.
- **See:** BLUEPRINT §3.1 · CHANGES A12

### D-028 — Google conversion uploads go through the Data Manager API
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:** `datamanager.googleapis.com/v1/events:ingest`, with the `datamanager` OAuth scope and no developer token.
- **Why:** Google blocked new developer tokens from the Google Ads API upload method from 2026-06-15.
- **See:** PROPOSAL §7 · BLUEPRINT M13 · CHANGES B1

### D-029 — One proposal state machine; approvals bound to version and action hash
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - The statuses and transitions are those in BLUEPRINT §3.9, enforced in the DB layer.
  - `needs_attention` covers the case where verify failed and the automatic undo failed too.
  - Each version can be decided only once.
- **See:** BLUEPRINT §3.8–3.9 · CHANGES A9–A11

### D-030 — Current tooling
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:** Node 24 LTS (decide on Node 26 in M00); AI SDK 6 (`generateText` + `Output.object`); zod 4; ESLint flat config; Vitest `projects`. Versions are verified in M00.
- **See:** PROPOSAL §10 · CHANGES D4, D5, D11

### D-031 — Settings are one validated document per product, with history
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - `products.settings` is validated by `ProductSettings`, and every version is kept in `settings_history`.
  - The settings are validated on every write **and** every read.
- **Instead of:** v2's three JSON columns, of which `spend_limits` had become a grab-bag.
- **See:** BLUEPRINT §3.3, §4

### D-032 — Briefs are stored in Postgres; the worker holds no git credentials
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Instead of:** v2's worker committing briefs to a `briefs` git branch.
- **See:** PROPOSAL §9 · CHANGES B10

### D-033 — Milestones, not "sessions"; acceptance is split into cloud and live
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted; **the "several sessions per milestone" part is superseded by D-056**
- **Decision:**
  - The blueprint's S00–S16 are now the milestones M00–M16, with the same numbers.
  - One milestone may take several Claude sessions.
  - Each milestone has "Done when (cloud)" and "Done when (live)".
- **See:** BLUEPRINT §0

### D-034 — Memory, git workflow and skills live in the repo
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted (Marcus asked for this on 2026-09-25)
- **Decision:**
  - `docs/memory/` holds NOW (auto-loaded), LOG, DECISIONS, GOTCHAS and QUESTIONS; `docs/milestones/` holds one file per milestone.
  - SessionStart and Stop hooks; 7 process skills; a PR template; a memory-check CI job.
  - It works for both cloud and local sessions, because everything is pushed to GitHub.
- **See:** `docs/process/SESSIONS.md`, `GIT-WORKFLOW.md`, `SKILLS.md`

### D-035 — Environment separation, and two write switches
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - Claude sessions and CI never hold production write credentials.
  - The gateway writes only when the env var `GATEWAY_WRITES_ENABLED` and the DB flag `writes_enabled` are both on.
- **See:** PROPOSAL §11, §6.14 · CHANGES A16

### D-036 — Creates are idempotent
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:** Every create carries an idempotency tag, and the gateway searches for that tag before retrying.
- **See:** PROPOSAL §6.10 · CHANGES A5

### D-037 — Telegram hardening
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:** Only Marcus's user id, only in a private chat; callback data of 64 bytes or less, in a versioned format; HTML formatting; only the leader replica polls.
- **See:** BLUEPRINT §5.2, §5.15 · CHANGES A15

### D-038 — Data model clean-up
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - `ad_entities`, plus per-entity daily metrics at every level.
  - `offerings` holds the fact base (it was `entities`).
  - One `accounts` row per account, with credentials per role (read, write, feedback).
  - `google_clicks` for gclid attribution.
- **See:** BLUEPRINT §4 · CHANGES B12, B14

---

## v3 recommendations (Claude, 2026-09-25). Approved by Marcus in Q1 on 2026-09-25

### D-039 — The analyst looks things up with typed database queries; the official MCP servers are deferred
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:**
  - Deterministic and replayable, so evals work.
  - No extra credentials, API quota or Python sidecar.
  - The Google MCP had a credential-logging fix in July 2026.
- **Instead of:** MCP drill-down during the analyse stage (v2 C3).
- **See:** PROPOSAL §10 · BLUEPRINT §5.10

### D-040 — Fixed detectors first; the AI reviews, ranks and explains
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** Findings become reproducible and testable, and this raises the chance of passing the Phase 1 agree-rate gate.
- **Instead of:** the AI finding everything itself.
- **See:** PROPOSAL §5.2 · BLUEPRINT §5.9

### D-041 — The strongest model does the analysis
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** Analysis is the hard step, and it costs a few dollars a month at this volume. The wording can move to a cheaper model once evals show no loss.
- **Instead of:** a cheap model for analysis and a frontier model for prose (v2).

### D-042 — Trust checks are named pass/warn/fail/no-signal checks
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** Understandable, testable, and aware of low traffic.
- **Instead of:** an undefined 0–1 confidence score with a floor of 0.7.
- **See:** BLUEPRINT §5.8

### D-043 — The gateway is its own container and holds the only write key; write clients live in separate packages
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** A real security boundary. The process that can spend money never talks to the AI or reads untrusted text, and the worker *cannot* decrypt write credentials. The cost is one extra compose service built from the same image.
- **Instead of:** the gateway as a module inside the worker process, protected only by lint rules.
- **See:** PROPOSAL §6.1, §6.13 · BLUEPRINT §2, §5.1, M11

### D-044 — STRATEGY, PLAYBOOK and LEARNINGS live in the DB and are edited on the dashboard
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** Editing them needs no redeploy, and they keep version history. The repo files become starting templates.
- **See:** PROPOSAL §9 · BLUEPRINT M05, M10

### D-045 — Two copy tiers: `fragments` (property) and `reword` (SnapPool)
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** "No new claims" can be *guaranteed* only when variants are assembled from approved fragments. Free rewording can only be checked mechanically, so Marcus's approval remains the final check.
- **See:** PROPOSAL §6.12 · BLUEPRINT M15

### D-046 — Two Google logins: read-only for sync, standard for writes and uploads
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** It gives a real token-level split on Google. v2 said this wasn't possible because the OAuth scope is shared.
- **See:** PROPOSAL §6.1, §16 T5

### D-047 — SnapPool reports signups itself, in real time; the agent uploads the delayed stages
- **When / who / status:** 2026-09-25 · Claude · approved in Q1, then **superseded by D-060**, because Q3 showed SnapPool has no tracking at all
- **Why:** Real-time browser + server events with a shared event id match best and avoid double counting. The agent adds value on the stages that happen later (activated, paid) and on property's offline stages.
- **Instead of:** the agent uploading signups in batches (v2).
- **See:** PROPOSAL §8

### D-048 — Conversion-upload auto-approval stays off until the Phase 2 gate; daily caps apply
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** Uploads are irreversible on Meta, and wrong conversions mis-train bidding.
- **Instead of:** auto-approval from the start (v2).

### D-049 — Meta budget changes are limited to ±20% by default
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Why:** Larger jumps commonly restart Meta's learning phase. Google keeps ±30%.

### D-050 — The dashboard is hosted on the SER9 behind a Cloudflare Tunnel and Access
- **When / who / status:** 2026-09-25 · Claude (needs OK) · **superseded by D-054** (Marcus already has Vercel Pro)
- **Why:** Free, and there's no public origin to bypass. Vercel's free Hobby plan forbids commercial use.
- **Instead of:** Vercel (v2 "decided"); the alternative is Vercel Pro at about USD 20/month.

### D-051 — Marcus's confirmed pauses execute immediately
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Decision:** They go to the front of the queue and wake the gateway, instead of waiting for the 5-minute loop.

### D-052 — Proposal expiry depends on the action
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Decision:** Budget changes expire after 72 h; other actions after 7 days; operator confirm cards after 30 min.

### D-053 — Measurable phase gates
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q1, 2026-09-25)
- **Decision:**
  - 👍/💡 buttons on every brief measure the Phase 0 gate.
  - An exact agree-rate definition, excluding expired and operator proposals and failing if more than 20% expire.
  - The Phase 2 gate counts only wrong changes and unexplained verify failures.
- **See:** PROPOSAL §12

---

## Marcus's answers (2026-09-25)

### D-054 — The dashboard runs on Vercel Pro, behind Cloudflare Access
- **When / who / status:** 2026-09-25 · Marcus · adopted · **Supersedes:** D-050
- **Decision:** Deploy `apps/web` to Marcus's existing Vercel Pro account, with Cloudflare Access in front.
  - The middleware verifies the Access token and fails closed, which also closes the raw `*.vercel.app` address.
  - Preview deployments are protected and never get production DB credentials.
- **Why:** Marcus already pays for Vercel Pro. D-050 only recommended the SER9 because Vercel's free Hobby plan forbids commercial use.
- **See:** PROPOSAL §10, §16 T10 · BLUEPRINT §5.1, M10a

### D-055 — Neon runs on Marcus's existing paid plan
- **When / who / status:** 2026-09-25 · Marcus · adopted (answers Q7)
- **Decision:** The agent's Neon project (with `prod` and `dev` branches) sits on Marcus's paid plan. The always-on worker's direct connection keeps compute awake, which is expected. There's no need to design polling around the free tier's scale-to-zero.
- **See:** PROPOSAL §14, §16 T2 · BLUEPRINT §5.3

### D-056 — Session model: clean context, Opus 5.5 at medium effort, 400–600k tokens per session
- **When / who / status:** 2026-09-25 · Marcus · adopted · **Supersedes:** the "several sessions per milestone" part of D-033
- **Decision:**
  - Build sessions start from a **clean context** and run on **Opus 5.5 at medium effort**. Max effort is for planning only.
  - Every session must finish within **400–600k tokens**, including orientation, tests, changes, reviews and fixes.
  - One milestone (or milestone part) = one session = one PR.
  - Eight milestones that no longer fit are split into a/b parts (M01, M05, M06, M09, M10, M11, M15, M16), so there are **25 sessions**, each estimated at 400–500k tokens.
  - The token-budget checkpoints from v2 are restored (SESSIONS §4). The hard stop is at 600k.
- **Why:** This is Marcus's operating model. v2's yardstick (500k ≈ 1,500–2,500 lines including tests) shows that eight v3 milestones, which grew with the review's safety additions, would overrun one session.
- **See:** BLUEPRINT §0, §7, §9 · SESSIONS §4 · CHANGES §H

---

## Marcus's answers, second round (2026-09-25)

### D-057 — Claude merges a PR only when Marcus says so, and only after CI passes
- **When / who / status:** 2026-09-25 · Marcus · adopted (answers Q10)
- **Decision:** Marcus reviews every PR. Claude may merge one, with a squash merge, **only when Marcus explicitly says to**, and only once all checks are green. Otherwise the PR waits.
- **See:** GIT-WORKFLOW §8 · CLAUDE.md

### D-058 — Local sessions run on the SER9, isolated from production
- **When / who / status:** 2026-09-25 · Marcus (setup) + Claude (rules) · adopted (answers Q2)
- **Decision:**
  - The SER9 runs Linux with Docker, and no login is needed after a reboot. Marcus is using cloud sessions for now and will move to **local sessions on the SER9** when cloud tokens run out.
  - Local sessions may run Docker commands for **dev** work only, using the compose project `ads-agent-dev`.
  - They never touch the production project `ads-agent` or other projects' containers (e.g. SnapPool's `snappool-worker`), never use the production Doppler configs, and never run global clean-ups (`docker system prune`, `docker volume prune`).
- **Why:** Dev and production share one machine.
- **See:** SESSIONS §6 · PROPOSAL §11, §13 · BLUEPRINT M00

### D-059 — SnapPool test and internal signups are recognised by email domain
- **When / who / status:** 2026-09-25 · Marcus · adopted (answers Q5)
- **Decision:** A signup whose email domain is in the product setting `testTraffic.emailDomains`, or from the superadmin, is a test outcome: never uploaded, never counted. The domain list lives in the database settings, not in the repo.
- **See:** BLUEPRINT §3.3, M05a · SNAPPOOL-TRACKING §2

### D-060 — SnapPool captures the ad click; the agent uploads the conversions (no pixel for now)
- **When / who / status:** 2026-09-25 · Claude · **adopted** (Marcus OK in Q11, 2026-09-25) · **Supersedes:** D-047
- **Decision:**
  - SnapPool remembers the ad-click details in a first-party cookie, and saves them on the `/start` request, together with the browser user agent and page URL (Meta requires both for website events). There's no IP address and no browser pixel or tag.
  - The agent uploads `pool_request` (Meta `Lead`) and `signup` (Meta `CompleteRegistration`; Google click conversion) server to server: one daily batch while Marcus approves them by hand, hourly once auto-approved.
  - Feedback is configured as **routes**, so a stage can go to several platforms, and a platform can take several stages.
- **Why:** SnapPool has no tracking today (Q3) and doesn't store click ids (Q4). This is the smallest SnapPool change, it needs no CSP or cookie-consent work, and it gives one tested, capped path, so nothing is counted twice.
- **Instead of:** D-047 (SnapPool reports signups itself in real time), which assumed existing tracking.
- **See:** `docs/plan/SNAPPOOL-TRACKING.md` · PROPOSAL §8 · BLUEPRINT §3.3, §3.5, §5.13, M05a, M12, M13

### D-061 — Meta spending limit: about 500 a month, reset monthly
- **When / who / status:** 2026-09-25 · Marcus (amount, tentative) + Claude (mechanics) · adopted (answers Q8), then **superseded by D-063** after Q12
- **Decision:**
  - Marcus plans about **500 a month** to start. The Meta account spending limit is set at about that amount.
  - Because Meta's limit is a **lifetime total, not monthly**, it's reset on the 1st of each month, or set to auto-reset if the billing page offers that.
  - The trust check `spend_cap_headroom` warns when the limit is unset or 80% used. The digest shows its usage and gives a reset reminder on the 1st.
- **See:** PROPOSAL §6.9, §16 T4 · BLUEPRINT §5.8, M12

### D-062 — The Meta Housing special ad category applies to property ads
- **When / who / status:** 2026-09-25 · Marcus · adopted (answers Q9)
- **Decision:** The property pack declares `HOUSING` on every Meta campaign it creates. The property playbook assumes the resulting targeting limits: no age, gender or postcode targeting.
- **See:** PROPOSAL §4, §7 · BLUEPRINT M05b, M14

### D-063 — Budget S$500 a month; Marcus resets and adjusts the Meta spending limit by hand
- **When / who / status:** 2026-09-25 · Marcus (budget, resets) + Claude (mechanics) · adopted (answers Q12) · **Supersedes:** D-061
- **Decision:**
  - The starting budget is **S$500 a month**, in Singapore dollars (the ad accounts' currency). Marcus sets Meta's account spending limit at about that amount.
  - He **resets the limit by hand** when needed. Whether his billing page offers auto-reset is unknown, so the plan doesn't rely on it.
  - He will **change the limit during trials**. So the agent reads the current limit, and the amount spent against it, from Meta on every sync. It never assumes a figure, and never changes the limit: that isn't one of its write actions.
  - The trust check `spend_cap_headroom` warns when the limit is unset, or 80% or more of it is used. It runs from M04, because ads are live in Phase 0 and every Meta campaign stops when the limit is reached. From M07 the digest shows the usage, and on the 1st of each month reminds Marcus to reset it.
  - The agent's own monthly ceiling for SnapPool is a separate setting, entered in the M05a live steps. Both are Marcus's to change.
- **Why:** Marcus's answer to Q12: "Yes, it's $500 dollars … I'll manually do the reset if I need to, but I will adjust the limits when we are trying as well."
- **Instead of:** D-061, which assumed a fixed limit, possibly auto-reset, and watched it only from M12.
- **See:** PROPOSAL §4, §6.9, §16 T4 · BLUEPRINT §5.8, §5.14, M04, M12

### D-064 — SnapPool tracking spec v1.2: fixes from reading SnapPool's code
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:** `SNAPPOOL-TRACKING.md` v1.2:
  - keeps SnapPool's `/host` login guard unchanged, and runs the click capture only on the pages ads land on. Today's middleware is only that guard, and it redirects every matched request without a user to `/login`;
  - keeps click ids whole: up to 512 characters, and a longer one is dropped, never cut. The whole cookie stays under ~3.5 KB;
  - takes `page_url` from the same-origin `Referer` of the `/api/start` POST, so the form doesn't change;
  - on a repeat `/start`, keeps the earlier attribution unless the new request has one;
  - asks for three privacy-page edits instead of one paragraph, because the page promises "never share it with advertisers";
  - puts the migration on production before the deploy;
  - adds the copy-paste prompt for the SnapPool session (§7).
  - For the agent: SnapPool deletes pending requests after 30 days, so the M05a adapter reads at least daily and keeps what it has read.
- **Why:** Writing the prompt meant reading SnapPool's middleware, `/api/start`, `startPool()`, security headers and privacy text (commit `a6c190a`). Each point above was a gap in v1.1 that would have broken signups or `/host`, lost click ids, or left the privacy page contradicting itself.
- **See:** `SNAPPOOL-TRACKING.md` §1, §3, §6, §7 · BLUEPRINT M05a

### D-065 — M00 build choices: toolchain, source resolution, one Doppler token per service
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - **Node 24.21.0** stays pinned (`.nvmrc`, `engines`), because Node 26 only becomes LTS on 2026-10-28. Re-check after that date (GOTCHAS).
  - **TypeScript 6.0.x, not 7.** typescript-eslint doesn't support TypeScript 7 yet.
  - Workspace packages resolve each other's **TypeScript sources** through the `@ads/source` export condition. `dist/` is only for production builds. So typecheck and tests never need a build first.
  - **One Doppler service token per process** (`DOPPLER_TOKEN_WORKER`, `DOPPLER_TOKEN_GATEWAY`), kept in a git-ignored `.env` next to `docker-compose.yml` on the SER9. The image's entrypoint runs `doppler run` only when a token is set, so the gateway's write key never reaches the worker's environment.
  - CI also runs a format check and a Docker smoke test of both entry points.
- **Why:** M00 had to choose these. None changes a product decision. The per-service token is the simplest way to keep "env via `doppler run`" and the separate worker and gateway configs (PROPOSAL §10) while running both from one compose file.
- **See:** `docs/milestones/M00-scaffold-contracts-boundaries-ci.md` · PROPOSAL §16 T3 · GOTCHAS

### D-066 — M01a build choices: Drizzle 0.45, migration naming, grants the gateway needs, seed file
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - **Drizzle 0.45.3 / drizzle-kit 0.31.11 with node-postgres (`pg` 8.23)**, the stable releases; 1.0 is still a release candidate. Move when 1.0 is `latest` (GOTCHAS).
  - The first migration is **`0000_init`**: drizzle-kit numbers from 0000. `db:migrate` applies the migrations **and then `roles.sql`**, which revokes and re-grants everything, so it is safe to re-run and covers new tables.
  - **Role grants, filled in from what the pipeline actually does** (BLUEPRINT §4 "Database roles"):
    - `agent_gateway` also gets: `INSERT` on `proposals` and `proposal_versions` (`ads-gw revert` creates the undo proposal, BLUEPRINT §6); `UPDATE (reverted_by_revision_id)` on `change_log` (links a change to its undo); `UPDATE (status)` on `products` (halts on `needs_attention`); `UPDATE` on `jobs` (its own queue, M01b); `INSERT, UPDATE` on `api_usage`.
    - `agent_worker` gets `SELECT` only on `change_log` (the plan said "except inserting"; it needs no update or delete either).
    - `agent_dashboard` reads everything except `credentials` and `credential_access`, and reads outcomes through the view **`dashboard_outcomes`** (no `hashed_contact`), instead of a view per table.
  - `accounts` and `credentials` get a `product_id` index (invariant 11; the §4 SQL had left them out). A test now checks every product-scoped table.
  - **The seed data lives in `products/seed.json`**, not in `packages/db`, so shared code holds no product names (hard rule 2). It also creates SnapPool's own offering (`snappool`). The seed never overwrites existing rows, and `writes_enabled` starts `false`.
  - CI runs a Postgres 16 service for the tests and fails if `schema.ts` changed without a migration.
- **Why:** M01a had to choose these, and writing the repositories showed the gateway couldn't do its documented undo and halt steps with the listed grants. None changes a product decision.
- **See:** `docs/milestones/M01a-database-schema-repositories.md` · BLUEPRINT §4 · `packages/db/sql/roles.sql`

### D-067 — Code review of M01a: fixes, and code-review becomes a closing step
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted. Marcus asked whether sessions run a code review; they didn't.
- **Decision:**
  - **Fingerprint fields live in contracts:** `fingerprintFieldsFor(action)` in `contracts/undo.ts` is the single definition (was `gateway/src/precondition.ts`). The worker's undo proposals must store the same fields the gateway checks, and the worker may not depend on the gateway. The gateway still computes the derived values (M11a).
  - Fixes from the review, each with a test that fails on the old code:
    - undo proposals take an advisory lock instead of `SELECT … FOR UPDATE`, because the worker may only read `change_log`;
    - account and entity upserts never overwrite another product's row, and an entity's account must belong to its product and platform;
    - metrics refuse duplicate (entity, day) rows; search-term duplicates are summed;
    - bulk writes are split into 1,000-row batches inside one transaction;
    - snapshots use `clock_timestamp()`;
    - `schema.ts` takes the platform, entity-type and proposal-status lists from contracts;
    - CI's migration check can't hang on a drizzle-kit prompt.
  - **The `close-milestone` skill now runs `code-review` (high)** over the milestone's diff, and every confirmed finding is fixed or answered before the PR is marked ready.
- **Not changed:** `recordDecision` still re-locks a proposal it already holds. That costs one extra savepoint per decision, and the change isn't worth the risk.
- **See:** BLUEPRINT §3.6, §6 · `.claude/skills/close-milestone/SKILL.md` · `docs/milestones/M01a-database-schema-repositories.md`

### D-068 — M01b build choices: the queue lives in db, gateway may write credentials, request semantics
- **When / who / status:** 2026-09-25 · Claude (fix) · adopted
- **Decision:**
  - **The job queue, its runner, the LISTEN helper and the leader lock live in `@ads/db`** (`packages/db/src/queue/`), not `core/queue`. The gateway runs the `gateway` queue, and the gateway may not depend on `core` (BLUEPRINT §2). `core` keeps the request processor and recovery.
  - **Queue details:** a claim counts as an attempt, so a job that keeps crashing its process still reaches `max_attempts`. Backoff is 1 min × 2^(attempt−1). A job that fails for good queues a `job_failed` notification (the alert to Marcus). The runner reclaims expired leases on its queue at every poll, claims only kinds it has handlers for (so an older replica never fails a newer job kind), and releases a job interrupted by shutdown without counting the attempt.
  - **Leader lock:** the leader pings its connection every retry interval and steps down if the ping fails; TCP keepalive on both sides, so a silently dead network doesn't leave two leaders or a stuck lock.
  - **Vault:** master keys are `<id>:<base64 32 bytes>` with ids `read-vN` / `write-vN`; the class decides which roles a key opens. Ciphertexts are bound to their account and role (AAD). **`agent_gateway` gets `INSERT, UPDATE` on `credentials`**, for `ads-gw credentials put` and key rotation.
  - **Requests:** allowed actors come from `OPERATOR_ACTORS` (comma-separated `channel:id`, kept in Doppler). `halt` with no product halts every *active* product (dormant ones stay dormant); `resume_agent` resumes only *halted* ones. `settings_patch` merges plain objects key by key and replaces anything else (`null` unsets); unknown keys are refused by name; tighten-only is checked against the core defaults **and each platform's defaults** (M05a adds the pack layer). Telegram and the CLIs record and process a request in one transaction.
  - **From the M01b security review:** the processor trusts the `actor` column, which whoever inserts the row sets. M10a (when the dashboard starts inserting rows) binds each row to the database role that inserted it. Until then only the worker and CLIs insert rows, and they hold full DB rights anyway.
- **Why:** building M01b needed these choices, and the dependency rules made `core/queue` impossible for the gateway. None changes a product decision.
- **Instead of:** `core/queue` (the gateway couldn't use it); a separate credentials role for the CLI (more setup for Marcus, no extra safety: the gateway can't read read-rows without the read key).
- **See:** `docs/milestones/M01b-queue-leader-vault-requests.md` · BLUEPRINT §1, §4 "Database roles", §5.2–5.4

### D-069 — M02 build choices: the Meta read connector
- **When / who / status:** 2026-10-02 · Claude (fix) · adopted
- **Decision:**
  - **Graph API `v26.0`**, pinned in `GRAPH_API_VERSION` (`connector-meta/src/version.ts`). The client never sends `date_format` and never uses root `GET /?ids=`: both error on every version from 2026-10-27.
  - **Transport:** GET only; `appsecret_proof` on every call; cursor pagination (`paging.cursors.after` while `paging.next` exists, capped at 200 pages); a 60 s per-request timeout. Throttling (HTTP 429, codes 4/17/32/613/80000–80014) waits for the longer of Meta's `estimated_time_to_regain_access` and an exponential back-off (1 s doubling, cap 30 s), but **never more than 60 s**: a longer wait throws `MetaRateLimitError` with the retry time. At 90% usage the client pauses 10 s. Only network failures, timeouts, 5xx and Meta's transient codes are retried; anything else surfaces at once. Error messages are scrubbed of tokens and name fields, never values.
  - **Mapping:** ad set = `ad_group`. **Clicks = link clicks** (`inline_link_clicks`), comparable to Google clicks. **Platform conversions** = the sum of the insights action types for the Meta feedback routes of the **primary KPI stage** only (`eventName` → `offsite_conversion.fb_pixel_<event>`, standard events only; the live recording confirms the mapping), so funnel stages are never added together; the trust check watches that stage's dataset, or any Meta dataset in the settings if that stage has no Meta route. Counts beyond 6 decimals are truncated (a count is never money); conversion values are exact micros. `budget_shared` is always false (Meta has no shared budgets); `attributes` holds the configured status, budget type, lifetime budget, bid strategy, objective, special ad categories and the ad set's attribution spec. A snapshot is the tracked fields (name, statuses, budgets, budget type, bid strategy), so it includes the fingerprint fields.
  - **Money:** only currencies with a confirmed Meta offset are accepted (SGD and other 100-offset currencies); any other currency is refused, never guessed.
  - **Contracts (fields added, nothing renamed):** `AdEntityRecord.attributes`; `MetricRow.platformConversionValueMicros` and `attributionSetting`; `TrustSignalRow.datasetEventsReceived` and `datasetLastEventAt`; `getAccountInfo` returns `amountSpentMicros`.
  - **Fixtures:** hand-written cassettes in `packages/connector-meta/fixtures/meta/`; real ones are recorded by `pnpm --filter @ads/connector-meta record` (needs `RECORD=1` and the read-token JSON file) into `fixtures/meta/recorded/`, and `test/recorded.test.ts` replays them automatically. The recorder is dev tooling in the connector, not part of `ads sync`, because the worker app may not depend on `connector-testing` (BLUEPRINT §2).
  - **`ads accounts link | list | set-status`** (worker CLI): setup, like `ads credentials`. It writes only the `accounts` table, so Marcus can link an ad account for the live steps. Nothing else in the plan links accounts.
  - **`ads sync --dry`** is `dryRunSync` in `core/src/sync/dryRun.ts`: the trailing 28 days in the account's timezone, trust signals over the last 7, paused or disconnected accounts skipped, one error per account without stopping the others, counts only (no names).
- **Why:** building M02 needed these choices. None changes a product decision.
- **Instead of:** `clicks` (all clicks, including likes and profile clicks); sleeping for as long as Meta asks (a sync could hang for an hour); guessing a currency offset.
- **See:** `docs/milestones/M02-meta-read.md` · BLUEPRINT §3.6, §5.7 · GOTCHAS "Meta …" rows

### D-070 — Google API access comes from the Cloud project; no developer token
- **When / who / status:** 2026-10-02 · Claude (fix) · adopted. Marcus found it while setting up T5: the manager account's API Center now offers only a form for a different, app-only API.
- **Decision:**
  - **No developer token.** On 2026-09-09/10 Google moved Google Ads API access from the manager account's API Center to the Google Cloud project. The access level belongs to the Cloud project whose credentials sign in; the `developer-token` header is optional and ignored (a future major API version will reject it); the API Center no longer issues tokens. Nothing in this system sends or stores one.
  - **Explorer access is the plan.** It comes with enabling the Google Ads API in the Cloud project, reaches real accounts, and allows 2,880 operations a day; our sync needs well under 500. Apply for **Basic** (15,000 a day) only if `api_usage` nears the cap: an application now needs the Cloud project's **brand verification** (homepage, privacy policy and terms on a verified domain), after which Basic is reviewed in minutes, so there's no lead time to beat.
  - **The manager account (MCC) stays.** It holds the property and SnapPool ad accounts, and the agent reaches both through it (`login-customer-id`).
  - **If Google user logins are used** (D-046 as written): each login needs a **passkey** before it can create a new API sign-in (mandatory since 2026-08-05; a new passkey may take up to 7 days to be fully trusted), and the Cloud project's OAuth app must be published **In production** (in "Testing", sign-ins expire after 7 days).
- **Why:** the plan told Marcus to get a developer token from the API Center, which no longer issues them for the Google Ads API.
- **Instead of:** a developer token from the MCC's API Center, plus an early Basic application (PROPOSAL v3.4, T5).
- **See:** PROPOSAL §6.13, §7, §16 T5 · BLUEPRINT M03 · GOTCHAS "Google Ads API" rows

### D-071 — Two Google service accounts instead of two Google logins
- **When / who / status:** 2026-10-02 · Claude (needs OK) · **proposed** (Q13). Supersedes D-046 if approved.
- **Decision:** the agent signs in to Google Ads as two **service accounts** (robot identities in the Cloud project), added directly as users of the manager account (Admin → Access and security; Google has supported this since 2024-11-27): `ads-agent-read` with **Read only** access for sync, and `ads-agent-write` with **Standard** access for writes and uploads. Each one's key file goes into the vault (`read` and `write` roles), like Meta's system-user tokens. D-046's read/write split stays exactly as it is.
- **Why:** no refresh tokens, no OAuth consent screen, no passkeys, and nothing that expires; it matches the Meta setup (system users). Google's passkey rule doesn't apply to service accounts.
- **Risks / to verify:** whether the **Data Manager API** (conversion uploads, M13) accepts a service account (unverified; if not, the write side adds one Google login for uploads only); a Cloud *organization* created after mid-2024 may block service-account key creation by default (an org policy), which doesn't affect a project without an organization.
- **Instead of:** two Google logins, each with a passkey and an OAuth refresh token (D-046).
- **See:** QUESTIONS Q13 · PROPOSAL §6.1, §16 T5 · BLUEPRINT M03

### D-072 — The Google connector calls the Google Ads REST API with its own fetch client
- **When / who / status:** 2026-10-02 · Claude (fix) · adopted (M03 confirms the details when it starts). Marcus asked what code or design D-070 changes.
- **Decision:** `connector-google` (and later `connector-google-write`) call the Google Ads **REST** API directly with `fetch`, the same pattern as M02's Meta `GraphClient`: `POST https://googleads.googleapis.com/<version>/customers/<id>/googleAds:searchStream` for reads, and the `:mutate` endpoints with `validateOnly` for writes (M13). The API version is pinned in one constant. **No developer token** is sent. Signing in goes through one small token-provider interface, so Q13's answer changes only that piece: a service account's key (D-071) or a login's refresh token (D-046). The token exchange happens outside the recorded `fetch`, so fixtures never hold it.
- **Also for M03:**
  - the Explorer cap (2,880 operations a day) belongs to the **Cloud project**, so the soft cap sums every Google account's `api_usage` for the day;
  - the manager account's id goes in the `login-customer-id` header (where it's stored is M03's call);
  - the redactor and the secret scanner also catch PEM private keys and `private_key` fields (service-account key files).
- **Why:** the planned library, `google-ads-api` 25.1.0 (its published code, checked 2026-10-02):
  - requires `client_id`, `client_secret`, `developer_token` and a per-customer `refresh_token`, so it can't use service accounts;
  - always sends a `developer-token` header, which a future major API version will reject;
  - sends reads through axios and everything else over gRPC, which `connector-testing`'s `fetch` recorder and replayer can't capture;
  - lags Google by 1–2 months, with one API version per release.
- **Instead of:** `google-ads-api`, pinned together with the API version (PROPOSAL §7 and §10, v3.5).
- **See:** BLUEPRINT M03, M13 · PROPOSAL §7, §10 · GOTCHAS `google-ads-api` row


### D-073 — M03 build choices: the Google read connector
- **When / who / status:** 2026-10-06 · Claude (fix) · adopted
- **Decision:**
  - **Google Ads API `v25`**, pinned in `GOOGLE_ADS_API_VERSION` (`connector-google/src/version.ts`). Minor releases share the major version's endpoint, so only the major version is pinned. Reads use REST `googleAds:searchStream` (one request = one operation); no developer token (D-070).
  - **Sign-in:** one `AccessTokenProvider`; the vault's `read` credential is either a service account's key file (signed JWT, D-071) or `{ "type": "authorized_user", client_id, client_secret, refresh_token }` (D-046: the OAuth client sits in the vault with the refresh token, not in Doppler). Its `type` picks the provider, so Q13's answer needs no code change. The token exchange uses its own `fetch`, never the recorded one, and only ever posts to `https://oauth2.googleapis.com/token`.
  - **Manager account:** stored in the new nullable `accounts.login_customer_id` (Google only, 10 digits), set by `ads accounts link --platform google --account <id> --manager <mcc id>` and cleared by `--no-manager`. With none stored, the dry sync finds it (`listAccessibleCustomers`, then `customer_client` one level down) and says how to store it.
  - **GAQL:** built only by `gaql()` from an allowlist of resources and fields, with literals that must come from `lit.*` (ids are digits, enums A–Z_, real dates, resource names); a hand-made literal is refused.
  - **Mapping:** keyword = `<adGroupId>~<criterionId>` (positive keywords only; negatives come later with the negative-keyword actions). `raw_status` = the advertiser's `status`; the normalised status also reads `primary_status` (its parents included, like Meta's `effective_status`): `PENDING` → pending; `LIMITED`, `NOT_ELIGIBLE`, `MISCONFIGURED`, `ENDED` → limited. A campaign's daily budget comes from its budget (`DAILY` period only). `budget_shared` = `explicitly_shared`; if Google omits it, a budget serving several campaigns counts as shared, and otherwise it's null (unknown, never assumed unshared). Google ads are not read in Phase 0.
  - **Conversions:** platform conversions count the **primary KPI stage's** conversion actions only (the Google feedback routes' `destinationId`s), via `segments.conversion_action` and `metrics.all_conversions` (counted whether or not the action is "primary" in Google), kept by action id in code so an action owned by the manager account counts too, as D-069 does for Meta. The conversion value (a double in currency units) becomes micros through `toFixed(6)`, with no float arithmetic.
  - **Trust signals (Google):** clicks, spend and KPI conversions over the range, `autoTaggingEnabled`, `conversionActionsEnabled` and `conversionActionsMissing` (contract fields added; Meta's are unchanged).
  - **Quota:** every request (after sign-in) first asks the quota meter (in core, on `api_usage`, counted per UTC day, checked under an advisory lock); the sync's soft cap is **2,000** operations a day across all Google accounts, leaving the rest of Explorer's 2,880 for the gateway. Google's daily-quota error is never retried; short rate limits wait for Google's `retryDelay` up to 60 s.
  - **Fixtures:** cassettes now store the JSON request body and the `login-customer-id` header, and match on them (never `authorization`). The redactor and scanner also catch PEM keys, `private_key`/`assertion`/`id_token` fields, JWTs, and click ids and search terms, including inside resource names.
- **Why:** building M03 needed these choices. None changes a product decision.
- **Instead of:** `metrics.conversions` (all "primary" actions, which can add funnel stages together); a developer token; free-form GAQL strings; storing the manager id in the credential.
- **See:** `docs/milestones/M03-google-read.md` · BLUEPRINT §4, §5.7 · GOTCHAS "Google …" rows

### D-074 — Build first, set up accounts at the end of Phase 0
- **When / who / status:** 2026-10-06 · Marcus · adopted. He asked to merge M03 and keep building "without all the account creation; we can do it at the end".
- **Decision:**
  - The cloud builds carry on milestone by milestone (M04, M05a, … up to M07's cloud part) without the setup tasks (T1–T14, T6b) and without the live steps. Each milestone depends on the previous ones' **code**, not on their live acceptance; connectors keep building against hand-written fixtures.
  - Every merged milestone stays `awaiting live acceptance`, and its live steps stay listed in `NOW.md`. They're run together **at the end of Phase 0**, after M07's cloud part: first the setup tasks, then the live steps in milestone order (M00, M01a, M02, M03, …), then the real fixture recordings, whose differences a session fixes.
  - Q13 can be answered then too: it only changes the Google setup (both sign-in types are built, D-073).
  - The Phase 0 → 1 gate (PROPOSAL §12) needs the agent running on the real accounts for weeks, so it can't start measuring until that setup is done. M08 can't start before the gate.
- **Why:** Marcus is moving house and working from a work machine for now, so he can't create or copy secrets. Building ahead uses the time.
- **Risk:** differences between Google's or Meta's documents and the real responses show up later, when the recordings run, and may need fixes in several milestones' code at once. The unverified points are listed in GOTCHAS so the end-of-phase session knows what to check first.
- **Instead of:** running each milestone's live steps before starting the next.
- **See:** `docs/process/SESSIONS.md` "Live steps" · NOW.md "Live steps for Marcus"

### D-075 — M04 build choices: the sync stage, drift, trust checks and the cycle
- **When / who / status:** 2026-10-06 · Claude (fix) · adopted
- **Decision:**
  - **`tracking_active` for upload-only products.** When the KPI stage reaches a platform through a feedback route (the agent's uploads) and nothing was uploaded to that platform in the 7 days, zero platform conversions give `no_signal`, not `fail`. Once the agent has uploaded and the platform still shows none, it fails as before.
  - **Account sync state** (migration `0002`): `accounts.trust_signals` (the last successful sync's `TrustSignalRow` with its range and read time, validated on write and read), `accounts.last_sync_error`, and `accounts.clicks_synced_through` (Google only). The trust stage reads only the database, so a resumed cycle calls no platform.
  - **One sync stage** for both platforms (`core/src/sync/stage.ts`), sharing the client opening with the dry run. A failing account is recorded and the others carry on; `data_fresh` then judges its age. Google's unknown `budget_shared` is stored as `true` (never changed by us). A resumed sync skips the accounts it already synced.
  - **Drift:** the status compared is the configured one (Meta configured status, Google `status`); an action of ours explains a change only if it targets the entity (a Google budget and its campaigns count as one) and set that value. Drift is written in the snapshot's transaction, with `expected`/`observed` stored as `{"value": …}` (drizzle's jsonb reader turns numeric-looking strings into numbers).
  - **Missing entities:** a known entity left out of a listing is read by id (at most 50 per account and sync); `EntityNotFoundError` (contracts; Meta error 100/33, an empty Google result) records it as `removed`, raw status `NOT_FOUND`.
  - **Click ids:** from the stored day (read again) to yesterday, at most 90 days back. **Search terms:** stored with `conversions` 0 until M06a adds per-term KPI conversions.
  - **Cycle:** stages are a list of functions; a named advisory lock (`cycle:<id>`, its own connection) keeps one runner per cycle; a same-day restart of a scheduled cycle continues it, and a manual run continues today's unfinished manual cycle; `--until` is checked before each stage and leaves the cycle resumable; after a trust `fail` only the `reported` stage may run. Cycles are timed on the worker's clock (like `last_synced_at`); snapshots are dated on the database's clock when the platform was read (like `change_log.applied_at`), and a read older than the latest snapshot is ignored. Worker startup resumes unfinished daily and weekly cycles (manual ones never run on unasked) and closes those unfinished for more than 24 hours as abandoned.
- **Why:** building M04 needed these choices. As written, `tracking_active` would have failed every SnapPool cycle until Phase 2, because SnapPool has no pixel or tag (D-060) and its conversions reach the platforms only through the uploads built in M12/M13; that would have blocked the Phase 0 gate.
- **Instead of:** `tracking_active` failing on zero conversions whatever the conversion path; re-reading the platforms in the trust stage; leaving unknown shared-budget flags as `false`; no lock (two runners on one cycle).
- **See:** `docs/milestones/M04-sync-drift-trust.md` · BLUEPRINT §3.6, §4 (`accounts`, `drift_events`), §5.6–5.8, §5.9

### D-076 — M05a build choices: packs, settings, the SnapPool adapter and outcome reads
- **When / who / status:** 2026-10-06 · Claude (fix) · adopted
- **Decision:**
  - **Feedback routes may wait for their destination.** `FeedbackRoute.destinationId` is `null` until the Meta dataset (T4) or the Google conversion action (T11) exists. Nothing is uploaded on such a route (M12/M13 skip it), but it still says the stage reaches that platform through uploads, so `tracking_active` stays `no_signal` before Phase 2 (D-075). The Meta read config still counts the route's event; the Google one warns and counts nothing. The SnapPool pack's default routes ship with `null`.
  - **Two email hashes.** Meta normalises an email by trimming and lower-casing; Google's Data Manager also removes all whitespace and the dots before the `@` of a Gmail address. One hash can't serve both, so `HashedContact` gains `emailSha256Google`, and `hashEmail()` (contracts) computes both inside the adapter.
  - **`definePack`** checks a pack once: id and semver, the default outcomes and copy, unique phases, a fact schema that is a zod object convertible to JSON Schema (input side), `requiredForCopy` keys in it, thresholds only for known finding types, tighten-only guard overrides against the core and every platform default, valid disabled actions, platform policy and brief sections, a non-empty `analystContext`, and the runtime's two functions. A defined pack is frozen; defining it again returns it unchanged. The **registry** (`createRegistry`) is built by the apps (the worker's `INSTALLED_PACKS`) and passed to core. The **threshold engine** fails closed when the pack sets no threshold for a finding type. The **manifest document** stores the fact schema as JSON Schema; the worker publishes the installed packs' manifests at startup.
  - **Settings.** A new product's settings are the core defaults plus its pack's outcomes and copy defaults (`settingsFromPack`). The pack's guard overrides are a tighten-only layer between the platform defaults and the product's own, checked by `settings_patch` and before every cycle. A stored document that fails validation throws `InvalidSettingsError`: the cycle doesn't run (summary `blocked`) and an `alert` notification is queued. A `settings_patch` merges onto the stored document as it is, so it can repair one; `halt` works whatever the settings say. `ads settings get|set|history`: `set` records a `settings_patch` as `cli:<ADS_OPERATOR or login name>`, which must be in `OPERATOR_ACTORS`.
  - **Seeding moves to `ads seed`** (worker CLI; `db:seed` is gone): a product in `products/seed.json` without `settings` gets its pack's defaults. `snappool` now does; `property-sg` keeps its stub until M05b.
  - **Outcome reads.** The sync stage reads each product's outcomes through its pack: 35 days back every time (more than SnapPool keeps pending requests), paged by time, events for unknown stages left out. Outcomes are kept (insert only), except `is_test`, which follows the latest read, so a test domain added later excludes recent outcomes too. `outcomes.web` stores the browser context (not in `dashboard_outcomes`). How the read went is stored in `products.outcome_source` (migration `0003`), and `outcome_source_fresh` (product level) reads it: unread, unreadable or older than 26 hours fails; healthy with no activity within `maxOutcomeStalenessHours` warns.
  - **The SnapPool adapter** reads with `SNAPPOOL_DATABASE_URL` (T6a) in a read-only transaction. Stages: `pool_request` (`created_at`), `signup` (claimed requests only, `claimed_at`), `activated` (the claimed pool's `events.first_upload_at`, source id `events.id`). Ids come from `pool_requests.attribution` (live since 2026-09-25): click ids whole up to 512 characters, `utm_*`, and with `utm_source` google or meta the platform ids from `utm_campaign`/`sp_agid`/`sp_adid` when they're digits. Test traffic: a listed domain or a subdomain of one, or the superadmin. Phases: `pricing.phase` from the offering facts, else beta until 2026-11-30 (Singapore), then standard.
  - **`facts_put` moves to M05b** (cut first in M05a's session plan).
- **Why:** building M05a needed these choices. The pack defaults can't know account-specific destination ids, and the two platforms hash emails differently (GOTCHAS, checked 2026-10-06).
- **Instead of:** an empty feedback list (which would make `tracking_active` fail before Phase 2), one email hash, seeding from fixed settings in `products/seed.json`, and reading outcomes only from a cursor.
- **See:** `docs/milestones/M05a-pack-sdk-snappool.md` · BLUEPRINT §3.3, §3.5, §4 (`products`, `outcomes`), §5.8, M05a, M05b · GOTCHAS

### D-077 — M05b build choices: the property pack, attribution, the two trust checks, product docs and facts
- **When / who / status:** 2026-10-07 · Claude (fix) · adopted
- **Decision:**
  - **The property pack** (`packages/packs/property-sg`, the G8 commit c1d9798 touches no core, gateway or connector file). Feedback routes `form_fill → Meta Lead` and `form_fill → Google`, destinations unset: the agent's uploads are the one path, as for SnapPool (D-060, D-076). The CEA required strings are placeholders (`[agency name]`…), so every copy check fails until Marcus enters them (T13). `detectPhase`: the last launch phase whose `launchDates` day has started, 00:00 Singapore time; teaser before any.
  - **The Airtable adapter** reads the leads table over `fetch` (env `PROPERTY_AIRTABLE_TOKEN`, `PROPERTY_AIRTABLE_BASE_ID`, `PROPERTY_AIRTABLE_TABLE`), only the fields in `LEAD_FIELDS`, the email hashed inside the pack. `form_fill` = the record's creation time; `qualified_viewing` and `booked` = date fields Marcus fills in, counted once their day has come. Pages are paced under 5 requests a second; the health check is one call over 14 days. The base wasn't reachable, so the field names are a guess written against a **hand-made fixture**; they're confirmed when property resumes (live Airtable wiring).
  - **One `utm_source` → platform mapping** in contracts (`platformOfUtmSource`), used by both packs and by attribution.
  - **Attribution** (`core/attribution`): the four methods of §5.12; platform ids try the campaign id, then an ad group / ad set / ad id walked up to its campaign; the gclid window is 90 days (a day of slack); the utm match is on the platform `utm_source` names, matches nothing for a source that isn't an ad platform or a name two campaigns share. Outcomes found `none` are retried for 7 days (a same-day click's id arrives with the next day's click sync); new outcomes come before retries in a batch. It runs in the cycle's sync stage after both reads, and in `ads outcomes`, which shows the KPI stage's rate (`attribution.ratePct`, by method) and `attributed` per stage. Test outcomes are attributed but never counted.
  - **`attribution_gap`** (per account): the platform's KPI conversions against our non-test KPI outcomes attributed to that account's campaigns, over the same account days (the signals' range, in the account's time zone); gap = difference ÷ the larger count; no signal below `minOutcomesForGap` on both sides, or for an upload-only route before any upload (as D-075). **`id_capture`** (product): the share of the last 7 days' non-test KPI outcomes carrying a click or platform id (not utm values alone, not `fbp`); no outcomes is no signal, low volume is still judged (the §5.8 table).
  - **Product docs.** `ads seed` creates version 1 of each document from `products/<slug>/*.md`, never replacing a later version. `product_doc_put` refuses a stale base and a document over 20,000 characters (the analyst reads every document in full). `ads docs list|get|set`; `set` needs `--base-version` once a document has a version, so a version written meanwhile is never overwritten unseen.
  - **`facts_put`** validates against the pack's fact schema and refuses unknown keys by name, inside lists too (the same check now applies to `settings_patch`); a product whose pack isn't installed is refused. No CLI: the dashboard's fact form (M10a) is the surface.
- **Why:** building M05b needed these choices; the code review (D-067) shaped the utm, retry, window, `fbp`, docs and Airtable ones.
- **Instead of:** matching `utm_campaign` whatever the source, marking unmatched outcomes `none` for good, comparing over a rolling UTC window, `set` defaulting to the latest version, and per-pack copies of the utm mapping.
- **See:** `docs/milestones/M05b-property-pack-attribution-docs.md` · BLUEPRINT §5.8, §5.12, M05b · GOTCHAS (Airtable)

### D-078 — AI SDK 7, with Langfuse's AI SDK 7 integration
- **When / who / status:** 2026-10-07 · Claude (fix) · adopted
- **Decision:**
  - `core/model` uses **AI SDK 7** (`ai` 7.0.130, pinned) instead of AI SDK 6. The call the plan names stays: `generateText` with `output: Output.object({ schema })`, read from `result.output`. What changes: the instructions go in `instructions` (was `system`), telemetry options in `telemetry` (was `experimental_telemetry`), and tracing is a telemetry **integration** registered once.
  - **Tracing:** `@langfuse/vercel-ai-sdk` (`LangfuseVercelAiSdkIntegration`) creates the spans, and `@langfuse/otel`'s `LangfuseSpanProcessor` on an OpenTelemetry `NodeTracerProvider` exports them; product, cycle and stage are set as trace attributes with `propagateAttributes` (`@langfuse/tracing`). Keys from Doppler: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`. No keys = no tracing (the calls still run).
  - **Providers:** `@ai-sdk/anthropic`, `@ai-sdk/openai` and `@ai-sdk/openai-compatible` (local endpoints), chosen per stage by `MODEL_<STAGE>=provider:model`.
  - **T9** also covers the AI provider key: `ANTHROPIC_API_KEY` in Doppler `dev` (and `worker` from M07).
- **Why:** AI SDK 7 is the current major version (6.x moved to the `ai-v6` tag), and Langfuse's maintained integration requires it (GOTCHAS, checked 2026-10-07). The plan's API survives unchanged, so this is a version fix, not a design change.
- **Instead of:** AI SDK 6 with `experimental_telemetry: { isEnabled: true }` on every call, which would start the agent on a superseded major version.
- **See:** PROPOSAL §10 · BLUEPRINT §5.17, M06a · GOTCHAS (AI SDK, Langfuse) · `docs/milestones/M06a-ai-layer-findings-detectors.md`

### D-079 — M06a build choices: the model layer, finding targets, evidence and the first detectors
- **When / who / status:** 2026-10-07 · Claude (fix) · adopted
- **Decision:**
  - **Models.** `MODEL_<STAGE>=provider:model` (`anthropic`, `openai`, `openai-compatible` with `MODEL_OPENAI_COMPATIBLE_BASE_URL`); every stage defaults to `anthropic:claude-fable-5-1`, the strongest available model (D-041). `generateStructured` retries once when the output fails the schema (the retry adds a short note), and gives up with `StructuredOutputError`. **Cost** is in **USD micros** (the providers bill in dollars) from a price table per model, overridable with `MODEL_PRICES`; an unpriced model is refused before the call (a local model is free). The cost of every attempt is added to `cycles.model_cost_micros`, failed ones included. **Personal data:** email addresses and international phone numbers are replaced in the prompt before it is sent, and masked again in exported spans. **Tracing** has no global registration except the async context manager; `ads model ping` sends one traced call.
  - **Finding targets** (migration `0004`): a finding targets an ad entity, else an ad account (`target_account_id`), else, with both null, the whole product. `tracking_gap` is about an account and `pacing_risk` about the product, which the old `target_entity_id not null` couldn't hold.
  - **Evidence.** `ComputedEvidence` gains `from`, `to`, `dataDays` and an optional `detail` (the rule's own computed figures). Windows end yesterday (the product's days) and are stretched to the threshold's `minDays`. `dataDays` counts from the target's first metrics day or first sighting, whichever is earlier, so a new entity has few. Accounts and the product sum campaign rows only. Outcomes: a campaign's attributed outcomes; below campaign level only those carrying the entity's platform id (Google ad group, Meta ad set or ad); an account's campaigns'; the product's all (attributed or not); test traffic never.
  - **Detectors** keep a candidate only when its rule holds **and** the pack's threshold is met (no threshold = none). Built: `zero_outcome_spend` (active campaigns; spend and clicks, no KPI outcome), `tracking_gap` (accounts whose `tracking_active` failed or `attribution_gap` warned this cycle), `pacing_risk` (month to date projected linearly over the month: above 100% or, while spending, below 60% of the monthly ceiling; none without a ceiling or before the 2nd), `wasteful_search_term` (Google; only accounts whose `tracking_active` passed this cycle; terms up to 80 characters, Google's keyword limit; the term travels as `negativeText`, as data). `zero_outcome_spend` judges a platform's campaigns only when some recent KPI outcome carries that platform's ids (until T14, Google's can't be attributed, so zero would mean nothing); `wasteful_search_term` only judges ad groups under an active campaign, and terms of at most 10 words. Summaries use computed figures only, never platform text, and name the KPI stage by its id. The detect stage replaces a cycle's detector findings on a rerun.
  - **Per-term KPI conversions** (Google): a second `search_term_view` query segmented by conversion action, kept for the KPI actions (D-073's rule).
  - **Moved:** `cost_spike` and `no_delivery` (the plan's cut-first items) to M06b; `budget_limited_efficient` and `overspend_inefficient` to M14, where they first make proposals. The session reached its token checkpoint after Builds 1–2.
  - **Tests:** the vitest config resolves Node-side imports without the `module` condition (OpenTelemetry's ESM build only loads in a bundler).
- **Why:** building M06a needed these choices; the plan's schema couldn't store account- or product-level findings, and per-term conversions from an upload-only product mean nothing before its uploads (D-075).
- **Instead of:** pinning product-level findings on an arbitrary campaign, judging search terms on conversions that can't arrive yet, and guessing prices for unknown models.
- **See:** `docs/milestones/M06a-ai-layer-findings-detectors.md` · BLUEPRINT §3.7, §4 (`findings`), §5.9, M06b, M14 · GOTCHAS (AI SDK, Langfuse, Claude prices, per-term conversions)
