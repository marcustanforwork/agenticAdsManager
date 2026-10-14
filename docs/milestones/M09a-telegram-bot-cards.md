# M09a — Telegram bot core and proposal cards

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 1 |
| **Started** | 2026-10-14 |
| **Finished** | 2026-10-14 (cloud part) |
| **PRs** | [#15](https://github.com/marcustanforwork/agenticAdsManager/pull/15) |

## Goal
Marcus can decide proposals from his phone, safely.

## Needs
- [x] M08 (code): merged in PR #14.
- [ ] M07's bot running (T7): **not yet live.** The bot code from M07 is in `apps/worker/src/telegram/`; the live run waits for T7 and M07's deploy.
- [ ] The Phase 0 gate: **not passed.** D-084 (Marcus, 2026-10-14): M09a is built before it, like M08 (D-082). At phase 0 nothing is drafted, so no cards are sent on production; the new alerts do go out.

## Read first
- PROPOSAL §6.3; BLUEPRINT §3.8, §3.9, §5.4, §5.15, §5.16; M07's and M08's "Leave behind".
- Code: `apps/worker/src/telegram/*`, `apps/worker/src/proposals.ts`, `core/src/requests/*`, `core/src/draft/{actions,stage}.ts`, `db/src/repos/proposals.ts`, `contracts/src/{proposals,undo,writes}.ts`.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order:
  1. DB: migration `0006` (`telegram_conversations`: one row per chat, a state and its 10-minute expiry) and its repo.
  2. Core: `applyEdit(action, EditSpec)` and the `edit_approve` handler (a new version, then the approval bound to it, plus the eval case).
  3. Worker: the edit grammar (`budget 45`, `keyword "free photos"`, `match exact`) → `EditSpec`.
  4. Worker: proposal cards (render, buttons `v1:<verb>:<shortId>:<version>`), the callback and message handlers with the conversation state, polling of `message` updates too; the draft stage queues one `proposal` notification per new proposal.
  5. Core: alerts through the outbox (trust check failed; drift on an entity with an open proposal; a cycle failed), with a routing table.
- Cut first, if behind at ~300k: the edit grammar beyond `budget` and `keyword` (`match`). **Never cut:** version re-checks, the user-id check.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. The bot core:
  - long polling, on the leader only;
  - accepts only Marcus's user id, in a private chat;
  - stores conversation state in the DB;
  - every handler writes an operator request and calls the processor.
  - notes: `apps/worker/src/telegram/{grammy,bot,decide}.ts` (polling now fetches `callback_query` and `message`); migration `0006` `telegram_conversations` + `db/src/repos/telegram.ts` (10 minutes, `/cancel`).
- [x] 2. Proposal cards:
  - each card shows an evidence summary, before → after, the expected effect and the expiry;
  - buttons: **Approve / Reject / Edit**, with callback data `v1:<verb>:<shortId>:<version>`;
  - Reject asks for a reason, which is required;
  - Edit accepts a tiny grammar (`budget 45`, `keyword "free photos"`, `match exact`). The edit creates a new version, the card is re-rendered, and the approval binds to the new version.
  - notes: `apps/worker/src/telegram/cards.ts` (render, callback data), `apps/worker/src/editGrammar.ts`; the draft stage queues a `proposal` notification with each proposal. No Edit button on a pause. Also `ads proposals edit` (moved here from M08).
- [x] 3. The processor handles `approve`, `reject` and `edit_approve`.
  - notes: `core/src/requests/{edit,handlers}.ts` (`edit_approve`; `approve`/`reject` were M08's).
- [x] 4. Alerts through the outbox:
  - a trust check fails;
  - drift on an entity that has an open proposal;
  - a cycle fails.
  - notes: `core/src/alerts.ts` (routing table, once per alert and cycle), hooked into the sync and trust stages and `runStage`; the bot renders them (`alertLines`). Drift: pending proposals only; a cycle failure: daily/weekly, on the job's last attempt (D-085).

## Tests
- [x] A stale version is refused, and so is an expired proposal.
- [x] Updates from an unknown user or a group chat are ignored.
- [x] A double tap produces only one approval.
- [x] Callback data is 64 bytes or less for every verb.
- [x] An edit-grammar property test: every parsed edit gives a valid `WriteOp`.
- [x] The alert routing table.

## Done when (cloud)
- [x] All tests are green.
  - evidence: `pnpm test` → `Test Files 78 passed | 1 skipped (79)`, `Tests 919 passed | 3 skipped`; typecheck, lint, boundaries, format, `db:generate` (no changes), build: all clean (2026-10-14).

## Done when (live, run by Marcus)
- [ ] Marcus approves and rejects real SnapPool proposals from Telegram.
  - result: — (waits for M07's deploy and the Phase 0 gate)

### Live steps for Marcus
_After M07's deploy (T7 done, the worker running on the SER9) **and** after the Phase 0 gate (phase 1 set, D-082/D-084). Production only; read credentials only; nothing changes an ad account._
1. Migrate prod (`0006`: `telegram_conversations`) with the next deploy: `docker compose up -d --build` runs the worker; the migration runs as in M07's steps (`pnpm --filter @ads/db db:migrate` with the prod `DATABASE_URL`).
   - expect: `migrations and roles.sql applied`.
2. After a weekly brief (or `… exec worker ads-entrypoint ads cycle --product snappool --kind manual`), one card per new proposal arrives in Telegram: the change, before → after, the evidence, the words, the expiry, and Approve / Reject (and Edit for a negative or a budget).
   - report back: how many cards, and whether they read well on your phone.
3. Approve one card: the button answer says "Approved v1" and the card shows "✅ approved". Make that change by hand in the ads manager (Phase 1 applies nothing).
4. Reject one: press Reject, reply with your reason. The bot says "Rejected", the card shows "❌ rejected".
5. If a negative-keyword card arrives: press Edit, reply `match phrase` (or `keyword "…"`): "Edited and approved … v2", and the card shows v2.
6. `… ads proposals list --product snappool --all` → your decisions with `channel` telegram (via `show`).
   - report back: "decided from Telegram", plus anything that looked wrong.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- **The callback-data encoding must stay stable, or old cards break:** `v1:approve|reject|edit:<shortId>:<version>` (versions 1–999999) and the brief's `v1:useful|new:<briefId>:0`. A new verb is added to `CARD_VERBS`; never change an existing one.
- **M09b (commands):** messages already reach `handleMessage` (`decide.ts`): commands go before the "no conversation" help. The conversation table holds one state per chat; add new `awaiting` values to `ConversationState`. `pause` / `pause_all` / `undo` are still in `NOT_AVAILABLE_UNTIL` (M09b). Operator proposals (e.g. a `/pause`) can reuse the card: queue a `proposal` notification.
- **M10b (dashboard):** `edit_approve` takes an `EditSpec`; the dashboard can reuse `applyEdit`'s errors by showing the request's `reason`.
- **M11b (gateway):** the card's approved status says "Phase 1 applies nothing: make the change by hand". From phase 2 it must say the gateway will apply it (and show `applied` / `failed` etc.; `STATUS_WORDS` in `cards.ts`).
- **M14 (budgets):** a budget edit is checked against `maxBudgetChangePct` only; the product's daily ceiling is the gateway's guard (M11a). Re-check before budget proposals go live.

## Skills to create
- None.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | No new dependency on `connector-*-write`; Phase 1 applies nothing |
| 2 | No product logic in shared code | yes | Cards take the product's slug, currency and timezone from the database |
| 3 | AI calls through core/model | yes | No new model call |
| 4 | The AI never supplies decision numbers | yes | Card figures come from the DB; edits come from Marcus, checked by `applyEdit` |
| 5 | Untrusted text is data | yes | Entity names and keywords are HTML-escaped on cards and never sent to a model |
| 6 | Money is bigint micros / decimal strings | yes | `decimalToMicros`; the edit limit is in bigint basis points |
| 7 | Every write action has an undo and a test | yes | No new action; an edit recomputes the planned undo (tested) |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | No new guard; the edit grammar has a property test |
| 9 | Surfaces only record intent | yes | Every press and reply goes through `submitRequest`; the conversation row is bot state, not a decision |
| 10 | apps/web depends only on contracts + db | yes | Untouched |
| 11 | product_id + an index on product-scoped tables | yes | `telegram_conversations` is global (BLUEPRINT §4 list) |
| 12 | No state outside Postgres | yes | Conversation state in `telegram_conversations` |
| 13 | No secrets or personal data | yes | Test ids are fake; no tokens |
| 14 | No production write capability outside the gateway | yes | — |
| 15 | Cut items moved at most once | yes | Nothing cut; M08's moved "CLI edit" is built (`ads proposals edit`) |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-084, D-085), GOTCHAS updated |

## Evidence
- `pnpm test` (2026-10-14): `Test Files 78 passed | 1 skipped (79)` · `Tests 919 passed | 3 skipped`. New: `apps/worker/test/cards.test.ts` (callback data ≤ 64 bytes per verb + round-trip property; edit grammar + property test; card content and escaping; Approve, double tap, stale version, expired, stranger, group chat; Reject with reason, retry, 10-minute expiry, /cancel; Edit → v2 approved; alerts rendered), `packages/core/test/alerts.test.ts` (routing table, once per key, drift on pending proposals, failed cycle on its last attempt), `packages/db/test/telegram.test.ts`, edit_approve cases in `packages/core/test/requests.test.ts`, `ads proposals edit` in `apps/worker/test/proposals.test.ts`.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:boundaries` (no violations), `pnpm format:check`, `pnpm build`: clean. `pnpm --filter @ads/db db:generate`: "No schema changes".

## Notes and surprises
- 2026-10-14: code review (high) over the milestone diff found 10 points. Fixed: an edited proposal was drafted again (the dedupe now matches any version's hash); drift alerts on approved proposals (pending only now: in Phase 1 Marcus makes approved changes by hand); `cycle_failed` on a retried attempt (last attempt only); an edit racing a decision was a fault (now a refusal); a pending Reject question survived an Approve; an Edit button on pauses; the target-ref code was repeated three times (`targetRefOf` in contracts); the drift check re-read entities (cached now). Not changed: a budget edit isn't re-checked against the daily ceiling or the finding's direction (Marcus's own choice; the gateway's guards check ceilings, M11a; noted for M14); the bot's own clock vs the processor's for expiry (the processor is the authority; the bot's check is only a friendlier message).
- 2026-10-14: Marcus chose "build it now" for M09a ahead of the Phase 0 gate (D-084).
- 2026-10-14: Telegram facts (callback data 1–64 bytes, 4,096-character messages, HTML escaping) were checked on 2026-10-12 (GOTCHAS, re-check 2027-01-12); `editMessageText` and `ForceReply` confirmed in `@grammyjs/types` shipped with grammY 1.46.0.
