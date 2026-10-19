# M10b — Dashboard: review views

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 1 (built before the Phase 0 gate, D-090) |
| **Started** | 2026-10-19 |
| **Finished** | 2026-10-19 (cloud) |
| **PRs** | [#20](https://github.com/marcustanforwork/agenticAdsManager/pull/20) |

## Goal
Review everything the agent has done, and act on proposals, from a screen.

## Needs
- [x] M10a (the app, sign-in, the request round trip): merged in PR #18. Its live steps (T10) wait; M10b's build doesn't need them.
- [x] Marcus's go-ahead to build before the Phase 0 gate: **D-090** (2026-10-19). Its live steps wait for M07's deploy and the gate.
- [x] The request handlers the views record: `approve`, `reject`, `edit_approve` (M08/M09a), `undo` (M09b), `brief_feedback` (M07), `product_doc_put` (M05b). No new request kind is needed.

## Read first
- M10a's milestone file; PROPOSAL §12 (how the gates are measured).

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- No new external API or library: Next.js 16 and React 19 were verified in M10a (GOTCHAS); nothing else is touched.
- Build order:
  1. DB: the `dashboard_outcomes` view in the drizzle schema (it already exists in `roles.sql`), and `repos/dashboard.ts`: the reads the views need that no repository has yet, all allowed to the dashboard's role (outcomes only through the view). Tested under `agent_dashboard`.
  2. `apps/web/src/lib`: pure computations (month projection, the 28-day KPI trend by week and day, the attribution rate, describing a proposal or change in words) and one loader per view.
  3. Pages, per product: **Overview** (spend vs ceilings with the projection, the KPI trend, outcomes by stage and attribution, accounts and last sync), **Proposals** (open ones with Approve / Reject / Edit; recently decided), **Changes** (the change log with "request undo"), **Checks** (trust-check history per cycle, drift, AI cost per cycle), **Briefs** (with 👍 / 💡), **Docs** (STRATEGY, PLAYBOOK, LEARNINGS editors with history). Each form records one request and goes to `/requests/<id>`, which then links back to the screen it came from.
  4. Tests: each view rendered from a fixture database (loader under the dashboard's role → component → HTML); the forms' requests; the processor round trip for each new kind from the web channel.
- Cut first, if behind at ~300k: the briefs view; the AI cost panel; Playwright.
- Playwright: there is no Playwright in the repo, and "`/status` shows it" is the Telegram bot. Planned instead: a browser run against the built app (as in M10a), and the `/status` check stays in the live steps.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. Views per product:
  - [x] spend (yesterday and month-to-date) vs the ceilings, with a projection;
  - [x] the 28-day KPI trend;
  - [x] outcomes by stage, and the attribution rate;
  - [x] trust-check history;
  - [x] open proposals, which can be approved, rejected or edited (as requests);
  - [x] the change log, with "request undo";
  - [x] drift;
  - [x] briefs, with the feedback buttons;
  - [x] AI cost;
  - [x] STRATEGY, PLAYBOOK and LEARNINGS editors, with history;
  - [x] a read-only list of accounts, with their last sync.

Notes on the build (details in D-091 and BLUEPRINT M10b "As built"):
- DB: `packages/db/src/repos/dashboard.ts` (spend per day from campaign rows; outcomes per day and by attribution method through the `dashboard_outcomes` view, now declared in the drizzle schema with `.existing()`, so no migration; cycle history with trust checks; AI cost; drift with its entity; entities by ref; findings by id; decisions; document versions). `packages/db/test/dashboard.test.ts` runs each under `agent_dashboard`.
- Web: `src/lib/review.ts` (money, the straight-line month projection, the 28-day trend by week and day, outcomes and attribution by stage, actions in words), `src/lib/reviewViews.ts` (one loader per screen, taking the database), `src/lib/reviewForms.ts` (each button → its request), `src/app/actions.ts` (`decideProposal`, `requestUndo`, `sendBriefFeedback`, `saveDoc`). Screens under `src/app/products/[slug]/`: `overview`, `proposals`, `changes`, `checks` (trust, drift, AI cost), `briefs`, `docs` and `docs/[doc]`; `/products/<slug>` opens the overview. The request page goes back to the screen the request came from, and shows a document request's text.

## Tests
- [x] Each view renders from a fixture database.
  - `apps/web/test/views.test.ts`: `test/support/world.ts` seeds one product with a bit of everything; each loader runs under `agent_dashboard`, the screen renders to HTML (`react-dom/server`), and the test reads the numbers, buttons and escaping.
- [x] Proposal actions and undo requests create the right operator requests.
  - `apps/web/test/reviewForms.test.ts` (each button's request, and what is refused before recording); `packages/core/test/webRequests.test.ts` "review actions from the dashboard" (approve, reject, edit_approve, undo, brief_feedback, product_doc_put recorded by the dashboard role and processed by the worker; a decision on an old version and a stale document refused).
- [ ] Playwright smoke test: change a ceiling, and `/status` shows it. **Moved to M16b** (see Cut / moved). Instead, a browser run this session (below, Evidence).

## Done when (cloud)
- [x] All tests are green.
  - evidence: `pnpm test` → 89 files passed (1 skipped), 1064 tests passed (3 skipped); `pnpm typecheck`, `pnpm lint`, `pnpm check:boundaries` (`OK (17 packages)`, no dependency violations), `pnpm build` (17 of 17), `pnpm format:check` all green on 2026-10-19.

## Done when (live, run by Marcus)
- [ ] Marcus reviews a week of proposals and the change log on the dashboard.
  - result: —

The **Phase 1 gate** is then evaluated (PROPOSAL §12). Its 3-week window can overlap the M09 and M10 build time.

### Live steps for Marcus
_After M10a's live steps (the dashboard deployed behind Access). No migration; Vercel deploys `main` when the PR is merged. Nothing here touches an ad account. Steps 1–4 can run during the Phase 0 gate; step 5 needs phase 1._
1. Open `https://ads.<your domain>/products/snappool/overview`.
   - expect: Spend (yesterday, month to date, projected), "Cost per signup, last 28 days" by week, outcomes by stage with the attribution rate, the accounts with their last sync. Yesterday's spend and the month match that morning's digest.
   - report: "overview seen", and whether the numbers match the digest.
2. Docs → STRATEGY: change a line and save.
   - expect: **Done** `{"doc": "strategy", "version": N+1}`; the history shows the new version "by web:<your email> via web".
   - report: "doc saved".
3. Briefs: on the latest brief, tick 👍 and/or 💡 and save.
   - expect: **Done**; "now: yes" on the brief. (The form sends both answers: press Telegram's buttons or the dashboard's, not both at the same time.)
   - report: "feedback saved".
4. Checks: the week's cycles with their trust result, any warnings, the AI cost; drift if anything was changed by hand.
   - report: "checks seen".
5. After the gate (phase 1, M08's step 2): review a week of proposals on the dashboard. Approve, reject (with a reason) or edit; make the approved ones by hand. The agree rate at the top is the Phase 1 gate's measure. The Changes tab stays empty until Phase 2 (the gateway writes it).
   - report: days, how many approved / rejected / edited, and "change log seen" (empty is expected in Phase 1). This is "Done when (live)".

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| Playwright smoke test: change a ceiling, and `/status` shows it | M16b, reworded: change a ceiling on the dashboard and its Overview shows it | It was on the Cut first list. The repo has no Playwright set-up, and `/status` (Telegram) doesn't show ceilings: `/ceiling` and the next digest do (M10a's live step 8 checks the digest). A browser run this session covered the same path by hand (Evidence). | 2026-10-19 |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- **The digest (core `report/digest.ts`) pluralises the stage *label*:** with SnapPool's label "Signup (email link clicked)" it prints "Cost per signup (email link clicked) (7 days)" and "12 signup (email link clicked)s". The dashboard now speaks of the KPI by its stage id; the digest should too (core `countOf` with the stage id). Small fix, any milestone touching reports.
- **Display formatters exist in three places:** core `report/format.ts`, the worker's `telegram/cards.ts` (`localTime`), and `apps/web/src/lib/review.ts`. The web copy rounds non-SGD money to cents, while core prints micros as they are (both products are SGD, so nothing shows today). Consider moving them into `@ads/contracts`, next to `formatSgd`.
- **Brief feedback sends both answers** (the contract's `brief_feedback`), so an answer given on Telegram after the Briefs page loaded is overwritten by the page's save. Acceptable for one operator; a "set one answer" request would remove it.
- **The `?error=` notice** on a review screen shows the URL's text (escaped, at most 300 characters). It only ever carries our own form messages, but a crafted link can show any text there; the dashboard is behind Access.
- **M11b** fills the change log; the Changes screen and "Request undo" work already (Phase 1: the worker answers with the stored undo, for Marcus to make by hand). From M11b, `undo` creates the undo proposal, and the request page should link to it.
- **M14** adds budget proposals with edits: the Proposals screen already offers "Edit: new daily budget" for `adjust_budget`.

## Skills to create
- none listed for M10b.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | apps/web has no connector; it only records requests |
| 2 | No product logic in shared code | yes | no product names in the dashboard or `@ads/db` |
| 3 | AI calls through core/model | yes | no AI calls |
| 4 | The AI never supplies decision numbers | yes | every figure on the screens is from SQL (`repos/dashboard.ts`, existing repos) |
| 5 | Untrusted text is data | yes | entity names, search terms and brief text are rendered as text (React escapes; tests check `<b>` and `<script>`) |
| 6 | Money is bigint micros / decimal strings | yes | sums, projection and cost per in bigint; amounts typed → micros with `decimalToMicros` |
| 7 | Every write action has an undo and a test | yes | no new write action |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | no guard changed; an edited budget is still checked by the worker's guards |
| 9 | Surfaces only record intent | yes | every button records one operator request; the dashboard role can insert nothing else |
| 10 | apps/web depends only on contracts + db | yes | `pnpm check:boundaries` OK |
| 11 | product_id + an index on product-scoped tables | yes | no new table |
| 12 | No state outside Postgres | yes | nothing stored in the browser |
| 13 | No secrets or personal data | yes | outcomes read through `dashboard_outcomes` (no hashed contact, no user agent); test keys generated at run time |
| 14 | No production write capability outside the gateway | yes | |
| 15 | Cut items moved at most once | yes | Playwright moved once, to M16b |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS, GOTCHAS, BLUEPRINT updated |

## Evidence
- `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check`: all green on 2026-10-19 (1064 tests passed, 3 skipped).
- Browser run (instead of Playwright; scripts not committed): `next start` against a local database seeded with `test/support/world.ts`, the dashboard as a login in `agent_dashboard`, a local Access key pair (the key set served by a `fetch` stand-in), and the worker's request processing (`processQueuedRequests`) in a loop. Headless Chromium through the global Playwright:
  - no token → 401; every screen opened with no page errors (Overview, Proposals, Changes, Checks, Briefs, Docs, a document);
  - Approve → **Done** `{"decision": "approve", "evalCase": true}`; Reject "dup keyword" → **Done**; Edit budget 17.50 → **Done** `{"edited": "budget", "version": 2}`, the card then shows `S$20.00 → S$17.50 a day`; agree rate 50% → 60%;
  - Request undo → **Done** with the stored undo (`remove_negative_keyword`); 👍 → **Done**, "now: yes"; STRATEGY saved → **Done** `{"version": 2}`, history "by web:marcus@example.com via web";
  - daily ceiling 25 → 30 on Settings → **Done** `{"version": 2}`; the Overview then shows "of S$30.00";
  - a tampered document kind → back on Docs with "Not sent: …"; a stale document version → **Refused**: "stale version 1, current is 2".

## Notes and surprises
- 2026-10-19: started. The dashboard role can't read `outcomes` (hashed contact details), only the `dashboard_outcomes` view, so the outcome counts the digest uses (`countOutcomesByScope`) can't be reused as they are; the dashboard gets its own counts over the view.
- 2026-10-19: Postgres refused `group by` on `(occurred_at at time zone $1)::date` repeated from the select: each copy binds the time zone as a new parameter, so the two expressions differ. Grouping by position (`group by 1, 2`) fixes it (GOTCHAS).
- 2026-10-19: rendering a server component's form with a function action through `react-dom/server` works in Vitest (the action becomes a `javascript:` URL, and React appends a small form-replay `<script>`), so the views are tested as rendered HTML without Next.
- 2026-10-19: code review (high): 10 findings. Fixed with tests: KPI words from the stage *label* ("…clicked)s"); a live pause card ignored the synced status; degraded cycles and no-signal checks looked healthy; a refused document save lost the text (the request page now shows it); findings were read one by one and their evidence wasn't shown; extra spend queries; the trend re-walked its days; `versionOf` duplicated. Not fixed, in Leave behind: the formatters copied from core (move to contracts); brief feedback overwrites a later Telegram answer. The same plural bug exists in the digest (core): Leave behind.
- 2026-10-19: no security review: M10b isn't on the security-sensitive list (D-067). It adds no new privilege: the dashboard role and the request kinds are M10a's and earlier.
