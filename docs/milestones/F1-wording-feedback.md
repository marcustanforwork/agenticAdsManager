# F1 — Wording and feedback fixes

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7 ("Fix sessions", D-092).
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | awaiting live acceptance (folded into M07's and M10b's live steps) |
| **Phase** | fix session (runs before the Phase 0 gate, D-092) |
| **Started** | 2026-10-19 |
| **Finished** | 2026-10-19 (cloud) |
| **PRs** | — |

## Goal
The digest, the brief, the proposal words and the dashboard say the right thing, and an answer given on one surface is never overwritten by another.

## Needs
- [x] M10b merged: PR [#20](https://github.com/marcustanforwork/agenticAdsManager/pull/20), merged 2026-10-19.
- [x] D-092 (Marcus): fix sessions F1 → F2 → F3 before the Phase 0 setup; they change no ad account, so they run before the gate.
- No setup task (T-number) and no open question.

## Read first
- M10b's and M07's milestone files ("Leave behind").
- BLUEPRINT §5.14 (briefs and digests).
- `packages/core/src/report/` and `packages/core/src/draft/rationale.ts`.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order (each leaves the tree green; commit and push after each):
  1. Counts by stage id: one helper, used by the digest, the brief (template prose and rendering) and the template words; the dashboard's copy follows the same rule.
  2. `brief_feedback` with one answer at a time: contract, repository, handler, Telegram, dashboard form (sends only what changed).
  3. Error codes on the review screens: `FormError` carries a code; the notice looks the text up; unknown → a generic line.
  4. `newProposals` in the brief's numbers table and a line in the rendered brief.
- Then: `preflight`, `code-review` at high effort, fixes, `close-milestone`, `end-session`, one PR.
- Cut first, if behind at ~300k: item 4 (moves to F3, which rehearses the brief with proposals).
- Size ~250k: no checkpoint pressure expected.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [x] ~300k built, typecheck green (at ~190k)
  - [x] ~450k tests green, self-review done (at ~240k)
  - [x] ~550k committed, pushed, handed off (closed at ~260k)

## Builds
- [x] 1. **Counts by stage id, everywhere** (M10b review): the digest, the brief (template prose and rendering) and the drafted proposals' template words print a count with the KPI's stage id ("12 signups"), never by pluralising its label ("12 signup (email link clicked)s"). The label may still appear as a name. Same rule as the detectors (M06a) and the dashboard (M10b).
  - plan: core `report/format.ts` `countOf` takes a stage id (or a plain noun): `_` → space, lower case, plural `s` unless the word already ends in `s`, or reads as a state rather than a thing (ends in `ed`, or `paid`), so `paid` / `booked` / `activated` don't become "paids". "Cost per <stage id>" in the digest and the brief. The dashboard's `countOf` (`apps/web/src/lib/review.ts`) gets the same rule (it says "3 paids" when the KPI is switched to `paid`); F2 merges the copies into contracts.
  - done: `stageWord` + `countOf` in `core/src/report/format.ts`; digest, brief (template prose, outcomes, cost per, campaigns, finding lines) and `templateWords` count by stage id. The Telegram cards already passed stage ids to core's `countOf`, so they now read "pool requests" instead of "pool_requests". Tests: `report.test.ts` "counts by stage id (F1)"; `apps/web/test/review.test.ts`.
- [x] 2. **`brief_feedback` sets one answer at a time** (M10b review): `useful` and `newInfo` become optional, with at least one given; the repository updates only the given fields. Telegram sends the button pressed; the dashboard sends only what changed. A request with both fields stays valid.
  - plan: the handler returns both answers as stored after the update, so the Telegram buttons show the true state. The Briefs form carries the answers it showed (hidden fields); a box left as shown is not sent; a form with nothing changed goes back with a notice.
  - done: contract (`.optional()` + a refine), `setBriefFeedback` (only given fields; returns both as stored), the handler's result, Telegram (`bot.ts`: the pressed answer only; the answer text and buttons from the stored state), the Briefs form (`usefulShown` / `newInfoShown`; `briefFeedbackRequest` sends only a changed box; a box shown unanswered counts as unticked). BLUEPRINT §3 contract text updated. Tests: `requests.test.ts`, `telegram.test.ts` (Telegram then dashboard keeps both), `reviewForms.test.ts`, `views.test.ts`.
- [x] 3. **The dashboard's error notice shows only our own messages** (M10b review): a review screen's `?error=` carries a short code, and the server looks up the text; an unknown code shows a generic line.
  - plan: `FormError(code)`; a code table next to the forms (`reviewForms.ts`); the contract's issue list is no longer put in the URL.
  - done: `FORM_ERRORS` + `formErrorText` in `apps/web/src/lib/reviewForms.ts` (codes `invalid`, `reject_reason`, `budget`, `negative_text`, `match_type`, `feedback_unchanged`); `actions.ts` redirects with `?error=<code>`; `FormNotice` (Tabs.tsx) shows the looked-up words, the generic line for anything else (`Object.hasOwn`, so `toString` / `__proto__` are unknown too). The contract's issue text is dropped (it was only ever shown, never logged). Tests: `reviewForms.test.ts` "error codes (F1)", `views.test.ts` "the form notice (F1)".
- [x] 4. **The brief counts the cycle's new proposals** (M07 "Leave behind", for M08): the numbers table gains `newProposals`; when there are some, the brief says how many and where to decide them (Telegram, dashboard).
  - plan: a repository count of the cycle's proposals; an optional field in `brief-numbers-v1` (stored briefs without it stay readable, like `agreeRate`); a "## Proposals" line in the rendered brief, so it shows whoever wrote the prose.
  - done: `countCycleProposals` (`db/repos/proposals.ts`); `BriefNumbers.newProposals?`; a "## To decide" section right under the prose ("This cycle proposed 2 changes. Decide them on the cards in Telegram (or /proposals), or on the dashboard's Proposals page."), only when there are some. The AI may quote the count (it is in the table, so the number check allows it). Test: `draft.test.ts` "the new proposals in the weekly brief (F1)".

## Tests
- [x] Digest, brief and template words rendered with a descriptive stage label: no pluralised label anywhere.
- [x] Brief feedback: a Telegram answer, then a dashboard save of the other answer, keeps both; a two-field request still works.
- [x] Error codes: a crafted `?error=` text is never shown; an unknown code shows the generic line.
- [x] A brief with 0 and with 2 new proposals.

## Done when (cloud)
- [x] All tests are green.
  - evidence: `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check` → exit 0; 1,073 tests passed (3 skipped, as before F1). See Evidence.

## Done when (live, run by Marcus)
- [ ] Folded into M07's and M10b's live steps (the digest and brief read right; feedback from both surfaces is kept).
  - result: —

### Live steps for Marcus
No steps of its own (D-092). They fold into:
1. M07 step 5 and the 7 unattended days: the digest says "Cost per signup", "N signups"; the brief's numbers say the same.
2. M10b step 3: press 👍 on Telegram, then choose 💡 yes on the dashboard's Briefs page (loaded before the press): both stay.
3. At phase 1 (M08 step 3): a brief after a cycle that proposed changes says how many and where to decide them.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- **F2:** `countOf` / `stageWord` exist in core (`report/format.ts`) and in the web (`lib/review.ts`) with the same rule (stage id, "paid outcomes", y → ies); merge them with the other formatters into `@ads/contracts`.
- **F3:** the Phase 0 checklist artifact's M10b step 3 may still say "tick 👍 / 💡": the Briefs page now has yes / no choices (NOW.md and the M10b file are updated).
- **M16a:** the drafter's DATA block gives the AI the KPI's label (`kpi: ctx.kpiLabel`), so AI-written proposal words may name it differently from the template ("2 signups"). If a prompt change is made for the model-swap gate, give it the stage id too (a new `drafter-v2`).

## Skills to create
- None.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | No write action touched; nothing reaches an ad account. |
| 2 | No product logic in shared code | yes | The plural rule is generic (stage ids, state words); no product names in shared code (the grep is clean outside tests). |
| 3 | AI calls through core/model | yes | No new AI call. |
| 4 | The AI never supplies decision numbers | yes | `newProposals` comes from SQL; the "To decide" line is printed by code; the number check still holds the AI's prose to the table. |
| 5 | Untrusted text is data | yes | The `?error=` value is never shown: only our own words for a known code (fixes M10b's crafted-link gap). |
| 6 | Money is bigint micros / decimal strings | yes | No money maths changed. |
| 7 | Every write action has an undo and a test | n/a | No write action. |
| 8 | Every guard has a property test; copy rules have pass/fail examples | n/a | No guard or copy rule. |
| 9 | Surfaces only record intent | yes | Telegram and the Briefs page still only record `brief_feedback`; the worker stores it. |
| 10 | apps/web depends only on contracts + db | yes | The web uses `EditSpec` and `OperatorRequest` from contracts; `check:boundaries` OK. |
| 11 | product_id + an index on product-scoped tables | yes | No new table; the new count filters on product_id + status (indexed). |
| 12 | No state outside Postgres | yes | Feedback state stays in `briefs`; the form's shown values are hidden fields of one page. |
| 13 | No secrets or personal data | yes | None added; tests use example.com. |
| 14 | No production write capability outside the gateway | yes | Unchanged. |
| 15 | Cut items moved at most once | yes | Nothing cut. |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-093), BLUEPRINT v3.31 updated at close. |

## Evidence
```
$ pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check   # 2026-10-19, after the review fixes
 Tasks:    17 successful, 17 total                       (typecheck)
check-boundaries: OK (17 packages)
✔ no dependency violations found (555 modules, 1513 dependencies cruised)
 Test Files  89 passed | 1 skipped (90)
      Tests  1073 passed | 3 skipped (1076)
 Tasks:    17 successful, 17 total                       (build)
All matched files use Prettier code style!
exit 0
```
- Preflight greps: invariant 1 and 13 clean (the one `ya29.` hit is the existing fake token in `connector-testing`'s test); invariant 2 clean in shared code; invariant 6: no float near money in the diff.
- The F1 tests: `report.test.ts` "counts by stage id (F1)"; `draft.test.ts` "the new proposals in the weekly brief (F1)"; `requests.test.ts` "one answer at a time"; `telegram.test.ts` "a Telegram answer, then a dashboard save of the other answer, keeps both"; `reviewForms.test.ts` "brief feedback sends only the answers changed" and "error codes (F1)"; `views.test.ts` "the form notice (F1)" and the Briefs form; `review.test.ts` countOf.

## Notes and surprises
- 2026-10-19: code review (high): 8 findings. Fixed with tests: (1) with checkboxes the Briefs page couldn't record a deliberate "no" on an unanswered brief (unticked = unanswered = no), so each answer is now a yes / no choice, preset to what is stored, and an untouched choice sends nothing; (2) "Cost per paid" / "no paid" read badly, so a stage named for a state becomes a noun ("paid outcome(s)"); (6) plurals of ids ending in y / ch / sh / x / z ("enquiries", "searches"); (3) `edit_text` / `edit_match` showed their own code for any contract failure, so now the edit is checked alone first and a broken card is `invalid`; (4 and 8) "To decide" counted decided proposals too and filtered on the unindexed `cycle_id`, so it now counts the cycle's `pending` ones through the (product_id, status) index, worded "waiting for your decision". Not fixed: (5) the plural rule is copied in core and web, and F2 merges the formatters into contracts (D-092); (7) the drafter's DATA still names the KPI by its label, which the AI writes free prose around (its numbers are checked), and changing the prompt means a new instructions version, so it goes to M16a (Leave behind).
- 2026-10-19: started. External facts: F1 touches no external API or library beyond what M07–M10b already verified (Telegram callback answers, Next.js redirects and `searchParams`); nothing new to check.
