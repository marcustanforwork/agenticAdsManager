# M08 — Draft stage, proposals, replay eval v0

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 1 |
| **Started** | 2026-10-13 |
| **Finished** | — |
| **PRs** | — |

## Goal
Each passing finding with an allowed action becomes a durable proposal with an exact undo and fingerprint, and each of Marcus's decisions becomes eval data.

## Needs
- [x] M07 (code): merged in PR #13.
- [ ] The Phase 0 gate: **not passed.** D-082 (Marcus, 2026-10-13): M08 is built before it; at phase 0 the draft stage drafts nothing, and the live steps wait for the gate.
- [x] No setup task: proposals are reviewed with the CLI (M09a adds Telegram cards).

## Read first
- BLUEPRINT §3.6–3.9 and §5.11; PROPOSAL §6.3 and §6.6; PROPOSAL §12 (the agree rate).
- Code: `contracts/src/{undo,writes,proposals}.ts`, `core/src/findings/registry.ts`, `db/src/repos/proposals.ts`, `core/src/cycle/runCycle.ts`, `core/src/requests/*`, `evals/src/replayCase.ts`.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order:
  1. Contracts: `fingerprintOf` (+ stability test), the planned undo at draft time, `set_phase` request; registry fix (pause and negatives draft from phase 1).
  2. DB: migration `0005` (`eval_cases`, `analyst_runs`); the phase flag repo; agree-rate query.
  3. Core: budget amounts (`budgetChange`), the action builder, `core/draft` (stage, AI rationale with template fallback and number check), wired into the cycle between `analysed` and `reported`.
  4. Requests: `set_phase`, `approve`, `reject` handlers (reject and approve create eval cases).
  5. Agree rate in the weekly brief (only when agent proposals exist).
  6. Evals v0: `ReplayCase` with decisions, scoring (precision/recall per type), 3 hand-written cases, `ads eval replay`.
  7. CLI: `ads phase`, `ads phase set`, `ads proposals list|show|approve|reject`.
- Cut first, if behind at ~300k: the replay runner (keep automatic case creation; the runner moves to M16a); CLI edit (`edit_approve`, moves to M09a).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. The finding-type → action registry.
  - **Budget amounts:** computed from `budgetChangePct`, clamped by the guards, and rounded to the platform unit.
  - **Negative keywords:** only from real search terms, and only EXACT or PHRASE.
- [ ] 2. `core/draft`:
  - each proposal gets its action, `actionHash`, undo (from `contracts`), fingerprint, per-action expiry and `shortId`;
  - the AI writes only the rationale and the expected effect.
- [ ] 3. The agree rate, following the PROPOSAL §12 definition, reported weekly in the brief.
- [ ] 4. `packages/evals` v0:
  - `ReplayCase` = the analyst-input fixture + the expected finding types and targets + Marcus's decision;
  - every rejection automatically creates a case;
  - `ads eval replay` reports precision and recall per finding type.
- [ ] 5. A CLI channel, `ads proposals list|show|approve|reject --reason`, going through operator requests. Phase 1 can then start before the Telegram cards exist.
- [ ] 6. The current phase (D-082): `system_flags.phase` (0–5, default 0), set only through an operator request `set_phase` with a note (CLI `ads phase` / `ads phase set <n> --note "…"`). The draft stage drafts a type only when `proposalsFromPhase` ≤ the phase, so at phase 0 nothing is drafted and a cycle behaves exactly as in M07. Marcus sets phase 1 when he records the Phase 0 gate as passed.

## Tests
- [ ] An undo-table property test: for every reversible action, apply-then-undo restores the snapshot, using a fake entity store.
- [ ] Fingerprint stability: unrelated fields don't change it; relevant ones do.
- [ ] Expiry for each action type.
- [ ] Illegal status transitions.
- [ ] The agree rate, including the handling of expired and operator proposals.
- [ ] Replay over 3 hand-written cases.
- [ ] The phase: 0 → no proposals and an unchanged brief; 1 → proposals for the Phase 1 types only.

## Done when (cloud)
- [ ] All tests are green.
  - evidence: —

## Done when (live, run by Marcus) — after the Phase 0 gate passes and he sets phase 1 (D-082)
- [ ] The weekly SnapPool cycle produces proposals, and Marcus reviews them with the CLI.
- [ ] His decisions are recorded.
- [ ] `ads eval replay` runs.

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- …

## Skills to create
- `eval-replay`.

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
- 2026-10-13: started ahead of the Phase 0 gate (D-082). External facts: none new; the draft stage's rationale call reuses the M06a/M07 model layer (AI SDK 7, GOTCHAS).
- 2026-10-13: the registry said pause and negatives produce proposals "from Phase 2", which would leave Phase 1 (suggestions Marcus applies by hand, gate ≥ 15 agent proposals) with nothing to propose. Phase 2 is when the **gateway** may apply them (PROPOSAL §6.2). Fixed to phase 1 (recorded in this milestone's build-choices decision).
- 2026-10-13: the undo of `add_negative_keyword` needs the criterion id the platform creates, so the undo stored at draft time is a plan; the gateway stores the real one when it applies (M11b).
