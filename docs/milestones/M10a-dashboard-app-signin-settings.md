# M10a — Dashboard: app, sign-in, settings

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 1 (built before the Phase 0 gate, D-088) |
| **Started** | 2026-10-19 |
| **Finished** | — |
| **PRs** | [#18](https://github.com/marcustanforwork/agenticAdsManager/pull/18) (also carries the M09b memory note) |

## Goal
The one place to configure products. It holds no platform credentials and can only record requests.

## Needs
- [ ] T10 (Cloudflare Access and the Vercel project): **not done**. Only the live steps need it; the build uses test keys and a local Postgres.
- [x] Marcus's go-ahead to build before the Phase 0 gate: **D-088** (2026-10-19).
- [x] M01b (the request processor), M05a/M05b (`settings_patch`, `facts_put`, `pack_manifests`): merged.

## Read first
- PROPOSAL §6.3, §10 (dashboard row) and §11; BLUEPRINT §2 (web may depend only on `contracts` + `db`), §4 (the dashboard role) and §5.4.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order:
  1. DB: `operator_requests.inserted_by` + column-level insert grant for the dashboard + an insert trigger that NOTIFYs the worker; the dashboard's repository functions (record a web request, read its status, settings history, manifests, offerings).
  2. Core: the processor's actor binding (D-068); `set_product_status` for active ↔ dormant; the worker processes queued requests on NOTIFY, with a poll as a backstop.
  3. `apps/web`: Next.js 16 app, `proxy.ts` that verifies the Access token (fail closed), the same check in every page and server action, the preview-DB guard.
  4. The request round trip (server action → request page that polls → verdict).
  5. Settings screens per section, history, the fact-base editor generated from the manifest's JSON Schema.
- Cut first, if behind at ~300k: the generated fact-editor form falls back to a JSON text box (validated against the same schema); settings-history diffs show the full versions instead of the changed paths. **Never cut:** the settings screens and their history.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. A Next.js App Router app in `apps/web`, deployed on **Vercel Pro** (D-054). It connects through Neon's **pooled** connection, using the `agent_dashboard` role.
- [ ] 2. Sign-in with Cloudflare Access:
  - middleware verifies the `Cf-Access-Jwt-Assertion` token against the team's keys and the app's audience tag;
  - anything else gets a 401 (fail closed), which also closes the raw `*.vercel.app` address;
  - Vercel preview deployments are protected, and never get the production DB URL.
- [ ] 3. The request round-trip: submit the request, poll its status, and show the result. Polling is used because LISTEN/NOTIFY doesn't work through Neon's pooler.
  - **Bind the actor to who inserted the row (D-068).** The M01b processor trusts the `actor` column, which the inserting role sets freely. So a leaked dashboard DB URL could act as Marcus on any channel. Add an `inserted_by` column (default `session_user`, not settable by the dashboard role), and have the processor accept a row from the dashboard role only with `channel = 'web'` and a `web:` actor. The dashboard sets the actor from the verified Access email.
- [ ] 4. Settings, per product. Every change goes through `settings_patch`, and the page shows the worker's verdict:
  - ceilings, trust thresholds and digest mode;
  - outcome stages, tiers, KPI and feedback stages;
  - copy tier, required strings and banned phrases;
  - guard overrides (tighten-only) and disabled actions;
  - product status;
  - settings history;
  - the fact-base editor, generated from the `pack_manifests` JSON Schema.

## Tests
- [ ] Middleware: a missing, invalid or wrong-audience token gets a 401.
- [ ] The dashboard role cannot UPDATE or DELETE anything, and cannot INSERT outside `operator_requests`.
- [ ] Request round-trips: a valid request comes back `done`; a looser guard is refused, with the reason; a stale `baseVersion` is refused.
- [ ] A row the dashboard role inserts with a `telegram:` actor or channel is refused.
- [ ] The fact editor rejects anything the pack's schema rejects.

## Done when (cloud)
- [ ] All tests are green, and `apps/web`'s dependency tree contains only `contracts` + `db`.
  - evidence: —

## Done when (live, run by Marcus)
- [ ] The dashboard is deployed on Vercel behind Access, and the raw `*.vercel.app` address returns 401.
- [ ] Marcus configures SnapPool entirely from the settings screens.
- [ ] The next morning's digest reflects the new ceilings.

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- …

## Skills to create
- none listed for M10a.

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
- 2026-10-19: external facts checked (GOTCHAS): Next.js 16 renamed `middleware.ts` to `proxy.ts`, which always runs on Node.js; Cloudflare Access tokens are verified against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` with issuer = the team domain and audience = the app's AUD tag. nextjs.org and developers.cloudflare.com are blocked in cloud sessions.
- 2026-10-19: the worker only drained queued requests at startup (`recoverWorker`); Telegram and the CLI process their own requests in the same transaction. The dashboard's requests need the worker to pick them up while running, so M10a adds that (an insert trigger NOTIFYs; the worker LISTENs on its direct connection and also polls).
