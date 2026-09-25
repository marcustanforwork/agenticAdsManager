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
- **proposed:** Claude's recommendation; the plan is written this way, but it waits for Marcus's OK (QUESTIONS Q1).
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
- **When / who / status:** 2026-09-25 · Claude (needs OK) · **proposed** (Q11) · **Supersedes:** D-047
- **Decision:**
  - SnapPool remembers the ad-click details in a first-party cookie, and saves them on the `/start` request, together with the browser user agent and page URL (Meta requires both for website events). There's no IP address and no browser pixel or tag.
  - The agent uploads `pool_request` (Meta `Lead`) and `signup` (Meta `CompleteRegistration`; Google click conversion) server to server: one daily batch while Marcus approves them by hand, hourly once auto-approved.
  - Feedback is configured as **routes**, so a stage can go to several platforms, and a platform can take several stages.
- **Why:** SnapPool has no tracking today (Q3) and doesn't store click ids (Q4). This is the smallest SnapPool change, it needs no CSP or cookie-consent work, and it gives one tested, capped path, so nothing is counted twice.
- **Instead of:** D-047 (SnapPool reports signups itself in real time), which assumed existing tracking.
- **See:** `docs/plan/SNAPPOOL-TRACKING.md` · PROPOSAL §8 · BLUEPRINT §3.3, §3.5, §5.13, M05a, M12, M13

### D-061 — Meta spending limit: about 500 a month, reset monthly
- **When / who / status:** 2026-09-25 · Marcus (amount, tentative) + Claude (mechanics) · adopted (answers Q8)
- **Decision:**
  - Marcus plans about **500 a month** to start. The Meta account spending limit is set at about that amount.
  - Because Meta's limit is a **lifetime total, not monthly**, it's reset on the 1st of each month, or set to auto-reset if the billing page offers that.
  - The trust check `spend_cap_headroom` warns when the limit is unset or 80% used. The digest shows its usage and gives a reset reminder on the 1st.
- **See:** PROPOSAL §6.9, §16 T4 · BLUEPRINT §5.8, M12

### D-062 — The Meta Housing special ad category applies to property ads
- **When / who / status:** 2026-09-25 · Marcus · adopted (answers Q9)
- **Decision:** The property pack declares `HOUSING` on every Meta campaign it creates. The property playbook assumes the resulting targeting limits: no age, gender or postcode targeting.
- **See:** PROPOSAL §4, §7 · BLUEPRINT M05b, M14

