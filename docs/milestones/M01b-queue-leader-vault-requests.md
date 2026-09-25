# M01b — Queue, leader lock, vault, request processor

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-09-25 |
| **Finished** | — |
| **PRs** | — |

## Goal
The background-job plumbing, the credential vault, and the single processor for everything a human asks for.

## Needs
- [x] M01a: merged (PR #4). Its live steps (Neon migrate + seed, T2 + T3) are **not done yet**. They don't block M01b, whose work is cloud-only against a local test database.

## Read first
- BLUEPRINT §3.8 (`OperatorRequest`) and §5.2–5.5; M01a's milestone file ("Leave behind").

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order: 1 queue (in `@ads/db`, see the notes) → 2 leader lock → 3 vault → 4 CLIs → 5 request processor → 6 recovery skeleton. Each step leaves the tree green and is committed and pushed.
- Cut first, if behind at ~300k: master-key rotation (keep `master_key_id`).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. `core/queue`: enqueue, claim, heartbeat, complete, fail with backoff, reclaim expired; two queues; priorities; NOTIFY wake-ups with a polling fallback.
  - notes: this lives in **`@ads/db`** (`src/queue/`), not in `core`. The gateway app needs the queue too, and the gateway may not depend on `core` (BLUEPRINT §2). Recorded as D-068.
- [ ] 2. The leader-lock helper (§5.2).
  - notes: also in `@ads/db` (`src/queue/leader.ts`), next to the queue's other connection-level plumbing.
- [ ] 3. `packages/vault`:
  - AES-256-GCM envelope encryption with Node `crypto`;
  - `put(accountId, role, tokenJson, masterKey)`;
  - `get(accountId, role, { process, purpose }, masterKey)`, which writes a `credential_access` row;
  - master-key rotation;
  - the read key cannot open write or feedback rows.
- [ ] 4. CLIs: `ads credentials put --account X --role read` reads the token from **stdin**, never from arguments. `ads-gw credentials put --role write|feedback`.
- [ ] 5. The `core/requests` processor:
  - schema validation, actor check, freshness checks, one transaction per request, `result` written, `NOTIFY`;
  - implements `halt`, `resume_agent`, `settings_patch` (validated with `ProductSettings` and tighten-only) and `brief_feedback`;
  - other kinds are refused with "not available yet (M-number)".
- [ ] 6. `core/recovery` skeleton: reclaim leases, re-queue stuck requests. Cycles are added in M04.

## Tests
- [ ] Queue: two claimers never get the same job; an expired lease is reclaimed; failures back off; `max_attempts` leads to `failed`; priority order is respected.
- [ ] Leader lock: a second contender waits; the lock is released on disconnect.
- [ ] Vault: round-trip works; a wrong key fails; the read key can't open write rows; every `get` writes an audit row; rotation works.
- [ ] Requests: halt and resume; a valid `settings_patch` creates a new version; a looser guard override is refused; a stale `baseVersion` is refused; an unknown actor is refused.

## Done when (cloud)
- [ ] All tests are green.
  - evidence: —

## Done when (live, run by Marcus)
- None. Tokens are loaded with these CLIs in the M02 and M03 live steps.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- How to add a new operator request kind: (written at close)

## Skills to create
- None listed.

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
- 2026-09-25: postgresql.org is blocked by the cloud proxy. The Postgres behaviours M01b relies on (NOTIFY is delivered at commit; a session advisory lock is released when its connection closes) are proven by this milestone's tests against Postgres 16 instead.
