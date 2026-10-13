# M08 — Draft stage, proposals, replay eval v0

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 1 |
| **Started** | 2026-10-13 |
| **Finished** | 2026-10-13 (cloud part) |
| **PRs** | [#14](https://github.com/marcustanforwork/agenticAdsManager/pull/14) (merged 2026-10-13) |

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
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. The finding-type → action registry.
  - **Budget amounts:** computed from `budgetChangePct`, clamped by the guards, and rounded to the platform unit.
  - **Negative keywords:** only from real search terms, and only EXACT or PHRASE.
  - notes: `core/src/draft/actions.ts` (`actionForFinding`), `budget.ts` (`budgetChange`); registry phases fixed (pauses and negatives from phase 1, D-083).
- [x] 2. `core/draft`:
  - each proposal gets its action, `actionHash`, undo (from `contracts`), fingerprint, per-action expiry and `shortId`;
  - the AI writes only the rationale and the expected effect.
  - notes: `core/src/draft/stage.ts`, `rationale.ts` (`drafter-v1`, number check, template); the `drafted` stage in `runCycle` (weekly, manual); `plannedUndo`, `fingerprintOf` in contracts; proposals expire (leader every 10 min, and at the start of the stage).
- [x] 3. The agree rate, following the PROPOSAL §12 definition, reported weekly in the brief.
  - notes: `core/src/draft/agreeRate.ts`, `db` `agreeRateCounts`; a line in the brief's checks once agent proposals exist.
- [x] 4. `packages/evals` v0:
  - `ReplayCase` = the analyst-input fixture + the expected finding types and targets + Marcus's decision;
  - every rejection automatically creates a case;
  - `ads eval replay` reports precision and recall per finding type.
  - notes: `eval_cases` (written by the approve/reject handlers), `analyst_runs`; `evals/src/replay.ts` (`replay-case-v1`, `scoreReplay`, `decisionCasesFromDb`); `cases/decisions/hand-000{1,2,3}.json`. The runner scores recorded answers; re-asking a model stays M16a.
- [x] 5. A CLI channel, `ads proposals list|show|approve|reject --reason`, going through operator requests. Phase 1 can then start before the Telegram cards exist.
  - notes: `apps/worker/src/proposals.ts`; `approve` and `reject` request handlers; `approve` needs `--version` (the version reviewed). CLI edit cut to M09a.
- [x] 6. The current phase (D-082): `system_flags.phase` (0–5, default 0), set only through an operator request `set_phase` with a note (CLI `ads phase` / `ads phase set <n> --note "…"`). The draft stage drafts a type only when `proposalsFromPhase` ≤ the phase, so at phase 0 nothing is drafted and a cycle behaves exactly as in M07. Marcus sets phase 1 when he records the Phase 0 gate as passed.

## Tests
- [x] An undo-table property test: for every reversible action, apply-then-undo restores the snapshot, using a fake entity store.
- [x] Fingerprint stability: unrelated fields don't change it; relevant ones do.
- [x] Expiry for each action type.
- [x] Illegal status transitions.
- [x] The agree rate, including the handling of expired and operator proposals.
- [x] Replay over 3 hand-written cases.
- [x] The phase: 0 → no proposals and an unchanged brief; 1 → proposals for the Phase 1 types only.

## Done when (cloud)
- [x] All tests are green.
  - evidence: `pnpm test` → `Test Files 75 passed | 1 skipped (76)`, `Tests 879 passed | 3 skipped (882)` (2026-10-13, after the review fixes); typecheck, lint, check:boundaries, format:check clean; `db:generate` → no schema changes.

## Done when (live, run by Marcus) — after the Phase 0 gate passes and he sets phase 1 (D-082)
- [ ] The weekly SnapPool cycle produces proposals, and Marcus reviews them with the CLI.
- [ ] His decisions are recorded.
- [ ] `ads eval replay` runs.

### Live steps for Marcus
**Before the gate (with M07's deploy; nothing visible changes):** migration `0005` adds two tables. Apply it wherever you migrate: `doppler run --config dev -- pnpm --filter @ads/db db:migrate`, and prod as in M07's step 3. The phase stays 0, so cycles draft nothing.
1. `… ads phase` → `{"phase": 0}`.

**After you record the Phase 0 gate as passed** (on the SER9: `docker compose exec worker ads-entrypoint ads …`):
2. `ads phase set 1 --note "Phase 0 gate passed: <your summary>"` → `"status": "done"`, `"phase": 1`, `"previous": 0`. (Needs `cli:<name>` in `OPERATOR_ACTORS`.)
3. Wait for Monday's brief (or run `ads cycle --product snappool --kind manual`). The cycle's JSON has a `"drafted"` block. Then `ads proposals list --product snappool`. Expect pending proposals (pauses and negatives only) with a rationale and expected effect. Report how many, their `change.action`, and whether the words read well. The `drafted.drafted[].writer` field says `ai` or `template`.
4. For each: `ads proposals show <id> --product snappool`, check it in Google Ads / Meta Ads Manager, then either make the change **by hand** and `ads proposals approve <id> --version 1 --product snappool`, or `ads proposals reject <id> --reason "…" --product snappool`. Report "decisions recorded".
5. `ads eval replay --product snappool` → `cases` ≥ 1 and precision/recall per type. Paste the JSON (no names in it).
6. The next Monday's brief shows "Agree rate, last 21 days: …". Say "agree rate seen".

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| CLI edit (`edit_approve`) | M09a | Cut first; M09a builds edits with the Telegram edit cards, and the request already exists | 2026-10-13 |

## Leave behind (for later milestones)
- **M09a (cards):** approve and reject requests exist (`core/src/requests/handlers.ts`); a card must carry the version and action hash (`approve` refuses a changed one). `edit_approve` is still refused (`NOT_AVAILABLE_UNTIL`); building it means a new version through `newVersion` and a fresh `plannedUndo` and precondition. An edited approval should also write an eval case (the first decision counts: `eval_cases.proposal_id` is unique).
- **M11a (fingerprint):** hash exactly `proposals.precondition_fields` with `fingerprintOf` over the same normalised state the draft stage uses (`core/src/draft/actions.ts` `entityState`: `status`, `dailyBudgetMicros` as a decimal string, `budgetShared`, `parentStatus`). Negatives list only `parentStatus` until the negative lists are synced (`negativeListHash`, M12/M13).
- **M11b (gateway):** replace a proposal's planned undo (`SET_AT_APPLY` placeholders) with `undoFor(op, ctx)` when it applies. Apply only from phase 2 (`getPhase`), on top of the two write switches.
- **M14 (budgets):** `BUDGET_UNIT_MICROS` assumes a two-decimal currency on Meta (10,000 micros). Derive the unit from the account's currency (zero-decimal currencies: 1,000,000) before budget proposals go live. `pacing_risk` targets the product, so it drafts nothing until a rule names the budget to cut.
- **M16a (evals):** `ads eval run --model X` re-asks the stored prompts (`analyst_runs.record.prompt`, look-ups off) and scores them with `scoreReplay(cases, answerFor)`. Decision cases keep a negative's term (`eval_cases.negative_text`).
- Phase changes: `ads phase set <n> --note …` is the one way; later gates raise it (2 before M11's gateway applies anything).

## Skills to create
- `eval-replay`.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | Proposals only; nothing applies. No `*-write` import outside the gateway (check:boundaries). |
| 2 | No product logic in shared code | yes | Drafting reads the registry, settings and pack guards; no product names. |
| 3 | AI calls through core/model | yes | The drafter uses `generateStructured` (traced, costed, redacted). |
| 4 | The AI never supplies decision numbers | yes | Actions, amounts, undo, fingerprint and expiry come from the DB; the AI's words are number-checked against the DATA block. |
| 5 | Untrusted text is data | yes | Names and search terms only inside the DATA block (test); CLI and eval output use refs. |
| 6 | Money is bigint micros / decimal strings | yes | `budgetChange` in bigint; the percentage becomes whole basis points first. |
| 7 | Every write action has an undo and a test | yes | No new action; `plannedUndo` tested against `undoFor` (property). |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | `budgetChange` (the clamp and minimum delta) has a property test; no new gateway guard. |
| 9 | Surfaces only record intent | yes | `ads proposals approve|reject` and `ads phase set` submit operator requests. |
| 10 | apps/web depends only on contracts + db | yes | Untouched. |
| 11 | product_id + an index on product-scoped tables | yes | `eval_cases`, `analyst_runs` (migrate test). |
| 12 | No state outside Postgres | yes | The phase is a system flag; eval data in tables. |
| 13 | No secrets or personal data | yes | The stored analyst prompt is redacted as sent; hand-written cases are made up. |
| 14 | No production write capability outside the gateway | yes | — |
| 15 | Cut items moved at most once | yes | CLI edit → M09a (first move). |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-082, D-083), BLUEPRINT v3.21. |

## Evidence
- `pnpm test` → `Test Files 75 passed | 1 skipped (76)` · `Tests 879 passed | 3 skipped (882)`.
- `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm format:check` → clean; `check-boundaries: OK (17 packages)`; `no dependency violations found`.
- `pnpm --filter @ads/db db:generate` → `No schema changes, nothing to migrate`.

## Notes and surprises
- 2026-10-13: started ahead of the Phase 0 gate (D-082). External facts: none new; the draft stage's rationale call reuses the M06a/M07 model layer (AI SDK 7, GOTCHAS).
- 2026-10-13: the registry said pause and negatives produce proposals "from Phase 2", which would leave Phase 1 (suggestions Marcus applies by hand, gate ≥ 15 agent proposals) with nothing to propose. Phase 2 is when the **gateway** may apply them (PROPOSAL §6.2). Fixed to phase 1 (recorded in this milestone's build-choices decision).
- 2026-10-13: the undo of `add_negative_keyword` needs the criterion id the platform creates, so the undo stored at draft time is a plan; the gateway stores the real one when it applies (M11b).
- 2026-10-13: code review at high effort (D-067): 10 findings. Fixed 7: nothing ever expired proposals (the leader now runs `expireDue` every 10 minutes, and the draft stage at its start); negatives on one ad group collapsed in eval cases (the term is kept); `approve` without `--version` could approve a newer version (now required); the hand-written cases' path (`fileURLToPath`, checkout-only); campaign-level negatives could never pass the real-term check (ad groups only, as the registry says); the analyst prompt in `cycles` (moved to `analyst_runs`); the real-term check aggregated every term (now a `term` filter). Also: the hard-coded 20% → `MAX_EXPIRED_PCT`. Not fixed: the Meta budget unit for zero-decimal currencies (budgets are phase 3; left for M14); the agree-rate query's repeated subquery (a few rows a week; not worth the risk).
