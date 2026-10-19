# M10a — Dashboard: app, sign-in, settings

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 1 (built before the Phase 0 gate, D-088) |
| **Started** | 2026-10-19 |
| **Finished** | 2026-10-19 (cloud) |
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
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. A Next.js App Router app in `apps/web`, deployed on **Vercel Pro** (D-054). It connects through Neon's **pooled** connection, using the `agent_dashboard` role.
- [x] 2. Sign-in with Cloudflare Access:
  - middleware verifies the `Cf-Access-Jwt-Assertion` token against the team's keys and the app's audience tag;
  - anything else gets a 401 (fail closed), which also closes the raw `*.vercel.app` address;
  - Vercel preview deployments are protected, and never get the production DB URL.
- [x] 3. The request round-trip: submit the request, poll its status, and show the result. Polling is used because LISTEN/NOTIFY doesn't work through Neon's pooler.
  - **Bind the actor to who inserted the row (D-068).** The M01b processor trusts the `actor` column, which the inserting role sets freely. So a leaked dashboard DB URL could act as Marcus on any channel. Add an `inserted_by` column (default `session_user`, not settable by the dashboard role), and have the processor accept a row from the dashboard role only with `channel = 'web'` and a `web:` actor. The dashboard sets the actor from the verified Access email.
- [x] 4. Settings, per product. Every change goes through `settings_patch`, and the page shows the worker's verdict:
  - ceilings, trust thresholds and digest mode;
  - outcome stages, tiers, KPI and feedback stages;
  - copy tier, required strings and banned phrases;
  - guard overrides (tighten-only) and disabled actions;
  - product status;
  - settings history;
  - the fact-base editor, generated from the `pack_manifests` JSON Schema.

Notes on the builds (details in D-089 and BLUEPRINT M10a "As built"):
- 1: `apps/web` (Next.js 16.4.2, React 19.3.1); `vercel.json` (build through turbo, region `sin1`), `turbo.json` (`.next` output). Only `VERCEL_ENV=production` reads `DASHBOARD_DATABASE_URL`; everything else reads `DASHBOARD_DEV_DATABASE_URL`; on Vercel the host must be `-pooler` (`src/lib/config.ts`).
- 2: `src/proxy.ts` → `src/lib/gate.ts` → `src/lib/access.ts` (jose 6); pages, the poll route and actions check again (`src/lib/server.ts`). Preview protection and env scoping are Vercel settings (live steps).
- 3: migration `0007` (`inserted_by`, the `request_queued` trigger), `roles.sql` (column-level insert), `packages/db/src/repos/web.ts`, the processor's binding (`packages/core/src/requests/processor.ts`), `apps/worker/src/requests.ts` (LISTEN + 30 s poll), `src/app/actions.ts`, `/requests/[id]` (polls `/api/requests/[id]`).
- 4: `src/app/products/[slug]/{settings,history,facts}`, `src/lib/{settingsForm,factsForm,forms,history}.ts`, contracts `jsonSchemaIssues`; product status via `halt`, `resume_agent` and the new `set_product_status`.

## Tests
- [x] Middleware: a missing, invalid or wrong-audience token gets a 401.
- [x] The dashboard role cannot UPDATE or DELETE anything, and cannot INSERT outside `operator_requests`.
- [x] Request round-trips: a valid request comes back `done`; a looser guard is refused, with the reason; a stale `baseVersion` is refused.
- [x] A row the dashboard role inserts with a `telegram:` actor or channel is refused.
- [x] The fact editor rejects anything the pack's schema rejects.

Where: `apps/web/test/access.test.ts` (middleware), `packages/db/test/roles.test.ts` (every table, via the privilege catalogue, plus spoofed columns), `packages/core/test/webRequests.test.ts` (round trips under the dashboard role, actor binding, `set_product_status`), `apps/web/test/forms.test.ts` and `apps/worker/test/factsSchema.test.ts` (the editor against the real packs: 24 cases plus 600 generated), `apps/worker/test/worker.test.ts` (the NOTIFY wake-up), `packages/db/test/web.test.ts`, `apps/web/test/config.test.ts`.

## Done when (cloud)
- [x] All tests are green, and `apps/web`'s dependency tree contains only `contracts` + `db`.
  - evidence: `pnpm test` → 85 files passed (1 skipped), 1031 tests passed (3 skipped); `pnpm check:boundaries` → `check-boundaries: OK (17 packages)`, `no dependency violations found (486 modules, 1331 dependencies cruised)`; `pnpm build` → 17 of 17 tasks, including `next build` of the dashboard.

## Done when (live, run by Marcus)
- [ ] The dashboard is deployed on Vercel behind Access, and the raw `*.vercel.app` address returns 401.
- [ ] Marcus configures SnapPool entirely from the settings screens.
- [ ] The next morning's digest reflects the new ceilings.

### Live steps for Marcus
_After M07's deploy, and T10. Production steps use Doppler's prod configs; nothing here touches an ad account._
1. Migrate dev and prod (migration `0007`: `inserted_by` and the request trigger): `git pull`, `pnpm install`, `doppler run --config dev -- pnpm --filter @ads/db db:migrate`; for prod as in M01a step 5.
   - expect: `migrations and roles.sql applied`. Report "migrated".
2. The dashboard's database login, with **SQL** in Neon's SQL editor (prod, and again on the dev branch), not from the Neon console:
   `create role ads_dashboard login password '<a long random password>'; grant agent_dashboard to ads_dashboard;`
   then `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid where m.member = 'ads_dashboard'::regrole;`
   - expect: one row, `agent_dashboard`. Paste the result (not the password).
3. T10, Cloudflare: an Access application for the dashboard's subdomain (e.g. `ads.<your domain>`), with a policy allowing only your email. Note its **AUD tag** and your team domain (`https://<team>.cloudflareaccess.com`).
4. T10, Vercel: a project with root directory `apps/web` (it reads `vercel.json`); Deployment Protection → **Standard Protection**; the custom domain `ads.<your domain>` through Cloudflare (proxied). Environment variables:
   - Production: `DASHBOARD_DATABASE_URL` = prod, user `ads_dashboard`, the **`-pooler`** host; `CF_ACCESS_TEAM_DOMAIN`; `CF_ACCESS_AUD`.
   - Preview: `DASHBOARD_DEV_DATABASE_URL` = the dev branch's `-pooler` URL for `ads_dashboard`; the same two `CF_ACCESS_*`.
   Deploy.
5. Worker: in Doppler `worker`, add `web:<your email, in lower case>` to `OPERATOR_ACTORS`, then `docker compose up -d --build` on the SER9 (the worker now processes the dashboard's requests).
6. Check the sign-in: `curl -s -o /dev/null -w "%{http_code}\n" https://<project>.vercel.app/` → `401`; opening `https://ads.<your domain>` asks you to sign in through Access, then shows "Products" and "Signed in as …". Report "401 seen, signed in".
7. Configure SnapPool from the screens: the daily and monthly ceilings and the digest, your test-traffic email domains, and anything else you want. Each save shows **Done** with the new version within a few seconds; **Settings history** shows "By web:… via web". Also try a looser guard (largest budget change 50%): expect **Refused** with the reason. Report "configured from the screens" and what you set.
8. The next morning's digest reflects the new ceilings. Report "digest OK".

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| none | | | |

## Leave behind (for later milestones)
- **M10b** builds its views in the same app: read with `@ads/db` under the dashboard's role, write only with `recordWebRequest` (then redirect to `/requests/<id>`), call `requireOperator()` first in every page, route and action. `src/lib/views.ts` is where the reads go.
- **Guard overrides can't be removed** from the dashboard: `settings_patch` merges objects key by key. If Marcus needs it, add an explicit "remove an override" to the patch (it loosens a guard, so it needs his OK).
- **A request whose handler keeps faulting** (not a refusal) stays queued and is retried on every drain, every 30 s on each replica, with no attempt count. Consider an attempt counter and a final refusal (M16b, ops hardening).
- **Stored settings that fail validation** show their problems but no forms; repair them with the CLI (`ads settings set`).
- The `request_queued` trigger also fires for requests Telegram and the CLI process in the same transaction; the drain then finds nothing (one cheap query per replica).
- Offerings are created by the seed or the CLI; the dashboard edits their facts only.

## Skills to create
- none listed for M10a.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | apps/web has no connector; nothing writes to a platform |
| 2 | No product logic in shared code | yes | no product names in shared code or the dashboard |
| 3 | AI calls through core/model | yes | no AI calls |
| 4 | The AI never supplies decision numbers | yes | no AI |
| 5 | Untrusted text is data | yes | settings and facts are rendered as data (React escapes) |
| 6 | Money is bigint micros / decimal strings | yes | amounts → micros with `decimalToMicros`; shown with exact integer maths |
| 7 | Every write action has an undo and a test | yes | no new write action |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | no guard changed; tighten-only is still the worker's check |
| 9 | Surfaces only record intent | yes | the dashboard only inserts requests; its role can insert only the request columns |
| 10 | apps/web depends only on contracts + db | yes | `pnpm check:boundaries` OK |
| 11 | product_id + an index on product-scoped tables | yes | no new product-scoped table |
| 12 | No state outside Postgres | yes | state is in Postgres; no browser storage |
| 13 | No secrets or personal data | yes | test keys are generated in tests; no secrets |
| 14 | No production write capability outside the gateway | yes |  |
| 15 | Cut items moved at most once | yes | nothing cut |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS, GOTCHAS, BLUEPRINT updated |

## Evidence
- `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check`: all green on 2026-10-19 (1031 tests passed, 3 skipped).
- Browser run against the built app (`next start`, a local database seeded with both packs, the dashboard as a login in `agent_dashboard`, a local Access key pair, the worker's request processing running): no token → 401; daily ceiling 20 → **Done** `{"version": 2}`; largest budget change 50% → **Refused**: "guard override loosens maxBudgetChangePct: layer 3 sets 50, stricter value is 30"; property-sg dormant → active **Done**; history "By web:marcus@example.com via web", `spend.dailyCeilingMicros null → "20000000"`; facts with plan id "Free Plan" refused on the page with the schema's reason (typed values kept), then saved → **Done** `{"factsVersion": 2}`.

## Notes and surprises
- 2026-10-19: external facts checked (GOTCHAS): Next.js 16 renamed `middleware.ts` to `proxy.ts`, which always runs on Node.js; Cloudflare Access tokens are verified against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` with issuer = the team domain and audience = the app's AUD tag. nextjs.org and developers.cloudflare.com are blocked in cloud sessions.
- 2026-10-19: the browser run found two bugs, both fixed with tests: React resets a form after its action, so a refused fact form lost what was typed; and the empty "add one" plan counted as a plan (its blank price reads as null).
- 2026-10-19: code review (high effort): 10 findings. Fixed: a halted product could be set active or dormant (`set_product_status` now refuses it); a local run read the production URL; a login inheriting `agent_dashboard` with extra privileges would be trusted; money in fact lists; a required yes/no couldn't be saved as no; unknown keys in a nullable list; the plan said `session_user`. Not fixed, in Leave behind: a request that keeps faulting retries every 30 s; the trigger also fires for already-processed requests; broken stored settings show no forms.
- 2026-10-19: security review (M10a is security-sensitive): no finding at confidence 8 or more. Checked: the token check (RS256 only, issuer, audience, exp, email), that every page, route and action checks the operator, that the dashboard role can't set `inserted_by` (no SECURITY DEFINER function anywhere), bound SQL parameters, no unsafe HTML, response headers. Applied its one hardening note: the editor's unknown-key check uses `Object.hasOwn` (a key such as `constructor` is named too). Below the bar, by design (D-068): a leaked dashboard database URL can still record requests as a `web:` operator; the binding stops it posing as Telegram or the CLI. And the login must be created with SQL (live step 2).
- 2026-10-19: the worker only drained queued requests at startup (`recoverWorker`); Telegram and the CLI process their own requests in the same transaction. The dashboard's requests need the worker to pick them up while running, so M10a adds that (an insert trigger NOTIFYs; the worker LISTENs on its direct connection and also polls).
