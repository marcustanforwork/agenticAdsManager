# M09b — Telegram operator commands

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 1 (built before the Phase 0 gate, D-086) |
| **Started** | 2026-10-19 |
| **Finished** | — |
| **PRs** | [#17](https://github.com/marcustanforwork/agenticAdsManager/pull/17) |

## Goal
Pause, undo, halt, status and quick settings from the phone, all as operator requests. Nothing in the bot calls a platform.

## Needs
- [x] M09a: merged (PR #15); awaiting live acceptance.
- [x] Phase gate: not needed to build (D-086). The live steps wait for M07's deploy and the Phase 0 gate.
- [x] No setup task beyond M07's T7 (the bot) for the live steps.

## Read first
- PROPOSAL §5.4 and §6.14; BLUEPRINT §3.8, §3.9, §5.4, §5.15; M09a's milestone file ("Leave behind").
- Code: `apps/worker/src/telegram/*`, `core/src/requests/*`, `core/src/draft/actions.ts`, `db/src/repos/{proposals,changes,adData}.ts`.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order:
  1. Core: the processor's `pause`, `pause_all` and `undo` handlers (Phase 1 behaviour) in `core/src/requests/operator.ts`; `budget` stays refused until M14. Tests in `core/test/requests.test.ts` (golden shape vs a drafted pause; halt doesn't block a pause).
  2. Worker: the command parser (`telegram/commands.ts`): one table of commands, names and arguments; product and entity resolution (never guesses; buttons when ambiguous).
  3. Worker: the operator confirm cards: `/pause` → the proposal card (Confirm = approve; Cancel = reject without asking a reason); `/pause_all` → one card for the set, with callback data carrying the request id.
  4. Worker: `/halt`, `/resume_agent`, `/undo`, `/changes`, `/budget`, `/ceiling`, `/digest`, and the read-only `/status`, `/proposals`, `/brief`, `/drift`; `/help`; the command menu (`setMyCommands`).
  5. Docs: BLUEPRINT "as built" (the full command grammar), decision D-087, the `add-telegram-command` skill.
- Cut first, if behind at ~300k: `/drift`; re-sending the brief (`/brief`). **Never cut:** halt.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. Operator proposals:
  - `/pause <name or id>` and `/pause-all <product>` show a confirm card, and the confirm tap is the approval;
  - in Phase 1 the card says "apply by hand"; from M11b onwards the gateway applies it immediately;
  - `/budget` replies "available in Phase 3".
- [ ] 2. Undo and history:
  - `/undo <rev>`: in Phase 1 it shows the stored undo so Marcus can apply it by hand; from M11b it creates the undo proposal;
  - `/changes` lists recent revisions.
- [ ] 3. `/halt <product|all>` and `/resume-agent`. Halt stops the agent only, and a halted product still accepts pause requests.
- [ ] 4. Read-only commands: `/status`, `/proposals`, `/brief`, `/drift`.
- [ ] 5. Quick settings, and only these: `/ceiling <product> daily|monthly <amount>` and `/digest <product> auto|always|off`, through `settings_patch`.
- [ ] 6. Entity resolution: a name fragment or an id. If it's ambiguous, the bot shows buttons listing the matches. **It never guesses.**
- [ ] 7. The processor handles `pause`, `pause_all` and `undo` (Phase 1 behaviour). `budget` is refused until M14.

## Tests
- [ ] An operator proposal has the same shape as a drafted one (golden test).
- [ ] Halt blocks the agent's work but not a pause.
- [ ] Settings are validated and recorded in the history.
- [ ] Ambiguous entity names are handled.

## Done when (cloud)
- [ ] All tests are green.
  - evidence: —

## Done when (live, run by Marcus)
- [ ] Marcus runs Phase 1 from Telegram for a week: approves and rejects SnapPool proposals; lowers a ceiling; pauses and un-pauses a test ad set, applying both by hand; halts and resumes the agent; receives the daily digests.
  - result: —

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- _Written at close._

## Skills to create
- `add-telegram-command`.

## Invariants review (BLUEPRINT §8), done at close
_At close._

## Evidence
_At close._

## Notes and surprises
- 2026-10-19: Telegram command names may hold only lowercase letters, digits and underscores (`BotCommand` in `@grammyjs/types` 5.0.0), so the menu lists `/pause_all` and `/resume_agent`; the bot also accepts the hyphen forms the plan uses.
- 2026-10-19: in Phase 1 the change log is empty (only the gateway writes it, M11b), so `/undo` and `/changes` also cover approved proposals that Marcus made by hand.
