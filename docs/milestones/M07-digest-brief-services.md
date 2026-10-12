# M07 — Digest, brief, services on the SER9 (Phase 0 exit)

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-10-12 |
| **Finished** | — |
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
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. The brief (§5.14):
  - the core sections, plus the pack's `briefSections`;
  - the number check, with template fallback;
  - a diagnostic variant;
  - stored in `briefs`.
- [ ] 2. The daily digest, with no AI. It is sent according to the `notifications.digest` setting and stays silent when nothing is spending.
- [ ] 3. Telegram sending:
  - a sender (grammY, HTML formatting, chunking) and the `notifications` outbox sender;
  - on each brief, the **feedback buttons** (👍 useful / 💡 new to me), recorded as `brief_feedback` requests. Only this minimal callback handling is built now, because the Phase 0 gate needs it.
- [ ] 4. The worker service:
  - the leader lock controls the scheduler (croner: daily 06:00 SGT, weekly Monday 07:00 SGT, digest after the daily sync);
  - the job runner;
  - graceful shutdown: finish the current job or release its lease on SIGTERM;
  - pino logs, a health endpoint, and heartbeats (§5.16).
- [ ] 5. A gateway service stub that sends heartbeats only. The real work comes in M11b.
- [ ] 6. Deployment:
  - `docker compose` on the SER9;
  - `docs/runbook.md` stub: start, stop, logs, restart, upgrade, roll back;
  - optionally, an image build and push to GHCR on git tags.

## Tests
- [ ] Brief snapshots: the numbers appear verbatim, and a changed metric changes the brief.
- [ ] The number check: an invented number triggers the template fallback.
- [ ] Digest rules:
  - spend yesterday → sent;
  - zero spend with `auto` → not sent;
  - `always` → sent;
  - it fits in one message.
- [ ] Chunking.
- [ ] Schedule calculation in SGT.
- [ ] Shutdown in the middle of a cycle leaves `stage_reached` consistent.

## Done when (cloud)
- [ ] All tests are green.

## Done when (live, run by Marcus)
- [ ] The stack runs on the SER9 for **7 consecutive days**, including one `docker compose restart` and one host reboot, with no manual help. Q2 covers Docker starting on boot.
- [ ] The heartbeats stay green.
- [ ] SnapPool's digest arrives every morning it spends; property's does not.
- [ ] Both weekly briefs arrive on Monday at 07:00 SGT.

After that, the **Phase 0 gate** runs for 4 weeks (PROPOSAL §12). **M08 does not start until it passes.**

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- …

## Skills to create
- [ ] `deploy-worker`
- [ ] `incident`

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | | |
| 2 | No product logic in shared code | | |
| 3 | AI calls through core/model | | |
| 4 | The AI never supplies decision numbers | | |
| 5 | Untrusted text is data | | |
| 6 | Money is bigint micros / decimal strings | | |
| 7 | Every write action has an undo and a test | | |
| 8 | Every guard has a property test; copy rules have pass/fail examples | | |
| 9 | Surfaces only record intent | | |
| 10 | apps/web depends only on contracts + db | | |
| 11 | product_id + an index on product-scoped tables | | |
| 12 | No state outside Postgres | | |
| 13 | No secrets or personal data | | |
| 14 | No production write capability outside the gateway | | |
| 15 | Cut items moved at most once | | |
| 16 | Memory is current | | |

## Evidence
<!-- command output that proves "Done when (cloud)" -->

## Notes and surprises
- 2026-10-12: `core.telegram.org` and `healthchecks.io` don't resolve from the cloud container (`getaddrinfo ENOTFOUND`), like the other blocked documentation sites (GOTCHAS).
