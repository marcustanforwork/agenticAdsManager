# Session log

Newest entry on top. One entry per working session, written by the `end-session` skill. Stick to facts, absolute dates and links.

---

## 2026-10-24/25 — Phase 0 setup with Marcus: T1–T5 done, T6a half done
- **Where:** local (SER9) · branch `claude/elegant-goodall-ursfd8` · PR [#25](https://github.com/marcustanforwork/agenticAdsManager/pull/25)
- **Did:** refreshed the [Phase 0 Live Checklist](https://claude.ai/artifact/12LGui2vrbD3b2yxrrao4f) (versions 2–10): Q13 removed, T10 and the M08–M10b steps added, exact steps and "where it goes" per setup task, a Doppler table, safe terminal commands for secrets (hidden prompt, `-pooler` stripped, shape-checked), SnapPool's Meta and Google ids in M02/M03's commands. Checked T1 (GitHub ruleset), T2 and T3 (Doppler names; `dev` values by shape only). Created Doppler environments `worker` and `gateway` (deleted the empty Staging: 4-environment limit), linked the repo folder to `dev`, set `dev`'s `VAULT_READ_KEY` (generated, never shown) and `OPERATOR_ACTORS`. Guided T4 (Meta) and T5 (Google) by screenshot. T6a: a read-only check found the console-made `ads_agent_ro` was a `neon_superuser` admin; Marcus deleted it and remade it with SQL, but the new password wasn't saved to Doppler (login fails; nothing unsafe).
- **Incident:** a `doppler configure` check printed Marcus's Doppler CLI token into the session log (Claude's mistake). Marcus logged out and in again; the old token is confirmed revoked.
- **Decided:** — (no plan decisions; Marcus kept the read-only setup and chose a new Meta portfolio and ad account for SnapPool)
- **Learned:** GOTCHAS: Neon console roles are admins; Doppler free plan = 4 environments; the CLI acts as `cli:node` inside Docker (`ADS_OPERATOR`); Meta Employee system users need "Manage app" to generate a token.
- **Next:** finish T6a (NOW, Next action 1), then T9, T14, T7, T8, T10.
- **Open:** plan fixes for `update-plan` (NOW, Next action 3); the Meta spending limit.

## 2026-10-20 — PR #24 (F3) merged; the fix sessions are done
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#24](https://github.com/marcustanforwork/agenticAdsManager/pull/24)
- **Did:** CI was green on the PR's last commit (`ci`, `secret-scan`, `memory-check`), no review threads. Marcus said "let's merge the PR"; squash-merged it (D-057). F1–F3 (D-092) are all merged.
- **Decided:** —
- **Learned:** —
- **Next:** Marcus's Phase 0 setup (a session can walk him through each setup task, e.g. "walk me through T5").
- **Open:** the Phase 0 setup (no ticks yet).

## 2026-10-19 — F3 built: the pre-live rehearsal, every live-step command checked
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#24](https://github.com/marcustanforwork/agenticAdsManager/pull/24)
- **Did:**
  - F2's PR #23 was merged; reset the branch onto `main` (`ab3e2a7`); `start-milestone F3` (`docs/milestones/F3-pre-live-rehearsal.md`).
  - New test-only package `packages/rehearsal` (boundary rule in `scripts/boundary-rules.mjs`, BLUEPRINT §2): `test/rehearsal.test.ts` runs the live steps in order on an empty database (the migration script, `ads seed`, links, credentials, dry syncs, outcomes, settings; the worker with a fake Telegram over two weeks: digests, briefs, 👍 / 💡, `/status`, `/ceiling`; a restart in the middle of a sync; `ads phase set 1` and three proposals decided by button; the dashboard's Overview and Proposals and a web round trip; `ads eval replay`). Fakes in `test/support/` (platforms, model, Telegram, CLI). Source-only `exports` added to `@ads/app-worker`, `@ads/app-web`; `./testing` to `@ads/core` and `@ads/pack-saas-snappool`.
  - `test/liveSteps.test.ts`: every command in the live steps of NOW.md and the milestone files, and the runbook, checked against the CLI's command tree, the workspace's scripts and the bot's commands. All passed as written; the Phase 0 checklist artifact is unchanged.
  - Fix: `computeEvidence` takes the KPI stage and records it at 0 for a campaign, an account or the product (`packages/core/src/findings/evidence.ts`; test in `evidence.test.ts`); the property replay case regenerated from its recorded answer.
  - Test hooks: the worker passes its clock to the bot and takes a `model` (`apps/worker/src/worker.ts`); the CLI takes a `tokenFetch` (`apps/worker/src/cli.ts`).
  - Code review (high): 9 findings, 6 fixed, 1 simplified, 2 not (in the milestone file).
- **Decided:** D-095 (F3 build choices); BLUEPRINT v3.33.
- **Learned:** SnapPool's Phase 1 gets no negatives (Google sees its conversions only through Phase 2's uploads) and pauses only once signups carry click ids (T14), about two a week: its 1 → 2 gate will likely need the longer window PROPOSAL §12 allows.
- **Next:** Marcus merges F3's PR, then does the Phase 0 setup.
- **Open:** —

---

## 2026-10-19 — F2 built: request faults stop at 5, shared formatters
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#23](https://github.com/marcustanforwork/agenticAdsManager/pull/23)
- **Did:**
  - Merged PR #22 (F1) on Marcus's word (CI green), reset the branch onto `main`; `start-milestone F2` (`docs/milestones/F2-requests-formatting.md`).
  - Migration `0008`: `operator_requests.attempts`, `retry_after`; the `request_queued` trigger is a deferred constraint trigger that notifies only for a row still queued at commit.
  - Request faults: `addRequestAttempt` (`packages/db/src/repos/plumbing.ts`, backoff 1 min × 2^(n−1)); `recordRequestFault`, `faultMessage`, `MAX_REQUEST_ATTEMPTS` (`packages/core/src/requests/processor.ts`); `raiseRequestFailedAlert` (`packages/core/src/alerts.ts`); the bot's alert text.
  - Formatters in `packages/contracts/src/format.ts` (`formatMoney` by ISO 4217 minor unit, `formatUsdExact`, `countOf`, `stageWord`, `percentOf`, `costPer`) and `localTime` (`dates.ts`); core's reports and detectors, the Telegram bot and the dashboard use them; the copies are gone. Dashboard history, facts and request pages show local times.
  - Code review (high): 9 findings, 8 fixed (backoff, the innermost error instead of drizzle's query text, remaining plurals, Overview heading, one counting path, formatter cache, request page timezone, currency case), 1 not (detectors' adjective KPI name). Full checks green: 1,089 tests.
- **Decided:** D-094 (F2 build choices); BLUEPRINT v3.32.
- **Learned:** GOTCHAS: ISO 4217 vs `Intl` currency digits; a deferred constraint trigger's `NEW` is the row as inserted.
- **Next:** Marcus merges F2's PR; then a fresh session runs `start-milestone F3`.
- **Open:** the Phase 0 setup (after F3).

## 2026-10-19 — F1 built and reviewed (wording and feedback fixes)
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#22](https://github.com/marcustanforwork/agenticAdsManager/pull/22)
- **Did:**
  - Reset the branch onto `main` (PR #21 merged); `start-milestone F1` (`docs/milestones/F1-wording-feedback.md`).
  - Counts by stage id: `stageWord` / `countOf` in `packages/core/src/report/format.ts`, used by the digest, the brief and `templateWords`; the Telegram cards now say "pool requests"; the web `countOf` follows the same rule.
  - `brief_feedback` one answer at a time: contract (optional fields + refine), `setBriefFeedback` (only given fields, returns both), Telegram (`apps/worker/src/telegram/bot.ts`), the Briefs page (yes / no choices with the shown state; `apps/web/src/lib/reviewForms.ts`).
  - Error codes: `FORM_ERRORS` / `formErrorText` (`reviewForms.ts`), `actions.ts` redirect, `FormNotice` (`Tabs.tsx`).
  - The brief's `newProposals` (`countPendingCycleProposals` in `packages/db/src/repos/proposals.ts`) and its "To decide" section.
  - Code review (high): 8 findings, 6 fixed with tests, 2 deferred (F2, M16a). Full checks green: 1,073 tests.
- **Decided:** D-093 (F1 build choices); BLUEPRINT v3.31.
- **Learned:** —
- **Next:** Marcus merges PR #22; then a fresh session runs `start-milestone F2`.
- **Open:** the Phase 0 setup (after F3).

## 2026-10-19 — Fix sessions F1–F3 planned (D-092)
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#21](https://github.com/marcustanforwork/agenticAdsManager/pull/21)
- **Did:** collected every fix deferred in code reviews and "Leave behind" notes (M01a–M10b) and grouped the real ones into three fix sessions, written in BLUEPRINT §7 like milestones (v3.30): F1 wording and feedback, F2 request processor and shared formatting, F3 pre-live rehearsal. Found the stage-label plural bug also in the brief and in M08's proposal template words. Marked the source notes "Scheduled: F1/F2". The start-milestone skill, SESSIONS.md §4 and CLAUDE.md now name fix sessions; same workflow as a milestone.
- **Decided:** D-092 (Marcus).
- **Learned:** —
- **Next:** a fresh session runs `start-milestone F1`.
- **Open:** the Phase 0 setup (after F3).

## 2026-10-19 — PR #20 (M10b) merged; building ahead stops
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#20](https://github.com/marcustanforwork/agenticAdsManager/pull/20)
- **Did:** CI was green on the PR's last commit (`ci`, `secret-scan`, `memory-check`). Marcus said "merge #20"; squash-merged it (D-057). Every milestone allowed before the Phase 0 gate is now merged (M08 to M10b).
- **Decided:** —
- **Learned:** —
- **Next:** Marcus's Phase 0 setup this weekend (offered a click-by-click walk-through of T5, the Google service accounts). M11a waits for the gate.
- **Open:** the Phase 0 setup (no ticks yet).

## 2026-10-19 — M10b built ahead of the Phase 0 gate (the dashboard's review screens), reviewed
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#20](https://github.com/marcustanforwork/agenticAdsManager/pull/20)
- **Did:**
  - Reset the branch onto `main` (its earlier commits were merged as PR #19); started M10b (D-090).
  - DB: `packages/db/src/repos/dashboard.ts` (spend per day, outcomes through `dashboard_outcomes`, cycle and trust history, AI cost, drift, entities by ref, findings by id, decisions, document versions), tested as `agent_dashboard`.
  - `apps/web`: Overview, Proposals, Changes, Checks, Briefs and Docs screens per product; the lib for the arithmetic, the loaders and each button's request; four new server actions; the request page goes back to the right screen and shows a document request's text.
  - Tests: every screen rendered to HTML from a fixture database (`apps/web/test/views.test.ts`); the forms' requests; the web round trip for each new kind in core. A headless browser run against the built app covered every button (milestone file, Evidence).
  - Code review (high): 10 findings, 8 fixed with tests, 2 left (milestone file). Playwright moved to M16b.
  - 1064 tests pass; typecheck, lint, boundaries, build and format are green.
- **Decided:** D-091 (build choices).
- **Learned:** GOTCHAS: a GROUP BY that repeats a bound parameter; how `react-dom/server` renders a server-action form.
- **Next:** Marcus reviews the PR; Phase 0 setup this weekend. No milestone may start before the gate (M11a onwards).
- **Open:** the Phase 0 setup and live steps (no ticks yet).

## 2026-10-19 — PR #18 (M10a) merged; M10b approved to build ahead of the gate
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#18](https://github.com/marcustanforwork/agenticAdsManager/pull/18)
- **Did:** CI was green on the PR's last commit (`ci`, `secret-scan`, `memory-check`). Marcus said "let's merge this PR first"; squash-merged PR #18 (D-057). Recorded his go-ahead for M10b (D-090; BLUEPRINT v3.27). Explained Q13; Marcus answered "A" → D-071 adopted (service accounts; BLUEPRINT v3.28, PROPOSAL v3.10).
- **Decided:** D-090 (Marcus); D-071 adopted (Q13).
- **Learned:** —
- **Next:** a fresh session starts M10b. Marcus plans the Phase 0 setup for the weekend.
- **Open:** the Phase 0 setup (no ticks yet).

## 2026-10-19 — M10a built ahead of the Phase 0 gate (the dashboard: sign-in, settings), reviewed
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#18](https://github.com/marcustanforwork/agenticAdsManager/pull/18) (also carries the M09b memory note)
- **Did:**
  - DB: migration `0007` (`operator_requests.inserted_by` default `current_user`; an insert trigger NOTIFYs `request_queued`); `roles.sql` lets the dashboard insert only the request columns; `packages/db/src/repos/web.ts`.
  - Core: the processor binds the actor to who inserted the row (D-068); new `set_product_status`; an unchanged settings patch makes no version. Worker: `apps/worker/src/requests.ts` processes queued requests on NOTIFY and every 30 s.
  - `apps/web`: Next.js 16 with `proxy.ts` checking the Cloudflare Access token (jose; fail closed), checked again in every page, route and action; settings screens, settings history, fact editor from the published JSON Schema (contracts `jsonSchemaIssues`); request page polling the verdict.
  - Drove the built app in a headless browser against a local database: found and fixed two bugs (a refused fact form lost its values; the empty "add" row counted as an item).
  - Code review (high): 10 findings, 7 fixed with tests, 3 left (milestone file). Security review: nothing at the bar; one hardening note applied.
  - 1031 tests pass; typecheck, lint, boundaries, build, format green.
- **Decided:** D-088 (Marcus: build M10a now), D-089 (build choices).
- **Learned:** GOTCHAS: Next.js 16 `proxy.ts`; Cloudflare Access token facts; Vercel Deployment Protection; Turbopack and `import.meta.url`; React resets forms after an action; create the dashboard login with SQL.
- **Next:** Marcus reviews PR #18; M10b waits for the Phase 0 gate.
- **Open:** Q13; T10; the Phase 0 setup (no ticks yet).

## 2026-10-19 — PR #17 (M09b) merged
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#17](https://github.com/marcustanforwork/agenticAdsManager/pull/17)
- **Did:** Marcus said "lets merge this PR"; waited for CI on the head commit (`ci`, `secret-scan`, `memory-check` all green), then squash-merged PR #17 (D-057).
- **Decided:** —
- **Learned:** —
- **Next:** Marcus works through the Phase 0 checklist; M10a onwards wait for the Phase 0 gate.
- **Open:** Q13; the Phase 0 setup (no ticks yet).

## 2026-10-19 — M09b built ahead of the Phase 0 gate (Telegram operator commands) and code-reviewed
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#17](https://github.com/marcustanforwork/agenticAdsManager/pull/17)
- **Did:**
  - Processor: `pause`, `pause_all`, `undo` (Phase 1 behaviour) in `core/src/requests/operator.ts`; operator pauses are proposals like drafted ones (planned undo, fingerprint) with a 30-minute expiry; a halted product still takes pauses.
  - Bot: one command table (`apps/worker/src/telegram/commands.ts`) with `/pause`, `/pause_all`, `/undo`, `/changes`, `/halt`, `/resume_agent`, `/status`, `/proposals`, `/brief`, `/drift`, `/ceiling`, `/digest`, `/budget`, `/help`; entity resolution with buttons when ambiguous (`pause.ts`); Confirm / Cancel on operator cards; the menu via `setMyCommands`.
  - Tests: golden shape (operator vs drafted pause), halt vs pause, settings history, ambiguity; 956 tests pass. Fixed an M08 test that had started failing on 2026-10-15 (a test-clock proposal expired in real time).
  - Code review (high): 10 findings, all confirmed; 9 fixed (notably: `/pause_all` Cancel no longer rejects an agent's drafted pause; confirmed pauses stay "made by hand" after their expiry), 1 noted.
  - Docs: BLUEPRINT v3.24 (M09b "As built": the command grammar), the `add-telegram-command` skill.
- **Decided:** D-087 (M09b build choices).
- **Learned:** GOTCHAS: Telegram `BotCommand` names allow only `[a-z0-9_]` (1–32), descriptions 1–256.
- **Next:** Marcus reviews and merges PR #17; then the Phase 0 setup and gate (M10a onwards wait for it).
- **Open:** Q13; the Phase 0 setup (no ticks yet).

## 2026-10-19 — PR #16 merged; M09b approved to build ahead of the gate
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#16](https://github.com/marcustanforwork/agenticAdsManager/pull/16)
- **Did:** checked status: PR #16 green, the Phase 0 checklist has no ticks yet. Marcus said "merge #16"; squash-merged it (D-057). Recorded his go-ahead for M09b (D-086; BLUEPRINT v3.23).
- **Decided:** D-086 (Marcus).
- **Learned:** —
- **Next:** a fresh session starts M09b.
- **Open:** Q13; the Phase 0 setup (no ticks yet).

## 2026-10-14 — PR #15 (M09a) merged
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#15](https://github.com/marcustanforwork/agenticAdsManager/pull/15)
- **Did:** CI was green on the PR's last commit (`ci`, `secret-scan`, `memory-check`). Marcus said "merge the PR once CI passes"; squash-merged PR #15 on his instruction (D-057).
- **Decided:** —
- **Learned:** —
- **Next:** Marcus works through the Phase 0 checklist; the next session records live-step results. M09b waits for the Phase 0 gate (D-084).
- **Open:** Q13.

## 2026-10-14 — M09a built ahead of the Phase 0 gate (Telegram proposal cards, edit_approve, alerts) and code-reviewed
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#15](https://github.com/marcustanforwork/agenticAdsManager/pull/15)
- **Did:**
  - Marcus asked for M09a; asked about the gate, he chose to build it now (D-084).
  - Migration `0006` `telegram_conversations` (bot state per chat, 10 minutes).
  - `edit_approve` in the processor (`applyEdit`: a new version, approved at once, with the eval case).
  - Proposal cards: queued by the draft stage, rendered from the DB, Approve / Reject (reason) / Edit (grammar), re-rendered after each decision; message polling; `ads proposals edit` (moved here from M08).
  - Alerts: trust check failed, drift on a pending proposal's entity, a scheduled cycle failed on its last attempt; one per alert and cycle.
  - Code review (high): 10 points, 8 fixed (see the milestone file's Notes).
- **Decided:** D-084 (Marcus), D-085 (build choices). BLUEPRINT v3.22.
- **Learned:** GOTCHAS: Telegram refuses an edit to identical content (400 "message is not modified"); the card refresh only logs it.
- **Next:** Marcus reviews PR #15 (merge when he says, after CI). Then the Phase 0 live checklist; M09b waits for the gate unless Marcus says otherwise.
- **Open:** Q13; setup tasks; live steps M00–M08 and now M09a's (after M07's deploy and the gate).

## 2026-10-13 — PR #14 (M08) merged
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#14](https://github.com/marcustanforwork/agenticAdsManager/pull/14)
- **Did:** CI was green on the PR's last commit (`ci`, `secret-scan`, `memory-check`). Marcus said "we can merge"; squash-merged PR #14 on his instruction (D-057).
- **Decided:** —
- **Learned:** —
- **Next:** Marcus works through the Phase 0 checklist; the next session records live-step results. M09a waits for the Phase 0 gate (D-082).
- **Open:** Q13.

## 2026-10-13 — M08 built ahead of the Phase 0 gate (draft stage, proposals, replay v0) and code-reviewed
- **Where:** cloud · branch `claude/elegant-goodall-ursfd8` · PR [#14](https://github.com/marcustanforwork/agenticAdsManager/pull/14)
- **Did:**
  - Marcus asked to start M08 while he works through the Phase 0 checklist; he chose "build now, gate still counts" (D-082). The switch is the stored phase (`system_flags.phase`, 0 by default; `ads phase set`).
  - Contracts: `fingerprintOf`, `plannedUndo` (`SET_AT_APPLY`), the `set_phase` request. DB: migration `0005` (`eval_cases`, `analyst_runs`), `getPhase`, `agreeRateCounts`, `findOpenProposalByAction`, `getFinding`, a `term` filter on `sumSearchTerms`.
  - Core: `core/src/draft/` (`budget.ts`, `actions.ts`, `rationale.ts` `drafter-v1`, `stage.ts`, `agreeRate.ts`); the `drafted` stage in `runCycle` (weekly, manual); `approve`/`reject`/`set_phase` handlers writing eval cases; the agree rate in the brief; the analyse stage stores its redacted prompt and answer. The registry now proposes pauses and negatives from phase 1.
  - Evals: `replay-case-v1`, `scoreReplay`, `decisionCasesFromDb`, 3 hand-written cases. Worker: `ads proposals list|show|approve|reject`, `ads phase [set]`, `ads eval replay`; the leader expires due proposals every 10 minutes. `apps/worker` may depend on `evals`.
  - Skill `eval-replay`. Code review at high effort: 10 findings, 7 fixed plus one small cleanup, 2 left with reasons (milestone file). 879 tests pass.
- **Decided:** D-082 (Marcus), D-083; BLUEPRINT v3.21, PROPOSAL v3.9. Cut and moved to M09a: CLI edit.
- **Learned:** —
- **Next:** Marcus reviews the PR; Phase 0's checklist; then the gate.
- **Open:** Q13.

## 2026-10-12 — PR #13 (M07) merged; Phase 0 checklist published
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#13](https://github.com/marcustanforwork/agenticAdsManager/pull/13)
- **Did:** CI was green on the PR's last commit (`ci`, `secret-scan`, `memory-check`). Marcus said "merge"; squash-merged PR #13 on his instruction (D-057). Published the artifact [Phase 0 Live Checklist](https://claude.ai/artifact/12LGui2vrbD3b2yxrrao4f): Q13, the setup tasks, every live step M00 → M07 with commands, and the gate, with ticks saved in its `progress` collection (empty at publish).
- **Decided:** —
- **Learned:** —
- **Next:** Marcus works through the checklist; the next session reads its ticks and records the results.

## 2026-10-12 — M07 built (digest, brief, Telegram, worker service) and code-reviewed
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#13](https://github.com/marcustanforwork/agenticAdsManager/pull/13)
- **Did:**
  - `core/src/report/` (`digest.ts`, `brief.ts`, `numberCheck.ts`, `stage.ts`, `format.ts`): the `reported` stage, the digest, the brief with its number check and template fallback, and the diagnostic brief. The analysis now runs on weekly and manual cycles only.
  - `apps/worker/src/telegram/` (format, outbox, feedback buttons, grammY), `worker.ts` (startup reconciliation, job runner, leader schedule, outbox, heartbeats), `schedule.ts` (croner, SGT), `heartbeat.ts`, `reports.ts` (`ads digest`, `ads brief`).
  - `apps/gateway/src/alive.ts` (heartbeat stub); `docs/runbook.md`; skills `deploy-worker` and `incident`.
  - Code review at high effort: 10 findings, all fixed. 843 tests pass.
- **Decided:** D-081 (M07 build choices); BLUEPRINT v3.19. Cut and moved to M16b: the pack's `briefSections` and the GHCR push.
- **Learned:** GOTCHAS gains grammY 1.46.0 / croner 10.0.1, the Telegram limits and HTML escaping, and the healthchecks.io ping API. `core.telegram.org` and `healthchecks.io` don't resolve from cloud containers.
- **Next:** Marcus reviews PR #13; then Phase 0's setup and live steps (M00 → M07), and the 4-week Phase 0 gate.
- **Open:** Q13.

## 2026-10-12 — PR #12 (M06b) merged
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#12](https://github.com/marcustanforwork/agenticAdsManager/pull/12)
- **Did:** CI was green on the PR's last commit (`ci`, `secret-scan`, `memory-check`). Marcus said "merge"; squash-merged PR #12 on his instruction (D-057).
- **Decided:** —
- **Learned:** —
- **Next:** a clean-context session starts M07 (Phase 0 exit).

## 2026-10-08 — M06b built (analyst input, look-ups, analyse stage) and code-reviewed
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#12](https://github.com/marcustanforwork/agenticAdsManager/pull/12)
- **Did:**
  - Started M06b. A plan fix first: the analyst names a finding's target as an entity, an ad account or the product (`FindingTargetRef`, D-080).
  - Build 5 (moved from M06a): the `no_delivery` and `cost_spike` detectors, with fires / doesn't-fire tests.
  - Build 1: the analyst input (`core/src/analyst/input.ts`, `instructions.ts` `analyst-v1`): trusted context (pack context, phase, product docs), then the DATA block; a 60k-token cap with deterministic truncation.
  - Build 2: six read-only look-ups as model tools, with the per-cycle budget (`lookups.ts`); `generateStructured` gained tools.
  - Build 3: the analyse stage (`analyse.ts`): validation, computed evidence, thresholds, verdicts; the `analysed` stage in `runCycle`.
  - Build 4: `ads cycle --until analysed`, `ads findings`.
  - The property fixture "Sora at Lakeside" and the first replay case (`packages/evals`); its answer is recorded (no model key in the cloud). The `add-finding-type` skill.
  - Code review at high effort (D-067): 10 findings, 9 fixed with tests (the analyst's added findings must meet their rule; look-ups stop with `toolChoice: 'none'`; per-step cost; fractional conversions; three smaller ones); one kept by choice (a failed analysis doesn't hold the cycle).
- **Decided:** D-080 (M06b build choices).
- **Learned:** GOTCHAS: AI SDK 7 tools with structured output (step cost, `toolChoice: 'none'`, last-step usage on errors).
- **Next:** Marcus reviews the M06b PR; then a clean session starts M07.
- **Open:** Q13 (can wait, D-074).

## 2026-10-08 — PR #11 (M06a) merged
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#11](https://github.com/marcustanforwork/agenticAdsManager/pull/11)
- **Did:** CI was green on the PR's last commit (`ci`, `secret-scan`, `memory-check`). Marcus said "merge"; squash-merged PR #11 on his instruction (D-057).
- **Decided:** —
- **Learned:** —
- **Next:** a clean-context session starts M06b (with `cost_spike` and `no_delivery` moved from M06a); then M07.

## 2026-10-07 — M06a built (AI layer, finding registry, detectors) and code-reviewed
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#11](https://github.com/marcustanforwork/agenticAdsManager/pull/11)
- **Did:**
  - Started M06a. Checked the AI SDK and Langfuse facts from their published npm packages (both sites are blocked here). AI SDK 7 is current, and Langfuse's integration needs it (D-078).
  - Build 1: `core/model`. Per-stage `provider:model` settings, `generateStructured` with one schema retry, Langfuse tracing tagged with product, cycle and stage, cost in USD micros per cycle, and personal data redacted and masked. Also `ads model ping`.
  - Build 2: migration `0004` (a finding may target an account or the product), new `ComputedEvidence` fields, the finding-type registry, and `computeEvidence` from SQL, tested against hand-computed sums.
  - Google per-search-term KPI conversions in the sync.
  - Builds 3–4: four detectors (`zero_outcome_spend`, `tracking_gap`, `pacing_risk`, `wasteful_search_term`), the `detected` stage, and `ads cycle --until detected`.
  - The session restarted once after a usage limit. It reached the token checkpoint before the detectors, so `cost_spike` and `no_delivery` moved to M06b and the Phase 3 pair to M14.
- **Decided:** D-078 (AI SDK 7), D-079 (M06a build choices).
- **Learned:** OpenTelemetry's ESM build only loads through a bundler, so vitest now resolves Node-side imports without the `module` condition. `InMemorySpanExporter` empties itself on shutdown. Per-term conversions from Google are unverified until the M03 recording (GOTCHAS).
  - Code review at high effort (D-067): 10 findings, 9 fixed with tests (garbled stage labels in summaries, a false `zero_outcome_spend` flood for platforms without ids, paused-campaign and 10-word checks for search terms, cost-recording and price-default fixes); the per-entity query count is left as is (efficiency only).
- **Next:** Marcus reviews PR #11; then a clean session starts M06b.

## 2026-10-07 — PR #10 (M05b) merged
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#10](https://github.com/marcustanforwork/agenticAdsManager/pull/10)
- **Did:** CI was green on the PR (`ci`, `secret-scan`, `memory-check`), with no review comments. Marcus said "merge"; squash-merged PR #10 on his instruction after every check passed (D-057). Answered his question on how the memory is kept: it lives in the repo (`docs/memory/`), the `end-session` skill commits and pushes it, and the next session reads it fresh from GitHub.
- **Decided:** —
- **Learned:** —
- **Next:** a clean-context session starts M06a; then M06b and M07, one session each.
- **Open:** Q13 (at the setup); all live steps, M05b's included (batched, D-074).

## 2026-10-07 — M05b: property pack (G8), attribution, product docs, facts_put
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#10](https://github.com/marcustanforwork/agenticAdsManager/pull/10)
- **Did:** the property pack (`packages/packs/property-sg`: manifest, `detectPhase`, an Airtable adapter tested on a hand-made fixture), committed alone, and the G8 check passed (c1d9798 touches no core, gateway or connector file); `facts_put` and `product_doc_put` in the one processor; product docs seeded by `ads seed`, plus `ads docs list|get|set`; `core/attribution` (§5.12) in the cycle's sync stage and `ads outcomes` (the attribution rate); the `attribution_gap` and `id_capture` trust checks; the `add-product-pack` skill. Code review at high effort: 10 findings, all confirmed and fixed. 741 tests pass.
- **Decided:** D-077 (M05b build choices); BLUEPRINT v3.14.
- **Learned:** `airtable.com`, `support.airtable.com` and `tally.so` are blocked in cloud sessions; Airtable's list-records shape, paging, 5 requests a second per base and 1,000 calls a month on the Free plan (GOTCHAS).
- **Next:** Marcus reviews PR #10; a clean-context session starts M06a.
- **Open:** Q13 (at the setup); all live steps, M05b's included (batched, D-074); the Airtable field mapping waits until property resumes.

## 2026-10-07 — PR #9 (M05a) merged
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#9](https://github.com/marcustanforwork/agenticAdsManager/pull/9)
- **Did:** CI was green on the PR (`ci`, `secret-scan`, `memory-check`), with no review comments. Marcus asked to close the PR; asked to choose, he picked "merge". Squash-merged PR #9 on his instruction after every check passed (D-057).
- **Decided:** —
- **Learned:** —
- **Next:** a clean-context session starts M05b; then M06a, M06b, M07, one session each.
- **Open:** Q13 (at the setup); all live steps, M05a's included (batched, D-074).

## 2026-10-06 — M05a: pack SDK, SnapPool pack, settings, outcome reads
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#9](https://github.com/marcustanforwork/agenticAdsManager/pull/9)
- **Did:** `pack-sdk` (`definePack`, the registry, the threshold engine, the manifest document); the SnapPool pack (defaults, phases, facts, thresholds, a draft `analystContext`, the read-only adapter tested on a fixture copy of SnapPool's tables); migration `0003` (`products.outcome_source`, `outcomes.web`); `core/settings` (pack defaults, the pack's guard layer, invalid stored settings → `blocked` + one alert, repair by patch, history, seeding); outcome reads in the sync stage and the `outcome_source_fresh` check; `ads settings get|set|history`, `ads outcomes`, `ads seed` (replaces `db:seed`); manifests published at worker startup. Code review at high effort: 10 findings, all fixed.
- **Decided:** D-076 (M05a build choices). `facts_put` moved to M05b.
- **Learned:** SnapPool's tracking change is live since 2026-09-25 17:01 UTC (its Session 41); Meta and Google normalise emails differently (two hashes); zod's JSON Schema export drops refinements (GOTCHAS).
- **Next:** Marcus reviews PR #9; a clean-context session starts M05b.
- **Open:** Q13 (at the setup); all live steps, M05a's included (batched, D-074); SnapPool owes one real `/start` check on production.

## 2026-10-06 — PR #8 (M04) merged; the phased plan confirmed
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#8](https://github.com/marcustanforwork/agenticAdsManager/pull/8)
- **Did:** answered Marcus's questions (what Phase 2 is; no pixel is planned, D-060, which is why `tracking_active` needed D-075; why the agent gets its powers phase by phase). He confirmed the phased plan as written, then asked to merge M04 and carry on to M07. Squash-merged PR #8 after every check passed (D-057).
- **Decided:** — (the phases and gates stay as written; the "build ahead of the gates" option was declined)
- **Learned:** —
- **Next:** a clean-context session starts M05a; then M05b, M06a, M06b, M07, one session each.
- **Open:** Q13 (at the setup); all live steps (batched, D-074).

## 2026-10-06 — M04: sync stage, drift, trust checks, resumable cycles
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#8](https://github.com/marcustanforwork/agenticAdsManager/pull/8)
- **Did:** migration `0002` (`accounts.trust_signals`, `last_sync_error`, `clicks_synced_through`); one sync stage for both platforms (`core/src/sync/stage.ts`, `clients.ts`; the dry runs share the client opening); drift (`core/src/sync/drift.ts`); trust checks (`core/src/cycle/trust.ts`); `runCycle` with a per-cycle advisory lock, `--until`, resume and recovery (`core/src/cycle/runCycle.ts`, `db/src/queue/locks.ts`); `ads cycle`; the worker resumes unfinished cycles at startup (`apps/worker/src/startup.ts`). Code review at high effort: 10 findings, 9 fixed (one performance note left in the milestone file). 602 tests pass, including crash-resume with a SIGKILLed child process.
- **Decided:** D-075 (M04 build choices; notably `tracking_active` gives `no_signal`, not `fail`, while an upload-only product's KPI conversions haven't been uploaded yet: otherwise every SnapPool cycle would fail until Phase 2).
- **Learned:** GOTCHAS: Meta by-id 100/33 for a deleted object (unverified against a real one); drizzle's jsonb reader also turns numeric strings into numbers; the crash test's child process.
- **Next:** Marcus reviews and merges the M04 PR; then a clean-context session starts M05a.
- **Open:** Q13 (at the setup); all live steps, M04's included (batched, D-074).

## 2026-10-06 — PR #7 (M03) merged; account setup moved to the end of Phase 0
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#7](https://github.com/marcustanforwork/agenticAdsManager/pull/7)
- **Did:** Marcus asked to merge M03 and keep building without the account creation, doing it at the end. Recorded as D-074 (NOW, SESSIONS, QUESTIONS Q13 updated), then squash-merged PR #7 on his instruction after every check passed (D-057).
- **Decided:** D-074 (Marcus): the builds carry on through Phase 0 without the setup tasks; all setup and live steps happen together after M07's cloud part, before the Phase 0 → 1 gate.
- **Learned:** —
- **Next:** a clean-context session starts M04.
- **Open:** Q13 (at the setup); all live steps (batched, D-074).

## 2026-10-06 — M03 built: Google read connector
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#7](https://github.com/marcustanforwork/agenticAdsManager/pull/7)
- **Did:**
  - `packages/connector-google`: `GoogleAdsClient` (REST `searchStream`, API v25, no developer token, `login-customer-id`, retries, quota hook), token providers (service-account JWT, refresh token) outside the recorded fetch, the GAQL builder with an allowlist, `GoogleReadClient` (account, entities incl. keywords and budgets, metrics at 3 levels, search terms, click ids, snapshots, trust signals, manager → client resolution), 11 hand-written cassettes, the `record` script, the recorded-replay test, a `LIVE=1` smoke test.
  - `connector-testing`: cassettes match the POST body and `login-customer-id`; redaction of PEM keys, JWTs, gclids and search terms (also inside resource names).
  - `accounts.login_customer_id` (migration 0001), `sumApiUsage`, `ads accounts link --manager/--no-manager`; the core quota meter (soft cap 2,000 a day, under an advisory lock); `dryRunGoogle` and `ads sync --platform google --dry`.
  - Code review (high): 10 candidates, 7 fixed, 3 recorded as not changed (milestone Notes). 97 new tests (563 in the repo). gitleaks clean.
- **Decided:** D-073 (Claude, fix). BLUEPRINT v3.11 (§4 accounts column, §5.7 Google status column and specifics, quota cap).
- **Learned:** GOTCHAS: Google Ads API v25 and minor releases on the same endpoint, `searchStream` REST shape, errors and rate limits, operations counting (sliding window unverified), `listAccessibleCustomers`, statuses, resource names holding personal data, conversion values as doubles, manager-owned conversion actions (unverified); `developers.google.cn` is blocked too.
- **Next:** Marcus reviews PR #7; after the merge, a clean session starts M04.
- **Open:** Q13; live steps M03, M02, M01a, M00; setup tasks.

## 2026-10-06 — PR #6 (M02) merged; Marcus works remotely for now
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6)
- **Did:** squash-merged PR #6 on Marcus's instruction after every check passed (D-057). Answered his questions: the to-do list is the same except Google's setup (T5 is simpler: no developer token, no application) and the new Q13; M03's cloud work needs no accounts. He's moving house and working from a work machine, so browser-only setup tasks for now; secrets and live steps wait for his own PC.
- **Decided:** —
- **Learned:** —
- **Next:** a clean-context session starts M03.
- **Open:** Q13; live steps M02, M01a, M00; setup tasks.

## 2026-10-02 — M02 built: Meta read connector
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6)
- **Did:**
  - Marcus confirmed M01b complete; M00/M01a live-step checklists left unticked as he asked.
  - `packages/connector-testing`: cassettes, `replayFetch`, `recordingFetch` + `saveCassette`, `Redactor` + `findSecrets`.
  - `packages/connector-meta`: `GraphClient` (Graph API v26.0, `appsecret_proof`, cursor paging, rate-limit back-off), `MetaReadClient` (account, entities, daily metrics at 3 levels, snapshots, trust signals), exact money, status table, hand-written fixtures, the `record` script and a record→replay round-trip test.
  - `packages/core/src/sync/dryRun.ts` + `ads sync --dry`; `ads accounts link | list | set-status`; `localDate`/`minusDays` in contracts; contract fields added (D-069).
  - Code review (high), twice: the whole diff (9 findings, 7 fixed), then the code added after it (9 candidates, 7 fixed); the rest are recorded in the milestone Notes. 81 new tests (466 in the repo).
  - `record-fixture` skill created.
  - CI `secret-scan` flagged a made-up test secret (false positive): built at run time now, plus a one-finding `.gitleaksignore`. CI green afterwards.
  - Marcus created the Google manager account (T5). Its API Center no longer issues developer tokens: Google moved API access to the Cloud project on 2026-09-09/10. T5, PROPOSAL §6.1/§6.13/§7 and BLUEPRINT M03 rewritten; Q13 asked. Then Marcus asked what code or design that changes: no existing code; for M03/M13 the `google-ads-api` library (25.1.0, read from its published code) needs refresh tokens and a developer token and uses axios/gRPC, so D-072 moves the Google connector to the REST API with our own `fetch` client.
- **Decided:** D-069, D-070 and D-072 (Claude, fix); D-071 proposed (Q13). BLUEPRINT v3.10, PROPOSAL v3.6.
- **Learned:** GOTCHAS: Graph v26.0 and its 2026-10-27 changes, rate-limit headers, access-tier rename, ad account fields, attribution changes, dataset stats, `appsecret_proof`, `effective_status`; unverified: action-type mapping and archived listings.
- **Next:** Marcus reviews the PR; then a clean session starts M03.
- **Open:** Q13; live steps M02, M01a, M00; setup tasks.

## 2026-09-26 — PR #5 (M01b) merged; Marcus starts his to-do list
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR [#5](https://github.com/marcustanforwork/agenticAdsManager/pull/5)
- **Did:** squash-merged PR #5 on Marcus's instruction after CI passed (D-057). Guided Marcus through the open setup tasks and live steps (T1 status checks, M00 SER9 check, T2 Neon, T3 Doppler, M01a migrate + seed, T6b, T4, T5, T6a).
- **Decided:** —
- **Learned:** —
- **Next:** Marcus reports each live step's result; a clean session starts M02.
- **Open:** live steps M00, M01a; setup tasks.

## 2026-09-25 — M01b built: queue, leader lock, vault, request processor
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR [#5](https://github.com/marcustanforwork/agenticAdsManager/pull/5)
- **Did:**
  - `packages/db/src/queue/`: the job queue (enqueue, SKIP LOCKED claim, heartbeat, complete, fail with backoff, release, reclaim), `startQueueRunner` (NOTIFY wake-up + 30 s poll), `listen`, `contendForLeadership`.
  - `packages/vault`: AES-256-GCM envelope encryption with read and write master keys, a `credential_access` row per `get`, and all-or-nothing key rotation. `credentials put | check | rotate-key` in `ads` and `ads-gw` (tokens from stdin only).
  - `packages/core`: the operator-request processor (`halt`, `resume_agent`, `settings_patch` with tighten-only, `brief_feedback`; other kinds refused with their milestone) and `recoverWorker`.
  - `roles.sql`: `agent_gateway` may insert/update `credentials`. 65 new tests (385 in the repo).
  - Code review (high): 10 findings, all fixed. Security review: no findings; one design point moved to M10a.
- **Decided:** D-068 (Claude, fix). BLUEPRINT v3.7.
- **Learned:** GOTCHAS entries on Commander subcommand settings, zod stripping keys, the Postgres facts proven by tests, and Node GCM usage.
- **Next:** Marcus reviews the PR; then a clean session starts M02.
- **Open:** no questions; live steps M00 (SER9) and M01a (T2, T3).

## 2026-09-25 — Code review of M01a; review becomes a closing step; PR #4 merged
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR [#4](https://github.com/marcustanforwork/agenticAdsManager/pull/4)
- **Did:**
  - Marcus asked whether sessions run a code review. They didn't; only preflight's self-review ran.
  - Ran `code-review` (high) on the M01a diff: 10 findings, 9 fixed, each with a regression test (7 of the 8 new tests fail on the old code). Details are in the M01a milestone notes.
  - `close-milestone` now includes the review step (2b).
  - Merged PR #4 on Marcus's instruction after CI passed. The M01a live steps stay undone (T2/T3 aren't set up).
- **Decided:** D-067 (Claude, fix): fingerprint fields move to contracts; the review fixes; `code-review` for every milestone. BLUEPRINT v3.6.
- **Learned:** Postgres row locks (`FOR UPDATE`/`FOR SHARE`) need UPDATE rights. drizzle-kit loads `schema.ts` with Node's resolver, so it needs `--conditions=@ads/source` to import workspace packages.
- **Next:** a clean session starts M01b.
- **Open:** live steps M00 (SER9) and M01a (T2, T3); T1's required status checks (optional).

## 2026-09-25 — M01a built: database schema, repositories, roles, seed
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR [#4](https://github.com/marcustanforwork/agenticAdsManager/pull/4)
- **Did:**
  - Pinned Drizzle 0.45.3 / drizzle-kit 0.31.11 / `pg` 8.23.0 (GOTCHAS).
  - `packages/db`: the full §4 schema (`src/schema.ts`, migration `migrations/0000_init.sql`), `sql/roles.sql` (three roles, re-runnable grants, `dashboard_outcomes` view), `db:generate` / `db:migrate` / `db:seed`, and `@ads/db/testing` (a template database cloned per test file).
  - Repositories in `src/repos/`: products and settings (optimistic concurrency + history), documents, offerings, pack manifests; accounts, entities, snapshots (only on hash change), metrics upsert (`restated_at` moves only on change), search terms, clicks, outcomes; cycles, trust checks, findings; proposals with the §3.9 transition table, `newVersion`, `recordDecision`, expiry; change log, `createUndoProposal`; briefs, operator requests, notifications, drift, system flags, API usage.
  - Seed data in `products/seed.json`. 230 new tests (320 in the repo), including all 144 status pairs and a role-permission test.
  - CI: a `postgres:16` service, and a check that `schema.ts` and the migrations agree. Skill `db-migration` created.
- **Decided:** D-066 (Claude, fix): migration `0000_init`, extra gateway grants (undo proposals, revert link, halt, its queue, API usage), worker read-only on `change_log`, the dashboard view, `product_id` indexes on accounts and credentials, the seed file. BLUEPRINT → v3.5.
- **Learned:** drizzle-kit can't serialise bigint defaults; Drizzle's jsonb reader re-parses JSON strings (fixed in `getFlag`); Drizzle wraps pg errors. See GOTCHAS.
- **Next:** Marcus reviews and merges the PR; then a clean session starts M01b.
- **Open:** no questions; M01a live steps (need T2, T3); M00 live steps.

## 2026-09-25 — M00 built: scaffold, contracts, boundaries, CI
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR [#3](https://github.com/marcustanforwork/agenticAdsManager/pull/3)
- **Did:**
  - Checked Marcus's `main` ruleset through the public API. PR required, force pushes and deletion blocked. Still missing: required status checks, squash-only merging, auto-delete of head branches.
  - Verified toolchain versions (GOTCHAS) and pinned them.
  - Built all of M00: pnpm + Turborepo workspace with 17 packages (each with a README), strict TypeScript, Vitest, ESLint, Prettier.
  - `pnpm check:boundaries`: `scripts/check-boundaries.ts`, dependency-cruiser and the ESLint mirror, all driven by `scripts/boundary-rules.mjs`. Fixture tests show each one failing.
  - `packages/contracts` (BLUEPRINT §3), with round-trip and property tests: 91 tests in all.
  - The worker and gateway entry points, the `ads` and `ads-gw` CLIs, the Dockerfile, `docker-compose.yml`, CI (`ci.yml` plus gitleaks), the cloud setup in the SessionStart hook, Commands in CLAUDE.md, and the preflight commands.
- **Decided:** D-065 (Claude, fix): M00 build choices. PROPOSAL T3 now mentions per-service Doppler tokens (from M07).
- **Learned:** TypeScript 7 is out, but typescript-eslint needs TypeScript < 6.1. AI SDK 7 is `latest` (M06a decides). Drizzle 1.0 is a release candidate (M01a decides). The GitHub REST API is scoped to this repo in cloud sessions, but `git ls-remote` and release downloads work. See GOTCHAS.
- **Merged:** Marcus set Actions to read-only, squash-only merging and auto-delete of branches (T1; required status checks aren't on yet), and said to merge. PR #3 was squash-merged after every check passed (D-057). The M00 live test on the SER9 stays a to-do until he's at that machine.
- **Next:** a clean session starts M01a.
- **Open:** no questions; the SnapPool tracking change (T6b); setup tasks T1 (part), T2–T14.

## 2026-09-25 — Q11 approved; the SnapPool prompt; spec fixes from SnapPool's code
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` (reset to `main` after PR #1 merged) · PR [#2](https://github.com/marcustanforwork/agenticAdsManager/pull/2)
- **Did:**
  - Marcus OK'd Q11: **D-060 adopted**.
  - He asked whether a pixel or Google API work is needed. Answer: not in SnapPool. The API work is this repo's (M02, M03, M12, M13), plus platform setup (T4, T11, T14). T4 now says "create a dataset; don't install its pixel code".
  - He asked for a prompt to build the SnapPool change on his local machine. Reading SnapPool's code at `a6c190a` to write it found gaps, fixed in `SNAPPOOL-TRACKING.md` v1.2 (**D-064**):
    - the middleware is only the Auth.js `/host` guard, and would send every ad visitor to `/login` if simply widened;
    - click ids were being cut to 255 characters;
    - `page_url` now comes from `Referer`;
    - a repeat `/start` keeps the earlier attribution;
    - the privacy page promises "never share it with advertisers", so it needs three edits;
    - the migration must reach production before the deploy.
  - The prompt is §7. It has the SnapPool session add the work to SnapPool's own blueprint as its next session.
  - M05a: SnapPool deletes pending requests after 30 days, so the adapter reads at least daily.
  - Squash-merged PR #2 into `main` on Marcus's instruction, after CI passed (D-057), and reset the branch to `main`.
- **Decided:** D-060 adopted (Marcus); D-064 (Claude, fix).
- **Learned:** `gh api … -H 'Accept: application/vnd.github.raw'` returns a file's raw text (tested against this repo). SnapPool is on Next.js 15.5; its middleware lives in `middleware.ts`.
- **Next:** Marcus runs the SnapPool session with the §7 prompt. A clean session starts M00.
- **Open:** no questions; the SnapPool change (T6b); setup tasks T1–T14.

## 2026-09-25 — Q12 answered; Q11 clarified; PR #1 merged
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Q12 as D-063, superseding D-061. The budget is S$500 a month. Marcus resets Meta's spending limit by hand and will change it during trials, so the agent reads it live, never assumes it, and never changes it.
  - Moved the `spend_cap_headroom` check from M12 to **M04** and added a digest line (M07), because ads are live in Phase 0 and all Meta campaigns stop at the limit. The M05a live steps now enter the starting settings: test email domains and ceilings.
  - Q11: Marcus asked which project the tracking plan is for. The answer is SnapPool (the `snappool` repo); this repo only reads what it saves. Q11 and `SNAPPOOL-TRACKING.md` §0 now say so up front. Q11 is still open.
  - Documented how a cloud session restarts a branch whose PR is already merged (GIT-WORKFLOW §4 and §8; `start-session` §2).
  - Squash-merged PR #1 into `main` on Marcus's instruction, after CI passed (D-057), and reset the branch to `main`.
- **Decided:** D-063 (Marcus).
- **Next:** a clean-context session starts M00. Marcus: T1, Q11, and the long setup tasks T4, T5 and T6a.
- **Open:** Q11; setup tasks T1–T14.

## 2026-09-25 — Marcus's second answers; SnapPool repo read; tracking spec
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Q1–Q5 and Q8–Q10: D-039–D-053 adopted, and D-057–D-062 added.
  - Attached `marcustanforwork/snappool` (read-only) and read its schema, signup, pricing, security headers and memory.
  - Wrote `docs/plan/SNAPPOOL-TRACKING.md` (D-060, proposed).
  - Contracts: feedback **routes** (`FeedbackRoute`), a `web` context (user agent and page URL), and `testTraffic.emailDomains`.
  - Trust check `spend_cap_headroom`. Hourly uploads once auto-approved.
  - Local-session Docker isolation rules; the merge policy.
- **Decided:** D-057 (merge on instruction, after CI), D-058 (SER9 local sessions, isolation), D-059 (test signups by email domain), D-060 (SnapPool captures, the agent uploads; proposed), D-061 (Meta limit ~500, reset monthly), D-062 (Housing confirmed).
- **Learned:** GOTCHAS gained two verified Meta facts: CAPI website events **require** user agent and page URL, and the account spending limit is a **lifetime** total. It also gained the SER9 Docker rules and a pointer to the SnapPool facts.
- **Next:** Marcus answers Q11 and Q12 and says when to merge PR #1. Then the SnapPool tracking session (in the snappool repo) and M00.
- **Open:** Q11, Q12; setup tasks T1–T14.

## 2026-09-25 — Plan v3.1: Marcus's answers, sessions resized, PR opened
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Marcus's answers:
    - he already has Vercel Pro, so the dashboard runs there (D-054, superseding D-050);
    - he's already on Neon's paid plan (D-055);
    - build sessions run from a clean context on Opus 5.5 at medium effort, each within 400–600k tokens including tests, reviews and fixes (D-056).
  - Re-estimated every milestone against v2's yardstick (500k ≈ 1,500–2,500 lines including tests). Split the 8 that no longer fit into a/b parts, giving 25 sessions and about 11.6M tokens (BLUEPRINT §0, §7, §9; CHANGES §H).
  - Restored the per-session token budget and checkpoints (SESSIONS §4), and wired them into CLAUDE.md, the skills and the milestone template.
- **Decided:** D-054, D-055, D-056 (Marcus). D-050 superseded; D-033 partly superseded.
- **Learned:** GOTCHAS got a design note that Vercel functions can't use LISTEN through Neon's pooler, so the dashboard polls instead.
- **Next:** Marcus reviews the PR and answers Q1–Q5 and Q8–Q10. Then the M00 session.
- **Open:** Q1–Q5, Q8–Q10; setup tasks T1–T13.

## 2026-09-25 — Plan v3: review, rewrite, workflow and memory system
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1) (opened later the same day)
- **Did:**
  - Reviewed the v2 proposal and blueprint, and moved the originals to `docs/archive/` without changes.
  - Re-checked external facts: the Google Data Manager API switch, Explorer access, API v25.2, Node 24 LTS, AI SDK 6, Vercel Hobby terms, Neon's free tier, and Meta's special ad categories.
  - Wrote `docs/plan/PROPOSAL.md` v3, `BLUEPRINT.md` v3 and `CHANGES-v3.md`.
  - Designed the git workflow (`docs/process/GIT-WORKFLOW.md`) and the session and memory system (`docs/process/SESSIONS.md`, `docs/memory/*`, `docs/milestones/_TEMPLATE.md`).
  - Added 7 process skills (`.claude/skills/`), the SessionStart and Stop hooks (`.claude/hooks/`, `.claude/settings.json`), a PR template and the `memory-check` CI job.
- **Decided:** D-001 to D-019 (carried over from v2); D-020 to D-038 (v3 fixes). D-039 to D-053 are proposed and need Marcus's OK.
- **Learned:** GOTCHAS now has the environment facts and 12 external facts, plus 1 fact still unverified (Meta's `execution_options`).
- **Next:** Marcus reviews the plan and answers Q1–Q10. Then Claude starts M00.
- **Open:** Q1–Q10; setup tasks T1–T13.
