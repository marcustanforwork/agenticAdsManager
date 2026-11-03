# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-11-03 (later) · local session (SER9) · branch `m01a/live-acceptance` (the dev live steps' results: F4's grant, M01a–M06b) · draft PR [#26](https://github.com/marcustanforwork/agenticAdsManager/pull/26). **M01a's dev steps 1–4 passed** (2026-11-03, run by Claude on Marcus's go-ahead); **its prod steps 5–6 wait for Marcus at the SER9** (he was remote; a local session may never use the prod owner string). **The dev live steps M02–M06b ran the same day:** M02 and M03 (after Explorer, D-100, and linking SnapPool under the manager) dry syncs passed; M04 day 1; M05a's outcomes; M05b; M06a; M06b's property case with the real model (PR [#27](https://github.com/marcustanforwork/agenticAdsManager/pull/27)). **Both ad accounts are empty (no campaigns yet)**, so the fixtures and M06b's analysed cycle wait for the first ads. PR [#25](https://github.com/marcustanforwork/agenticAdsManager/pull/25) (**F4**) **merged** on Marcus's word; **CI green again**. **F4's purchases grant applied** on SnapPool's production branch and checked (2026-11-03). **Phase 0 setup** follows the artifact **[Phase 0 Live Checklist](https://claude.ai/artifact/12LGui2vrbD3b2yxrrao4f)** (its ticks: the artifact's database, collection `progress`; read them with the artifacts tool `db_list`). **Done and checked:** T1, T2, T3, T4 (Meta spending limit still to set), T5, **T6a** (2026-10-28), **T7**, **T8**, **T9** (all four `MODEL_*` = `anthropic:claude-opus-5-5`, D-098), **T10's first part** (2026-11-03), **T14's Google part**. **M00's live steps passed** (2026-11-03). **M11a onwards wait for the Phase 0 gate** (D-090).

## Where we are
- **Phase:** 0. **F4 merged** (PR #25, on Marcus's word, 2026-11-03; `docs/milestones/F4-ci-snappool-purchases-ai-limit.md`): CI green again (and a year ahead), the SnapPool connect timeout, SnapPool purchases as outcomes (`card_saved`, `paid`, `refunded`) with paying customers in the brief and the Overview. **Item 4, the AI cost soft limit, cut to F5** (D-099). **Next: the rest of the dev live steps (item 2), then F5.**
- **Built and merged:** M00–M10b and F1–F4. All but M00 and M01b await live acceptance (F4: the purchases grant).
- **New decisions (2026-11-03):** D-096 (purchases), D-097 (F4), D-098 (Opus 5.5 for Phase 0), **D-099** (F4 as built: one clock per comparison, a stage's `role`, the purchases grant as code, item 4 → F5), **D-100** (Google: Explorer access must be applied for; enabling the API gives Test access only).
- **Status:** BLUEPRINT v3.36, PROPOSAL v3.12, SNAPPOOL-TRACKING v1.4.
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens (BLUEPRINT §9).

## Next action
1. **Done 2026-11-03:** the purchases grant (Marcus ran it; Claude checked it as `ads_agent_ro`: 6 / 5 / 9 / 6 columns, `card_ref` denied, the adapter's read ok with 7 outcomes in 35 days). Details in the F4 milestone file.
2. **The dev live steps, on this branch `m01a/live-acceptance`** (draft PR #26; continue it). Run `nvm use` first (GOTCHAS). Record each result in the milestone file and tick it in the checklist artifact (`progress`). Done on 2026-11-03 (by Claude, Marcus's go-ahead, Doppler `dev`): M01a 1–4; M02 1–6, 8, 9; M03 1–6, 8; M04 2 (day 1); M05a 1–4; M05b 1–4; M06a 1, 3, 4; M06b 5. **Left:**
   - **Marcus's answers:**
     - M05a step 5: his test email domain(s) and daily ceiling (the monthly is S$500), then Claude runs steps 5–6 (settings v2, the KPI switch and back). **Test traffic is matched by domain only**, so it must be a domain only SnapPool staff use (e.g. `snappool.photos`), **never `gmail.com`**: that would mark every Gmail sign-up as test. Marcus plans a new SnapPool Gmail (2026-11-03): test sign-ups need an address on SnapPool's own domain instead. Nothing stops a free-mail domain today; a guard (refuse `gmail.com` and the like) is a candidate for F5 if there's room;
     - M06a step 3: "trace seen" in Langfuse (the model ping, US$0.0015);
     - M06b step 5: are the property findings useful on first read? Then PR #27 (the Opus 5.5 case plus a replay look-ups fix) can merge, on his word, after CI.
   - **Claude, on 2026-11-04 or later:** M04 step 3 (day 2: the same daily cycle command) and step 4 (the restart check with the dev stack `ads-agent-dev`).
   - **After the first ads have run about a week:**
     - M02 step 7 and M03 step 7 (record fixtures; the recorded tests need rows). Meta: the token and app secret are in Doppler `dev` as `META_READ_ACCESS_TOKEN` / `META_APP_SECRET`. Claude recommended keeping them until then and deleting them after. Google: the key in `~/Downloads/ads-agent-512616-b56034686591.json`, then into Marcus's password manager.
     - M06b steps 2–4 (an analysed cycle with findings, the Langfuse trace).
   - **Marcus, at the SER9:** M01a steps 5–6 (prod migrate + seed; never by a local Claude session). Nothing before M07 needs prod.
   - **Google, for later:** the manager has two not-enabled client links (`884-331-3896`, `319-172-0680`; setup never finished). Harmless. Marcus may cancel them; one may be meant for property-sg.
3. **Claude, after that: F5** (BLUEPRINT §7 F5, D-099): the AI cost soft limit (US$20 a month default; skip the AI stages at the limit, one alert, "AI paused: monthly limit" in the brief and digest), with tests at, below and above; and the Phase 0 checklist artifact's grant step (D-096). It can run while Marcus does the live steps (it changes no stored stage).
4. **Marcus, setup left:** T10's database settings (at M10a: steps 1, 2 and 4); T14's Meta part (URL parameters on each ad) and the Meta spending limit, both with the first ad.
5. **Claude, docs only, with `update-plan`** (carried over): M05a's live step 2 and PROPOSAL §16 T6 → make `ads_agent_ro` with SQL, never the console; M07's and M08's steps → `ADS_OPERATOR=marcus` in Doppler `worker`; M01a says each service's login role comes in M07, but M07 uses the owner string for the worker (decide: keep it, or add an `ads_worker` login like M10a's `ads_dashboard`); T3 → Doppler's 4-environment limit; the checklist artifact's M10a step 6 (302 to Vercel's login).
6. **Phase 0 gate (4 weeks, PROPOSAL §12):** starts once M07 runs live. Press 👍 / 💡 on each weekly brief. When it passes, Marcus sets phase 1 (`ads phase set 1`, D-082).
7. **Marcus, any time:** SnapPool still owes one real `/start` on production that shows `attribution`, `user_agent` and `page_url` filled (SnapPool's memory, 0e). SnapPool's memory should also note that the agent reads its payment columns (SNAPPOOL-TRACKING §2.1, §6): a rename there needs a change here.

## In flight
- Branch `m01a/live-acceptance` (draft PR #26): the dev live steps' results (F4, M01a–M06b). Branch `m06b/property-case` (PR #27, ready): the property case answered by Opus 5.5, plus the replay look-ups fix. PR [#25](https://github.com/marcustanforwork/agenticAdsManager/pull/25) (F4) squash-merged on Marcus's word, 2026-11-03.

## Blocked on Marcus
- M01a's prod steps 5–6 (at the SER9). M05a step 5's values; M06a's "trace seen"; M06b's rating of the property findings (PR #27). The fixtures (M02/M03 step 7) and M06b steps 2–4: after the first ads. The live steps M07, M08's and M09a's step 1, M09b's steps 1–3 and 5, M10a's (T10's database part), M10b's steps 1–4; T14's Meta part and the Meta spending limit.

## Live steps for Marcus
_M00 passed on 2026-11-03. The rest run after F4 merges (D-097), at the end of Phase 0 (D-074), in milestone order: first F4's grant, then M01a, M02, M03, M04, M05a, M05b, M06a, M06b, M07, then M08's step 1 and M09a's step 1, then M09b's steps 1–3 and 5, then M10a's (needs T10), then M10b's steps 1–4. The rest wait for the Phase 0 gate._

**F4** (PR #25 merged 2026-11-03; before M01a). Full text in the F4 milestone file:
1. `git pull` on `main`, `pnpm install`.
2. **Done 2026-11-03:** the purchases grant on SnapPool's production branch, checked as `ads_agent_ro` (`billing_subscriptions 6`, `deferred_event_charges 5`, `orders 9`, `refunds 6`).
3. At M05a's step 4 (`ads outcomes --product snappool`): `card_saved`, `paid` and `refunded` among the stages, no error (counts may be 0 until 2027-01-01). At M04 and M05a: no `ETIMEDOUT` reading SnapPool.

**M10b** (after M10a's; no migration; steps 1–4 during the gate, step 5 at phase 1). Full text in the M10b milestone file:
1. `https://ads.<your domain>/products/snappool/overview`: spend, projection, cost per signup by week, outcomes and attribution, accounts. Report "overview seen", and whether it matches that morning's digest.
2. Docs → STRATEGY: edit and save → **Done**, a new version "by web:…". Report "doc saved".
3. Briefs: choose yes / no for 👍 / 💡 on the latest brief → **Done**. Report "feedback saved".
4. Checks: the week's cycles, warnings, AI cost, drift. Report "checks seen".
5. At phase 1: review a week of proposals on the dashboard (approve / reject / edit; make approved ones by hand). Report the counts and "change log seen" (empty until Phase 2).

**M10a** (after M07's deploy; needs T10; migration `0007`). Full text in the M10a milestone file:
1. Migrate dev and prod (`0007`) → `migrations and roles.sql applied`.
2. With **SQL** in Neon (prod and the dev branch), not the console: `create role ads_dashboard login password '…'; grant agent_dashboard to ads_dashboard;` and check its only membership is `agent_dashboard` (query in the milestone file). Paste the result, not the password.
3. T10: a Cloudflare Access app for `ads.<your domain>` (only your email); note the AUD tag and team domain. **Done 2026-11-03** (`ads.snappool.photos`, team `marcus-ads`).
4. T10: a Vercel project, root `apps/web`, Standard Protection, the custom domain through Cloudflare; env: Production `DASHBOARD_DATABASE_URL` (prod, `ads_dashboard`, `-pooler` host), Preview `DASHBOARD_DEV_DATABASE_URL`; both `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`.
5. Doppler `worker`: add `web:<your email>` to `OPERATOR_ACTORS`; `docker compose up -d --build`.
6. `curl … https://<project>.vercel.app/` → `302` to Vercel's login (checked 2026-11-03); `https://ads.<your domain>` → Access sign-in, then "Products". Report "closed, signed in".
7. Configure SnapPool from the screens (ceilings, digest, test domains…); each save → **Done**; History shows "By web:…"; a 50% budget change → **Refused**. Report what you set.
8. The next morning's digest reflects the new ceilings: "digest OK".

**M09b** (after M07's deploy; no migration; steps 4 and 6 need phase 1). Full text in the M09b milestone file:
1. Deploy (`git pull`, `docker compose up -d --build`) → typing `/` in the bot chat shows the menu. Report "menu seen".
2. `/status` → phase, `snappool: ▶️ active`, `property-sg: 💤 dormant`. Paste it.
3. `/ceiling snappool daily <lower amount>` → `S$… → S$… (settings vN)`. Report "ceiling lowered".
4. A test ad set: `/pause <part of its name>` → ✅ Confirm → pause it by hand in Meta; `/changes snappool`, `/undo <id>` → turn it back on by hand. Report "pause and un-pause by hand OK".
5. `/halt snappool`, then `/resume_agent` the same day (halted = no cycle, no digest). Report "halt and resume OK".
6. A week at phase 1: decide the cards; try `/proposals`, `/brief`, `/drift`. Report days, approvals and rejections, "digests received".

**M09a** (step 1 with M07's deploy; the rest after the gate, with M08's). Full text in the M09a milestone file:
1. Migrate prod (`0006`: `telegram_conversations`) → `migrations and roles.sql applied`.
2. After a brief or a manual cycle at phase 1: one Telegram card per new proposal (change, before → after, evidence, words, expiry; Approve / Reject, and Edit for a negative or budget). Report how many and whether they read well.
3. Approve one ("Approved v1", card ✅) and make it by hand; reject one with a reason (card ❌); if a negative arrives, Edit with `match phrase` (card v2). Report "decided from Telegram".

**M08** (step 1 now, with M07's deploy; steps 2–6 after the Phase 0 gate passes). Full text in the M08 milestone file:
1. Migrate (`0005`: `eval_cases`, `analyst_runs`) on dev and prod; `… ads phase` → `{"phase": 0}`.
2. After the gate: `ads phase set 1 --note "Phase 0 gate passed: …"` → `"phase": 1`.
3. After Monday's brief (or a manual cycle): `ads proposals list --product snappool` → pending pauses / negatives with words. Report the count, actions, and whether the words read well.
4. For each: `ads proposals show <id> …`; make it by hand and `ads proposals approve <id> --version 1 …`, or `ads proposals reject <id> --reason "…" …`. Report "decisions recorded".
5. `ads eval replay --product snappool` → paste the JSON. 6. The next brief shows the agree rate: "agree rate seen".

**M07** (to do; last; **production** on the SER9: compose project `ads-agent`, Doppler `worker`/`gateway`; needs T7, T8). Full text in the M07 milestone file:
1. T7: create the BotFather bot and send it `/start`; in Doppler `worker`, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID` (your numeric id).
2. T8: create three healthchecks.io checks:
   - `worker-alive` and `gateway-alive`: every 10 min, 20 min grace;
   - `daily-sync`: cron `0 6 * * *`, Asia/Singapore, 3 h grace.

   Their URLs go in `HEALTHCHECK_WORKER_URL` and `HEALTHCHECK_DAILY_SYNC_URL` (Doppler `worker`) and `HEALTHCHECK_GATEWAY_URL` (Doppler `gateway`).
3. Production data: prod settings in Doppler `worker`; prod migrated; SnapPool's accounts linked with read credentials on prod; starting settings set.
4. Add a `.env` with `DOPPLER_TOKEN_WORKER` and `DOPPLER_TOKEN_GATEWAY`, then run `docker compose up -d --build` → both `healthy`; the log shows `startup reconciliation done` and `leader: starting …`; heartbeats are green.
5. Run `… exec worker ads-entrypoint ads cycle --product snappool --kind manual` → a brief arrives in Telegram. Press 👍 and 💡; `ads brief --product snappool` shows the feedback and the `writer`. Report "brief arrived" and the `writer`.
6. Leave it 7 days unattended, with one `docker compose restart` and one reboot. Expect a digest each morning SnapPool spends, none for property (dormant), and SnapPool's brief on Monday at 07:00 SGT. Report the days, the Monday brief, any alert, and "restart + reboot OK".

**M06b** (to do; after the M06a steps; no migration). Full text in the M06b milestone file:
1. `git pull` on `main`, `pnpm install`.
2. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads cycle --product snappool --kind manual --until analysed` → an `"analysed"` block with `"status": "analysed"`. Paste `status`, `usage.inputTokens`, `input.estimatedTokens`, `costMicros`, `lookups` and the `result` counts.
3. `… ads findings --product snappool` → check each finding's evidence against the ad accounts; paste type, target, verdict, `passedThreshold`.
4. Langfuse: trace `analyst:snappool` with its cost; say "trace seen".
5. Property case with the real model: `docker run -d --rm --name ads-eval-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16`, then `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres doppler run --config dev -- pnpm --silent --filter @ads/evals case:property --write`; read `packages/evals/cases/property-sg-0001.json` and say if the findings are useful on first read; `pnpm test`; push it on `m06b/property-case`; `docker stop ads-eval-pg`.

**M06a** (to do; after the M05b steps; needs T9 and `ANTHROPIC_API_KEY`). Full text in the M06a milestone file:
1. `git pull` on `main`, `pnpm install`; `doppler run --config dev -- pnpm --filter @ads/db db:migrate` (migration `0004`).
2. T9: a Langfuse project and keys; in Doppler `dev`: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `ANTHROPIC_API_KEY`.
3. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads model ping --product snappool` → `"traced": true`, a small `costMicros` (USD); a trace `analyst:snappool` in Langfuse. Paste the JSON, say "trace seen".
4. `… ads cycle --product snappool --kind manual --until detected` → a `"detected"` block. Paste each candidate's type, target and summary.

**M05b** (to do; after the M05a steps; no migration). Full text in the M05b milestone file:
1. `git pull` on `main`, `pnpm install`; `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads seed` → `"docsCreated"` 6 (or 0 if seeded already).
2. `… ads docs list --product snappool` → three documents at version 1 (edit: `ads docs get … > f.md`, then `ads docs set … --file f.md --base-version 1`).
3. `… ads cycle --product snappool --kind manual --until trust_checked` → an `"attribution"` block; `attribution_gap` and `id_capture` among the checks.
4. `… ads outcomes --product snappool` → `"attribution": {"ratePct": …, "byMethod": …}`. Paste the `attribution` block (counts only). Mostly `none` until T14 (the ad URL settings).

**M05a** (to do; after the M04 steps; needs T6a; Doppler `dev`, Neon dev branch). Full text in the M05a milestone file:
1. `git pull` on `main`, `pnpm install`; `doppler run --config dev -- pnpm --filter @ads/db db:migrate` (migration `0003`).
2. T6a: **done** (2026-10-28). The purchases grant: F4's step 2.
3. Add `cli:<your login name>` to `OPERATOR_ACTORS` in Doppler `dev`.
4. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads outcomes --product snappool` → `"read": {"outcome": "read", …}` and 30 days by stage. Paste the JSON (counts only).
5. `… ads settings set --product snappool --patch '{"testTraffic":{"emailDomains":["<your-domain>"]},"spend":{"monthlyCeilingMicros":"500000000","dailyCeilingMicros":"25000000"}}'` → `"status": "done"`, `"version": 2` (S$1 = `1000000`; your daily ceiling).
6. KPI switch: `--patch '{"outcomes":{"primaryKpiStage":"paid"}}'`, then `… ads outcomes --product snappool --no-read` → `"kpiStage": "paid"`; switch back to `signup`. Report "KPI switch OK".

**M04** (to do; needs the M01a, M02 and M03 steps, and since M05a `SNAPPOOL_DATABASE_URL` (T6a) in Doppler `dev`; Neon dev branch, read credentials only). Full text in the M04 milestone file:
1. `git pull` on `main`, `pnpm install`; `doppler run --config dev -- pnpm --filter @ads/db db:migrate` (adds the accounts' sync columns).
2. Day 1: `time doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads cycle --product snappool --kind daily --until trust_checked` → `"outcome": "stopped"` at `trust_checked`, each account `"synced"`, `"trustResult"` `ok` or `degraded` (`degraded` while the Meta limit is unset or 80%+ used). Paste the JSON (counts only) and the time.
3. Day 2: the same command → a new cycle; few snapshots, `"drift": 0` unless something changed by hand. Paste the JSON.
4. Restart check with the dev stack: `docker compose -p ads-agent-dev exec worker ads-entrypoint ads cycle --product snappool --kind daily`, and during its sync `docker compose -p ads-agent-dev restart worker` → the worker logs `"startup reconciliation done"` with `"cyclesResumed": 1` and the cycle finishes; step 2's command then prints `"already_finished"`.

**M03** (to do; needs T5 (service accounts, D-071), the M01a steps 1–4 and M02's step 2; Doppler `dev`, Neon dev branch, read credential only). Full text in the M03 milestone file:
1. `git pull` on `main`, `pnpm install`; `doppler run --config dev -- pnpm --filter @ads/db db:migrate` (adds `accounts.login_customer_id`).
2. Key file outside the repo: `~/google-read.json` (the `ads-agent-read` service account's key file), `chmod 600`.
3. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads accounts link --product snappool --platform google --account <client id> --manager <manager id>`
4. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads credentials put --account google:<client id> --role read < ~/google-read.json`
5. `time doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads sync --product snappool --platform google --dry` → `"outcome": "read"`, `"requests"` under 200, under 1 min. Paste the JSON (counts only) and the time.
6. `RECORD=1 GOOGLE_CREDENTIAL=~/google-read.json pnpm --filter @ads/connector-google record --account <client id> --manager <manager id>`, then `pnpm test`, then push `recorded/` on a branch `m03/recorded-fixtures` and tell Claude.
7. `rm ~/google-read.json`.

**M02** (to do; needs T4 read side and the M01a steps 1–4; uses Doppler `dev` and the Neon dev branch; read token only). Full text in the M02 milestone file:
1. `git pull` on `main`, `pnpm install`.
2. `echo "read-v1:$(openssl rand -base64 32)"` → paste into Doppler `dev` as `VAULT_READ_KEY`.
3. Token file outside the repo: `~/meta-read.json` = `{ "accessToken": "…", "appSecret": "…" }`, `chmod 600`.
4. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads accounts link --product snappool --platform meta --account act_<id>`
5. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads credentials put --account meta:act_<id> --role read < ~/meta-read.json`
6. `time doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads sync --product snappool --platform meta --dry` → `"outcome": "read"`, under 1 min. Paste the JSON (counts only) and the time.
7. `RECORD=1 META_CREDENTIAL=~/meta-read.json pnpm --filter @ads/connector-meta record --account act_<id> --dataset <id> --events CompleteRegistration`, then `pnpm test`, then push the `recorded/` files on a branch `m02/recorded-fixtures` and tell Claude.
8. If property-sg has a Meta account: link it, `set-status … --status paused`, dry sync property-sg → `skipped`.
9. `rm ~/meta-read.json`.

**M01a** (to do; needs T2 + T3). Use the Neon **owner** connection strings, **direct** host (no `-pooler`):
1. `git pull` on `main`, then `pnpm install`.
2. Add `DATABASE_URL` (Neon **dev** branch, owner) to Doppler's `dev` config.
3. `doppler run --config dev -- pnpm --filter @ads/db db:migrate` (twice) → `migrations and roles.sql applied` both times.
4. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads seed` → `{"productsCreated":["snappool","property-sg"],...}` (was `db:seed`, D-076).
5. Prod: `read -rs DATABASE_URL && export DATABASE_URL` (paste the **prod** owner string), then `pnpm --filter @ads/db db:migrate && pnpm --silent --filter @ads/app-worker ads seed && unset DATABASE_URL`.
6. Neon SQL editor on prod: `select slug, status, settings_version from products order by slug; select key, value from system_flags;` → `property-sg dormant 1`, `snappool active 1`, `writes_enabled false`.
7. Report "migrated and seeded", or paste the error.


## Deployed
- Ads Agent: nothing yet.
- **SnapPool tracking (T6b): live on production since 2026-09-25 17:01 UTC** (SnapPool Session 41, its PR #108; migration `0032` adds `pool_requests.attribution`, `user_agent`, `page_url`). Attribution data starts then. Until T14 (the ad URL settings) is done, only Meta's `fbclid` arrives.

## Milestone tracker (one row = one session)
| M | Title | Ph | Status | PR | Notes |
|---|---|---|---|---|---|
| M00 | Scaffold, contracts, boundaries, CI | 0 | **done** | [#3](https://github.com/marcustanforwork/agenticAdsManager/pull/3) (merged) | Live: compose up/stop on the SER9 passed 2026-11-03 |
| M01a | Database schema and repositories | 0 | **awaiting live acceptance** | [#4](https://github.com/marcustanforwork/agenticAdsManager/pull/4) (merged) | Live: dev passed 2026-11-03; prod (steps 5–6) to do, Marcus at the SER9 |
| M01b | Queue, leader lock, vault, request processor | 0 | **done** | [#5](https://github.com/marcustanforwork/agenticAdsManager/pull/5) (merged) | No live steps; tokens are loaded in M02/M03 |
| M02 | Meta read connector | 0 | **awaiting live acceptance** | [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6) (merged) | Dry sync passed 2026-11-03 (6.9 s); fixtures after the first Meta ad (the account is empty) |
| M03 | Google read connector | 0 | **awaiting live acceptance** | [#7](https://github.com/marcustanforwork/agenticAdsManager/pull/7) (merged) | Dry sync passed 2026-11-03 (11.9 s, 13 requests) after Explorer (D-100) and the manager link; fixtures after the first Google ad |
| M04 | Sync, drift, trust checks | 0 | **awaiting live acceptance** | [#8](https://github.com/marcustanforwork/agenticAdsManager/pull/8) (merged) | Day 1 passed 2026-11-03; day 2 and the restart check from 2026-11-04 |
| M05a | Pack SDK, SnapPool pack, settings | 0 | **awaiting live acceptance** | [#9](https://github.com/marcustanforwork/agenticAdsManager/pull/9) (merged) | Outcomes passed 2026-11-03; starting settings and the KPI switch wait for Marcus's values |
| M05b | Property pack (G8), attribution, product docs | 0 | **done** | [#10](https://github.com/marcustanforwork/agenticAdsManager/pull/10) (merged) | G8 passed; live passed 2026-11-03 (docs, a cycle, attribution 0% until ads and T14) |
| M06a | AI layer, finding registry, detectors | 0 | **awaiting live acceptance** | [#11](https://github.com/marcustanforwork/agenticAdsManager/pull/11) (merged) | Detect passed 2026-11-03 (0 candidates: empty accounts); model ping traced, "trace seen" for Marcus |
| M06b | Analyst input, look-ups, analyse stage | 0 | **awaiting live acceptance** | [#12](https://github.com/marcustanforwork/agenticAdsManager/pull/12) (merged) | Property case with Opus 5.5 done (PR #27, Marcus rates it); the analysed cycle waits for the first ads |
| M07 | Digest, brief, services (Phase 0 exit) | 0 | **awaiting live acceptance** | [#13](https://github.com/marcustanforwork/agenticAdsManager/pull/13) (merged) | Live: deploy on the SER9, 7 days unattended (needs T7, T8) |
| M08 | Draft stage, proposals, replay v0 | 1 | **awaiting live acceptance** | [#14](https://github.com/marcustanforwork/agenticAdsManager/pull/14) (merged) | Built before the gate (D-082); live: migrate now, the rest after the gate |
| M09a | Telegram bot core and proposal cards | 1 | **awaiting live acceptance** | [#15](https://github.com/marcustanforwork/agenticAdsManager/pull/15) (merged) | Built before the gate (D-084); live: migrate now, cards after the gate |
| M09b | Telegram operator commands | 1 | **awaiting live acceptance** | [#17](https://github.com/marcustanforwork/agenticAdsManager/pull/17) (merged) | Built before the gate (D-086); live: a week run from Telegram |
| M10a | Dashboard: app, sign-in, settings | 1 | **awaiting live acceptance** | [#18](https://github.com/marcustanforwork/agenticAdsManager/pull/18) (merged) | Built before the gate (D-088); live: deploy behind Access, configure SnapPool (needs T10) |
| M10b | Dashboard: review views | 1 | **awaiting live acceptance** | [#20](https://github.com/marcustanforwork/agenticAdsManager/pull/20) (merged) | Built before the gate (D-090); live: the screens on real data; a week of proposals at phase 1 |
| F1 | Fix: wording and feedback (D-092) | fix | **done** (merged) | [#22](https://github.com/marcustanforwork/agenticAdsManager/pull/22) (merged) | Live checks fold into M07's and M10b's |
| F2 | Fix: request processor, shared formatting | fix | **done** (merged) | [#23](https://github.com/marcustanforwork/agenticAdsManager/pull/23) (merged) | Migration `0008` with the others |
| F3 | Fix: pre-live rehearsal | fix | **done** (merged) | [#24](https://github.com/marcustanforwork/agenticAdsManager/pull/24) (merged) | The first live weekend follows its checked steps |
| F4 | Fix: CI, SnapPool connection, purchases, AI cost limit (D-097) | fix | **awaiting live acceptance** (merged 2026-11-03) | [#25](https://github.com/marcustanforwork/agenticAdsManager/pull/25) | Live: the purchases grant, before M01a. Item 4 cut → F5 (D-099) |
| F5 | Fix: the AI cost soft limit (D-099) | fix | not started | — | After M01a's live steps (Marcus, 2026-11-03). Moved from F4; can't be cut again |
| M11a | Gateway rules: allowlist, guards, fingerprint | 2 | not started | — | Phase 1 gate |
| M11b | Gateway pipeline, recovery, undo, service | 2 | not started | — | |
| M12 | Meta writes + CAPI | 2 | not started | — | T4 (write side); T6b |
| M13 | Google writes + Data Manager (Phase 2 exit) | 2 | not started | — | T5, T11; T6b |
| M14 | Budgets, creates, pacing | 3 | not started | — | Phase 2 gate |
| M15a | Source copy and claim checks | 4 | not started | — | Phase 3 gate; T13 |
| M15b | Format checks, variants, proposals | 4 | not started | — | |
| M16a | Evals and the model-swap gate | 5 | not started | — | |
| M16b | Ops hardening: runbook, backups, doctor | 5 | not started | — | |

## Phase gates (PROPOSAL §12)
| Gate | Condition, in short | Status |
|---|---|---|
| 0 → 1 | Brief useful and new in 2 of the first 4 weeks; property pack added with zero core changes | **waiting for M07's live run** (then measuring for 4 weeks: the 👍 / 💡 buttons on each brief, stored in `briefs`; G8 already passed in M05b) |
| 1 → 2 | ≥ 70% agree over 3 weeks, with ≥ 15 agent proposals | not started (all Phase 1 milestones are built; measuring starts at phase 1, after the Phase 0 gate; the Proposals screen shows the agree rate over 21 days) |
| 2 → 3 | ≥ 20 live changes, 0 wrong, 0 unexplained verify failures, 1 undo drill | not started |
| 3 → 4 | 4 weeks: no guard bypass, no wrong budget change, no ceiling breach caused by the agent | not started |
| 4 → 5 | Variants pass the checks; a dropped required string is always blocked | not started |
