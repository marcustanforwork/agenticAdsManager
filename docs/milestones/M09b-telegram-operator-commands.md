# M09b — Telegram operator commands

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 1 (built before the Phase 0 gate, D-086) |
| **Started** | 2026-10-19 |
| **Finished** | 2026-10-19 (cloud); live acceptance after M07's deploy and the Phase 0 gate |
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
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. Operator proposals:
  - `/pause <name or id>` and `/pause-all <product>` show a confirm card, and the confirm tap is the approval;
  - in Phase 1 the card says "apply by hand"; from M11b onwards the gateway applies it immediately;
  - `/budget` replies "available in Phase 3".
  - notes: `apps/worker/src/telegram/pause.ts`; operator cards show **Confirm / Cancel** on the M09a `approve` / `reject` verbs (`cards.ts`, `decide.ts`); the pause-all card's buttons are `v1:allok|allno:<request uuid>:0`.
- [x] 2. Undo and history:
  - `/undo <rev>`: in Phase 1 it shows the stored undo so Marcus can apply it by hand; from M11b it creates the undo proposal;
  - `/changes` lists recent revisions.
  - notes: `views.ts`. Phase 1 has no revisions (only the gateway writes the change log), so `/undo <proposal id>` and `/changes` also cover the approved proposals Marcus made by hand (D-087).
- [x] 3. `/halt <product|all>` and `/resume-agent`. Halt stops the agent only, and a halted product still accepts pause requests.
  - notes: `commands.ts`; the M01b `halt` / `resume_agent` handlers unchanged; the pause handlers don't check the product's status.
- [x] 4. Read-only commands: `/status`, `/proposals`, `/brief`, `/drift`.
  - notes: `views.ts`; the brief's buttons moved to `feedback.ts` so `/brief` resends it with them.
- [x] 5. Quick settings, and only these: `/ceiling <product> daily|monthly <amount>` and `/digest <product> auto|always|off`, through `settings_patch`.
  - notes: `commands.ts`; the product may be left out when only one isn't dormant.
- [x] 6. Entity resolution: a name fragment or an id. If it's ambiguous, the bot shows buttons listing the matches. **It never guesses.**
  - notes: `findEntities` (`pause.ts`): a ref, an exact id (wins over names), or a name fragment ≥ 2 characters; up to 8 buttons `v1:pick:<entity uuid>:0`.
- [x] 7. The processor handles `pause`, `pause_all` and `undo` (Phase 1 behaviour). `budget` is refused until M14.
  - notes: `core/src/requests/operator.ts` (30-minute expiry; an open proposal with the same action is returned, not duplicated).

## Tests
- [x] An operator proposal has the same shape as a drafted one (golden test). — `core/test/draft.test.ts` "operator proposals (M09b)".
- [x] Halt blocks the agent's work but not a pause. — `core/test/cycle.test.ts` "halt stops the agent … but not a pause"; `requests.test.ts` pause_all on a halted product; `commands.test.ts` `/halt` then `/pause`.
- [x] Settings are validated and recorded in the history. — `commands.test.ts` "quick settings" (new version, history row with its request; bad input records nothing); the processor's validation is `core/test/requests.test.ts` "settings_patch".
- [x] Ambiguous entity names are handled. — `commands.test.ts` "several matches: buttons …", "an exact id wins …", and two live products → "Name the product".

## Done when (cloud)
- [x] All tests are green.
  - evidence: below.

## Done when (live, run by Marcus)
- [ ] Marcus runs Phase 1 from Telegram for a week: approves and rejects SnapPool proposals; lowers a ceiling; pauses and un-pauses a test ad set, applying both by hand; halts and resumes the agent; receives the daily digests.
  - result: —

### Live steps for Marcus
_After M07's deploy (T7 done) and M09a's step 1. No migration. Steps 3–6 need phase 1 for proposals (after the Phase 0 gate); the rest work at phase 0 too (D-086)._
1. Deploy: on the SER9, `git pull` on `main`, then the `deploy-worker` steps (`docker compose up -d --build`, both `healthy`).
   - expect: in the bot chat, typing `/` shows the menu (`status`, `proposals`, `pause`, `pause_all`, `halt`, `ceiling`, …).
   - report back: "menu seen".
2. `/status`
   - expect: `Status · phase N · writes off`, then `snappool: ▶️ active` with its last cycle, and `property-sg: 💤 dormant`.
   - report back: paste it.
3. Lower a ceiling: `/ceiling snappool daily <a lower amount>`
   - expect: `snappool daily ceiling: S$… → S$… (settings vN)`.
   - report back: "ceiling lowered".
4. A test ad set: `/pause <part of its name>` (or its id). Several matches → tap the right button. Tap **✅ Confirm** on the card, then pause it by hand in Meta Ads Manager. `/changes snappool` lists it; `/undo <its id>` shows "turn … back on"; turn it back on by hand.
   - expect: the card ends "✅ approved. Phase 1 applies nothing: make the change by hand…".
   - report back: "pause and un-pause by hand OK".
5. `/halt snappool` → `⏸ Halted: snappool`; `/status` shows halted. Then `/resume_agent` → `▶️ Resumed: snappool`, **the same day** (a halted product runs no cycle, so no digest the next morning).
   - report back: "halt and resume OK".
6. For a week (phase 1): decide SnapPool's proposal cards (Approve / Reject with a reason / Edit); try `/proposals`, `/brief` and `/drift` once each.
   - report back: the days, how many approved and rejected, "digests received each day", and anything confusing.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| — | — | Nothing cut | 2026-10-19 |

## Leave behind (for later milestones)
- **The full command grammar** is in BLUEPRINT M09b "As built" (D-087) and the table `COMMANDS` (`apps/worker/src/telegram/commands.ts`). The `add-telegram-command` skill says how to add one.
- **Callback data in use (stable forever):** `v1:approve|reject|edit:<shortId>:<version>` (cards, M09a), `v1:useful|new:<briefId>:0` (brief, M07), `v1:pick:<entity uuid>:0` and `v1:allok|allno:<pause_all request uuid>:0` (M09b).
- **M11b (gateway):** a confirmed operator pause should go to the gateway at once (priority 100, §5.4 step 3), and the card's "Phase 1 applies nothing" lines (`cards.ts` `STATUS_WORDS.approved` and the operator pending line; `pause.ts` `renderPauseAll`) must say the gateway applies it. Swap the `undo` handler's Phase 1 behaviour (return the stored undo) for `createUndoProposal` (db) and send its confirm card; `/undo <proposal id>` (Phase 1's by-hand path) can then go. Note: in Phase 1 approved proposals expire (nothing applies them); the bot treats "expired with an approval" as made by hand (`approvedByMarcus`, `reply.ts`).
- **M10b (dashboard):** a pause from the dashboard can use the same `pause` request; the 30-minute expiry is for a confirm card, so a web confirm should approve within it.
- **M14 (budgets):** `/budget` replies "available in Phase 3" and records nothing; the processor still refuses `budget` (`NOT_AVAILABLE_UNTIL`). Build it as a confirm card like `/pause`.
- **Performance, if entities grow large:** `findEntities` reads every pausable entity of every product per `/pause`; a SQL search (id equality or name `ILIKE`, limited) would do (review finding, not worth it at today's size).

## Skills to create
- [x] `add-telegram-command` (`.claude/skills/add-telegram-command/SKILL.md`).

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | No new dependency on `connector-*-write` (check:boundaries); pauses are proposals; Phase 1 applies nothing |
| 2 | No product logic in shared code | yes | No product names in the bot or core (the one in a usage example was removed in review) |
| 3 | AI calls through core/model | yes | No model call |
| 4 | The AI never supplies decision numbers | yes | Every figure from the database; ceilings typed by Marcus, checked by the processor |
| 5 | Untrusted text is data | yes | Names and keywords escaped in HTML (`entityLine`, tested with `<b>` in a name); button labels are plain text |
| 6 | Money is bigint micros / decimal strings | yes | `parseAmount` → `decimalToMicros`; `formatMoney` from micros |
| 7 | Every write action has an undo and a test | yes | No new action; operator pauses carry `plannedUndo` (golden test) |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | No new guard |
| 9 | Surfaces only record intent | yes | Every change is `submitRequest` (`pause`, `pause_all`, `approve`, `reject`, `undo`, `halt`, `resume_agent`, `settings_patch`); the bot only reads otherwise |
| 10 | apps/web depends only on contracts + db | yes | Untouched |
| 11 | product_id + an index on product-scoped tables | yes | No new table |
| 12 | No state outside Postgres | yes | The pause-all group is the `pause_all` request's result; no in-memory state |
| 13 | No secrets or personal data | yes | Test ids are fake; no tokens |
| 14 | No production write capability outside the gateway | yes | — |
| 15 | Cut items moved at most once | yes | Nothing cut |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-087), GOTCHAS updated at close |

## Evidence
```
$ pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm format:check
 Tasks:    17 successful, 17 total
check-boundaries: OK (17 packages)
✔ no dependency violations found
All matched files use Prettier code style!

$ pnpm test
 Test Files  79 passed | 1 skipped (80)
      Tests  956 passed | 3 skipped (959)

$ pnpm vitest run apps/worker/test/commands.test.ts      →  Tests  29 passed (29)
$ pnpm vitest run packages/core/test/requests.test.ts    →  Tests  39 passed (39)
```

## Notes and surprises
- 2026-10-19: Telegram command names may hold only lowercase letters, digits and underscores (`BotCommand` in `@grammyjs/types` 5.0.0), so the menu lists `/pause_all` and `/resume_agent`; the bot also accepts the hyphen forms the plan uses.
- 2026-10-19: in Phase 1 the change log is empty (only the gateway writes it, M11b), so `/undo` and `/changes` also cover approved proposals that Marcus made by hand.
- 2026-10-19: an M08 test (the agree rate in the weekly brief) had started failing on 2026-10-15: its drafted proposal, dated by the test clock (2026-10-08), had expired in real time before it was approved. Fixed by moving the expiry past today in the test (`keepOpen`).
- 2026-10-19: code review (high) over the milestone diff: 10 findings, all confirmed. Fixed: `/pause_all` Cancel rejected an agent-drafted pause (would skew the agree rate); a confirmed pause vanished from `/changes` / `/undo` after its 30-minute expiry; `/pause_all` defaulted the product; a faulting pause-all press said "no longer exists"; replies had no plain-text fallback; `/proposals` ordering; a double query in `/drift`; duplicated helpers; a product name in help text. Not changed: `findEntities` scanning all entities (fine at today's size; noted in Leave behind).
