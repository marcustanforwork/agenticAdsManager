# M07 — Digest, brief, services on the SER9 (Phase 0 exit)

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-10-12 |
| **Finished** | 2026-10-12 (cloud part) |
| **PRs** | — |

## Goal
Daily digests and weekly briefs arrive unattended from containers that survive restarts and reboots.

## Needs
- [x] M06b: merged (PR #12, 2026-10-12). Its "Leave behind" says how the brief treats verdicts: a finding stands when `passedThreshold` and its verdict is `confirmed` or `added`; `unreviewed` candidates are still listed, marked so; a failed analysis doesn't stop the cycle, and the brief says so.
- [ ] **T7 (Telegram bot + Marcus's numeric user id)** and **T8 (healthchecks.io: worker alive, gateway alive, daily sync)**: not done; under D-074 the setup waits until the end of Phase 0. Built and tested in the cloud against a fake Telegram API and a fake ping endpoint; the live steps need both.
- [ ] A real brief needs `ANTHROPIC_API_KEY` (M06a's live steps). In the cloud the brief writer runs on a mock model.
- [x] External facts (2026-10-12, see GOTCHAS):
  - grammY **1.46.0** (npm, 2026-08-26; `@grammyjs/types` 5.0.0). croner **10.0.1** (npm, 2026-02-01; 11.x is still `-dev`).
  - Telegram Bot API: message text 1–4096 characters after entity parsing; HTML parse mode needs `<`, `>`, `&` escaped; `callback_data` 1–64 bytes. `core.telegram.org` doesn't resolve from the cloud container; checked in the type docs that ship with `@grammyjs/types` (generated from the Bot API page) and third-party summaries.
  - healthchecks.io ping API: GET/HEAD/POST `https://hc-ping.com/<uuid>` = success; `/start`, `/fail`, `/<exit status>`. `healthchecks.io` doesn't resolve from the cloud container; checked in mirrors of its docs (self-hosted instances serve the same page).

## Read first
- PROPOSAL §5.2–5.3 and G1; BLUEPRINT §5.14–5.16; M06b's "Leave behind".
- The code M07 extends: `core/src/cycle/runCycle.ts` (the `reported` stage), `core/src/recovery.ts` (`recoverWorker`), `core/src/model/generate.ts`, `db/src/repos/plumbing.ts` (briefs, notifications), `db/src/queue/*` (runner, leader), `apps/worker/src/{main,service,startup,cli}.ts`, `apps/gateway/src/main.ts`, `docker-compose.yml`.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order, each step green, committed and pushed:
  1. **Plan fix (D-081):** the analyse stage runs on weekly and manual cycles only (PROPOSAL §1: a daily cycle is sync → trust → detect → digest); the `reported` stage: daily → digest, weekly and manual → brief, any kind with a failed trust check → the diagnostic brief (template only, no AI); the brief's AI writes only prose around a numbers table the code renders, and every number in that prose is checked; the analyst's free text never reaches the brief. A failed analysis is not re-run by the report: the brief says it failed and lists the candidates as unreviewed.
  2. **Digest (Build 2):** SQL numbers, the send rule, ~6 plain lines; the `reported` stage for daily cycles enqueues it in the outbox.
  3. **Brief (Build 1):** numbers table (SQL), AI prose (`brief-v1`), the number check with template fallback, the diagnostic variant, stored in `briefs`, enqueued in the outbox; idempotent on resume.
  4. **Telegram (Build 3):** HTML escaping and the brief's markdown → Telegram HTML, chunking at 4,000, the grammY sender, the outbox sender (leader only), the feedback buttons and their callback → `brief_feedback` request, updates only from Marcus's user id in a private chat.
  5. **Worker service (Build 4):** croner schedule in SGT (daily 06:00, weekly Monday 07:00) on the leader only; the job runner (`daily`, `weekly` jobs: every active product's cycle); `recoverWorker` at startup; graceful shutdown (the cycle stops between stages, the job's lease is released); heartbeats (`worker-alive` every 10 min, `daily-sync` after the daily job).
  6. **Gateway stub (Build 5):** `gateway-alive` heartbeats only.
  7. **Deployment (Build 6):** compose env, `docs/runbook.md`; CLI `ads digest`, `ads brief`; skills `deploy-worker`, `incident`; then `close-milestone`.
- Cut first, if behind at ~300k: the pack's `briefSections` (neither pack defines any yet); publishing to GHCR (build on the SER9 instead).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented (~75k: the M07 code spans the worker, queue, cycle and model layers)
  - [x] ~300k built, typecheck green (all six Builds; the two cut-first items cut, see below)
  - [x] ~450k tests green, self-review done (code review: 10 findings, all fixed)
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. The brief (§5.14):
  - the core sections, plus the pack's `briefSections` (**cut**, moved to M16b: no pack defines any);
  - the number check, with template fallback;
  - a diagnostic variant;
  - stored in `briefs`.
  - notes: `core/src/report/` — `brief.ts` (`buildBriefNumbers`: `brief-numbers-v1` from SQL; `BRIEF_INSTRUCTIONS` `brief-v1`; `templateProse`; `renderBrief`, `renderDiagnosticBrief`, `CHECK_HINTS`), `numberCheck.ts` (`allowedValues`, `checkNumbers`, `canonicalNumber`), `stage.ts` (`reportStage`: the brief and its notification in one transaction; idempotent), `format.ts`. DB: `findCycleBrief`, `findCycleNotification`, `setNotificationProgress`. The `reported` stage in `runCycle`; `analysed` on weekly and manual cycles only (D-081). Tests: `core/test/report.test.ts` (12).
- [x] 2. The daily digest, with no AI. It is sent according to the `notifications.digest` setting and stays silent when nothing is spending.
  - notes: `core/src/report/digest.ts` (`buildDigest`, `shouldSendDigest`: `auto` = spend yesterday or a failed trust check, `renderDigest`); queued by the daily cycle's report stage.
- [x] 3. Telegram sending:
  - a sender (grammY, HTML formatting, chunking) and the `notifications` outbox sender;
  - on each brief, the **feedback buttons** (👍 useful / 💡 new to me), recorded as `brief_feedback` requests. Only this minimal callback handling is built now, because the Phase 0 gate needs it.
  - notes: `apps/worker/src/telegram/` — `format.ts` (`escapeHtml`, `markdownLiteToHtml`, `chunkHtml` at 4,000), `bot.ts` (`TelegramApi`, `sendOutbox` with per-message progress and a back-off signal, `renderNotification`, `handleCallback`, `feedbackKeyboard`), `grammy.ts` (grammY `Api` and long polling, callback queries only). Tests: `apps/worker/test/telegram.test.ts` (11).
- [x] 4. The worker service:
  - the leader lock controls the scheduler (croner: daily 06:00 SGT, weekly Monday 07:00 SGT, digest after the daily sync);
  - the job runner;
  - graceful shutdown: finish the current job or release its lease on SIGTERM;
  - pino logs, a health endpoint, and heartbeats (§5.16).
  - notes: `apps/worker/src/worker.ts` (`startWorker`: heartbeat → `recoverWorker` → job runner `daily`/`weekly` → leader work; `runScheduledCycles`, `enqueueScheduled`), `schedule.ts` (croner, `Asia/Singapore`, `missedToday` catch-up), `heartbeat.ts`, `main.ts` (SIGTERM aborts the cycle between stages). `CycleDeps.signal` and `CycleInterruptedError` in core; `hasPendingJob` in db. M04's `resumeCyclesAtStartup` removed (now `recoverWorker`). Tests: `apps/worker/test/{schedule,worker}.test.ts`, `core/test/cycle.test.ts` (+1).
- [x] 5. A gateway service stub that sends heartbeats only. The real work comes in M11b.
  - notes: `apps/gateway/src/{alive,heartbeat}.ts`; tests `apps/gateway/test/alive.test.ts` (3).
- [x] 6. Deployment:
  - `docker compose` on the SER9;
  - `docs/runbook.md` stub: start, stop, logs, restart, upgrade, roll back;
  - optionally, an image build and push to GHCR on git tags (**cut**, moved to M16b: built on the SER9).
  - notes: the compose file needed no change (Doppler supplies the new settings; `restart: unless-stopped`); `docs/runbook.md`; CLI `ads digest` (preview) and `ads brief` (`apps/worker/src/reports.ts`, tests in `sync.test.ts`).

## Tests
- [x] Brief snapshots: the numbers appear verbatim, and a changed metric changes the brief.
- [x] The number check: an invented number triggers the template fallback.
- [x] Digest rules:
  - spend yesterday → sent;
  - zero spend with `auto` → not sent;
  - `always` → sent;
  - it fits in one message.
- [x] Chunking.
- [x] Schedule calculation in SGT.
- [x] Shutdown in the middle of a cycle leaves `stage_reached` consistent.

## Done when (cloud)
- [x] All tests are green.
  - evidence: see Evidence.

## Done when (live, run by Marcus)
- [ ] The stack runs on the SER9 for **7 consecutive days**, including one `docker compose restart` and one host reboot, with no manual help. Q2 covers Docker starting on boot.
- [ ] The heartbeats stay green.
- [ ] SnapPool's digest arrives every morning it spends; property's does not.
- [ ] Both weekly briefs arrive on Monday at 07:00 SGT.

After that, the **Phase 0 gate** runs for 4 weeks (PROPOSAL §12). M08 is built before it passes (D-082), but its draft stage stays off on production until it does.

### Live steps for Marcus
_At the end of Phase 0 (D-074), after the M00–M06b steps. This one runs on **production** (compose project `ads-agent`, the Doppler `worker` and `gateway` configs, the Neon **prod** branch): only Marcus runs it._
1. **T7 (Telegram):** create the bot with BotFather (`/newbot`); get your numeric user id (e.g. from @userinfobot); open a chat with your bot and send `/start` (a bot can't message you first). In Doppler `worker`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`.
2. **T8 (healthchecks.io):** three checks: `worker-alive` (period 10 min, grace 20 min), `gateway-alive` (the same), `daily-sync` (cron `0 6 * * *`, timezone Asia/Singapore, grace 3 h); an email or SMS integration. Their ping URLs: Doppler `worker` → `HEALTHCHECK_WORKER_URL`, `HEALTHCHECK_DAILY_SYNC_URL`; Doppler `gateway` → `HEALTHCHECK_GATEWAY_URL`.
3. **Production data:** the Doppler `worker` config has the prod `DATABASE_URL` (direct host), `VAULT_READ_KEY`, `OPERATOR_ACTORS`, `SNAPPOOL_DATABASE_URL`, `ANTHROPIC_API_KEY`, `LANGFUSE_*`; prod is migrated (`docs/runbook.md` → Upgrade, step 2); the SnapPool accounts are linked and their read credentials stored on prod (M02 steps 4–5 and M03 steps 3–4, run with `doppler run --config worker --`); SnapPool's starting settings are set on prod (M05a step 5).
4. On the SER9: a `.env` next to `docker-compose.yml` with `DOPPLER_TOKEN_WORKER=…` and `DOPPLER_TOKEN_GATEWAY=…`; `git pull` on `main`; `docker compose up -d --build`; `docker compose ps`.
   - expect: both `healthy`; `docker compose logs --tail 50 worker` shows `ready`, `startup reconciliation done`, `leader: starting the schedule, Telegram and the outbox`; within 10 min `worker-alive` and `gateway-alive` are green.
5. `docker compose exec worker ads-entrypoint ads digest --product snappool`, then `docker compose exec worker ads-entrypoint ads cycle --product snappool --kind manual`.
   - expect: the digest preview (`wouldSend`); then a brief in Telegram within a minute, with the 👍 / 💡 buttons. Press both; `docker compose exec worker ads-entrypoint ads brief --product snappool` shows `"feedback": {"useful": true, "newInfo": true}` and a `"writer"` block (`model`, or `template` with the reason).
   - report back: "brief arrived", the `writer` block, and whether the brief reads well.
6. **Seven days unattended**, including one `docker compose restart` and one host reboot (Docker starts on boot, Q2).
   - expect: SnapPool's digest every morning after 06:00 SGT on days it spent; none for property (dormant); SnapPool's weekly brief on Monday at 07:00 SGT (property is dormant, so it gets none: say if you expected one); the heartbeats stay green; after the restart and the reboot the log shows `startup reconciliation done`.
   - report back: the days the digest came, the Monday brief, any heartbeat alert, and "restart + reboot OK".
7. Then the **Phase 0 gate** starts (4 weeks): press 👍 / 💡 on each weekly brief. Tag the deploy: `git tag deploy-YYYY-MM-DD && git push origin deploy-YYYY-MM-DD`.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| The pack's `briefSections` | M16b | Cut first; neither pack defines any, so there was nothing to render | 2026-10-12 |
| Image build and push to GHCR on git tags | M16b | Cut first (optional); the SER9 builds the image | 2026-10-12 |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- **For M08 (draft, proposals):** the `drafted` stage goes between `analysed` and `reported` in `STAGES` (weekly and manual kinds). The brief's numbers table already has `openProposals` (pending only); add the cycle's new proposals there. The digest's "Open proposals" line is live.
- **For M09a/M09b (Telegram):** the bot is `apps/worker/src/telegram/`: `TelegramApi` (send, answer, edit markup), `handleCallback` (Marcus's private chat only; unknown data answered), `startGrammyPolling` (callback queries only: add `message` to `allowed_updates` for commands). Callback data `v1:<verb>:<id>:<version>`; the brief uses `useful` / `new` with version 0. The outbox renders `digest`, `brief`, `alert`, `worker_recovered`, and anything else generically: add a layout per new kind in `renderNotification`. The worker adds `telegram:<TELEGRAM_OWNER_ID>` to the allowed actors.
- **For M11b (gateway service):** `apps/gateway/src/alive.ts` is its heartbeat; the worker's `startWorker` is the pattern (heartbeat, reconciliation, runner, leader work, ordered stop).
- **For M16a/M16b:** the brief prompt is `brief-v1` (`BRIEF_INSTRUCTIONS`, `core/src/report/brief.ts`); `briefs.numbers.writer` says how each brief's prose was written (with the unmatched tokens on a fallback): count fallbacks there for the model-swap gate. `ads doctor` should check `TELEGRAM_*` and `HEALTHCHECK_*`.
- **Sizes:** the test brief's DATA block is ~3,000 characters (~750 tokens) plus ~600 tokens of instructions; a digest is ~400 characters.

## Skills to create
- [x] `deploy-worker` (`.claude/skills/deploy-worker/SKILL.md`)
- [x] `incident` (`.claude/skills/incident/SKILL.md`)

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | No write code; the gateway stub only pings |
| 2 | No product logic in shared code | yes | `core/src/report` names no product; "S$" comes from the currency code, the labels from the pack's stages |
| 3 | AI calls through core/model | yes | The brief's call goes through `generateStructured` (stage `brief`): traced, its cost on the cycle |
| 4 | The AI never supplies decision numbers | yes | The brief's figures come from SQL; the AI writes prose only, and every number in it must match the table (sign included) or the template replaces it (tests: invented number, sign) |
| 5 | Untrusted text is data | yes | Names only inside the DATA block; flattened in markdown (`plainText`), escaped in HTML; Telegram updates from anyone but Marcus's private chat are ignored (test) |
| 6 | Money is bigint micros / decimal strings | yes | Bigint micros in code; decimal strings in the table; display formatting only at the end |
| 7 | Every write action has an undo and a test | n/a | No write actions |
| 8 | Every guard has a property test; copy rules have pass/fail examples | n/a | No guards |
| 9 | Surfaces only record intent | yes | The buttons record `brief_feedback` requests through the one processor; `ads digest` and `ads brief` are read only |
| 10 | apps/web depends only on contracts + db | yes | Untouched |
| 11 | product_id + an index on product-scoped tables | yes | No new tables (`sentChunks` lives in the notification's payload) |
| 12 | No state outside Postgres | yes | Briefs, the outbox and its progress, jobs and the catch-up all from Postgres; only the back-off timer is in memory |
| 13 | No secrets or personal data | yes | Check URLs, the bot token and the owner id come from Doppler and are never logged; no fake secrets in tests |
| 14 | No production write capability outside the gateway | yes | Read only |
| 15 | Cut items moved at most once | yes | `briefSections` and GHCR moved once, to M16b |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-081), GOTCHAS, BLUEPRINT v3.19 updated at close |

## Evidence
- `pnpm typecheck` → 0 errors; `pnpm lint` → clean; `pnpm check:boundaries` → no dependency violations (313 modules); `pnpm build` → 17 of 17 tasks successful; `pnpm format:check` → clean.
- `pnpm test` (final, after the review fixes) → Test Files 72 passed, 1 skipped (73); Tests 843 passed, 3 skipped (846).
- The M07 tests: `core/test/report.test.ts` (brief snapshot with the numbers verbatim and a changed metric; invented number → template; the sign kept; model failure → template; diagnostic brief; platform text as data; digest rules and size; resumed the next day), `core/test/cycle.test.ts` (shutdown mid-cycle), `apps/worker/test/telegram.test.ts` (escaping, chunking, buttons, outbox incl. part-sent and unrenderable), `schedule.test.ts` (SGT), `worker.test.ts` (end to end), `apps/gateway/test/alive.test.ts`.
- Code review (D-067), `code-review` at high effort over `origin/main...HEAD`: 10 findings, all fixed: (1) reports used the clock, not the cycle's date, so a cycle resumed the next day reported the wrong day: now the cycle's `cycle_date` (test); (2) a part-sent notification re-sent its first messages: progress counted (`sentChunks`, test); (3) permanent failures were retried forever: an unrenderable one is dropped (test), any other error stops the pass and the passes back off; (4) the number check dropped the minus sign: kept (test); (5) the heartbeat started after a possibly long recovery: it starts first, and a shutdown during recovery starts nothing more; (6) the brief's footer cost missed its own call: re-read after it (test); (7) a heartbeat in flight at shutdown could ping `/fail`: `stop()` waits for it; (8) outbox passes could pile up: one at a time, at most one queued; (9) M04's live steps expected the old log line and outcome: updated; (10) the external facts weren't in GOTCHAS: added.

## Notes and surprises
- 2026-10-12: a daily cycle no longer analyses (D-081): M06b ran the analyst on every kind, which would have cost a model call every day for nothing new.
- 2026-10-12: "Both weekly briefs arrive on Monday": property is dormant, so only SnapPool's brief arrives until property is resumed (noted in the live steps).
- 2026-10-12: `core.telegram.org` and `healthchecks.io` don't resolve from the cloud container (`getaddrinfo ENOTFOUND`), like the other blocked documentation sites (GOTCHAS).
