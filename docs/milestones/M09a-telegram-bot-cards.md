# M09a — Telegram bot core and proposal cards

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 1 |
| **Started** | 2026-10-14 |
| **Finished** | — |
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
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. The bot core:
  - long polling, on the leader only;
  - accepts only Marcus's user id, in a private chat;
  - stores conversation state in the DB;
  - every handler writes an operator request and calls the processor.
- [ ] 2. Proposal cards:
  - each card shows an evidence summary, before → after, the expected effect and the expiry;
  - buttons: **Approve / Reject / Edit**, with callback data `v1:<verb>:<shortId>:<version>`;
  - Reject asks for a reason, which is required;
  - Edit accepts a tiny grammar (`budget 45`, `keyword "free photos"`, `match exact`). The edit creates a new version, the card is re-rendered, and the approval binds to the new version.
- [ ] 3. The processor handles `approve`, `reject` and `edit_approve`.
- [ ] 4. Alerts through the outbox:
  - a trust check fails;
  - drift on an entity that has an open proposal;
  - a cycle fails.

## Tests
- [ ] A stale version is refused, and so is an expired proposal.
- [ ] Updates from an unknown user or a group chat are ignored.
- [ ] A double tap produces only one approval.
- [ ] Callback data is 64 bytes or less for every verb.
- [ ] An edit-grammar property test: every parsed edit gives a valid `WriteOp`.
- [ ] The alert routing table.

## Done when (cloud)
- [ ] All tests are green.
  - evidence: —

## Done when (live, run by Marcus)
- [ ] Marcus approves and rejects real SnapPool proposals from Telegram.
  - result: —

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- The callback-data encoding must stay stable, or old cards break.

## Skills to create
- None.

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

## Notes and surprises
- 2026-10-14: Marcus chose "build it now" for M09a ahead of the Phase 0 gate (D-084).
- 2026-10-14: Telegram facts (callback data 1–64 bytes, 4,096-character messages, HTML escaping) were checked on 2026-10-12 (GOTCHAS, re-check 2027-01-12); `editMessageText` and `ForceReply` confirmed in `@grammyjs/types` shipped with grammY 1.46.0.
