# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-10-19 · cloud session · **M10a squash-merged into `main` through PR [#18](https://github.com/marcustanforwork/agenticAdsManager/pull/18)** on Marcus's instruction, after every check passed (D-057). **D-090 (Marcus):** M10b is built next. **Q13 answered: service accounts (D-071).**, ahead of the Phase 0 gate; **M11a onwards (the gateway) wait for the gate.** Marcus plans the Phase 0 setup for the weekend of 2026-10-24. His to-do list is the artifact **[Phase 0 Live Checklist](https://claude.ai/artifact/12LGui2vrbD3b2yxrrao4f)** (no ticks yet on 2026-10-19; read them with `ArtifactData` `list`, collection `progress`). SnapPool's tracking change (T6b) has been live since 2026-09-25.

## Where we are
- **Phase:** 0.
- **Active milestones:** **M10b** (`docs/milestones/M10b-dashboard-review-views.md`, **in progress**, started 2026-10-19): review views per product (overview with spend and projection, KPI trend, outcomes and attribution, accounts; proposals with approve / reject / edit; change log with undo requests; trust checks, drift, AI cost; briefs with feedback; product docs). **M10a** (`docs/milestones/M10a-dashboard-app-signin-settings.md`, merged in PR #18; **awaiting live acceptance** after M07's deploy and T10): a Next.js 16 dashboard behind Cloudflare Access (fail closed: no valid token = 401), settings screens per product (spending and digest, trust, outcomes and feedback routes, copy, test traffic, guards, status), settings history, a fact editor built from each pack's published schema; every change is an operator request the worker checks and answers within seconds. **M09b** (`docs/milestones/M09b-telegram-operator-commands.md`, merged in PR #17; awaiting live acceptance after M07's deploy and the gate): `/pause` and `/pause_all` confirm cards (the confirm tap is the approval), `/undo`, `/changes`, `/halt`, `/resume_agent`, `/status`, `/proposals`, `/brief`, `/drift`, `/ceiling`, `/digest`, `/budget` (Phase 3). **M09a** (`docs/milestones/M09a-telegram-bot-cards.md`, awaiting live acceptance after M07's deploy and the gate): Telegram proposal cards, conversation state in the DB, `edit_approve`, alerts. **M07** (Phase 0 exit) and **M08** (draft stage, proposals, replay v0), both **awaiting live acceptance**.
- **D-082 (Marcus, 2026-10-13):** M08 is built before the Phase 0 gate. The stored phase (`system_flags.phase`) is 0, so nothing is drafted on production; Marcus sets phase 1 (`ads phase set 1 --note …`) when he records the gate as passed. **D-084 (Marcus, 2026-10-14):** M09a is built before the gate too. **D-086 (Marcus, 2026-10-19):** so is M09b. **D-088 (Marcus, 2026-10-19):** so is M10a. **D-090 (Marcus, 2026-10-19):** so is M10b; **M11a onwards still wait for the gate.**
- **M00–M07** are merged; all but M01b await live acceptance (below).
- **Status:** BLUEPRINT v3.28, PROPOSAL v3.10. **D-089:** M10a build choices (Next.js 16 `proxy.ts` + jose; only production reads the production DB URL; `inserted_by` = `current_user`, and a role inheriting `agent_dashboard` is never trusted; NOTIFY + 30 s poll; `set_product_status`; an unchanged patch makes no version; the fact editor checks against the published schema). **D-087:** M09b build choices (one command table; operator pauses as proposals with a 30-minute expiry; Confirm / Cancel on the card verbs; `/pause_all` = active campaigns, one card; entity resolution never guesses; Phase 1 undo shows the undo; quick settings via `settings_patch`). **D-085:** M09a build choices (cards queued with each proposal; callback data; `telegram_conversations`; `edit_approve` keeps the precondition; the edit grammar; alert routing). **D-083:** M08 build choices (pauses and negatives proposed from phase 1; drafting rules; planned undo and fingerprint at draft time; eval cases and `analyst_runs`; the agree rate). **D-081:** M07 build choices (a daily cycle no longer analyses; reports cover the days before the cycle's date; the brief's AI writes prose only, with every number checked, sign included; the outbox and worker service). **D-080:** M06b build choices (analyst targets as `FindingTargetRef`; the input, look-ups and validation; the analyst may add only `zero_outcome_spend`, `wasteful_search_term`, `no_delivery`, and only when their rule holds; replay case v0). **D-079:** M06a build choices. **D-078:** AI SDK 7 + Langfuse. **Q13 answered (2026-10-19): Google service accounts (D-071).** No open questions. D-069 to D-077: earlier build choices (see DECISIONS).
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens (BLUEPRINT §9).

## Next action
1. **Marcus:** work through the [Phase 0 Live Checklist](https://claude.ai/artifact/12LGui2vrbD3b2yxrrao4f), in its order (same content as below):
   - do the setup tasks: T1's optional part, then T2–T9 (T7 Telegram and T8 healthchecks are M07's), then the rest as the milestones need them;
   - run the live steps below in milestone order, M00 → M07, then M08's step 1 (migration `0005`; nothing visible changes); M07's live steps deploy to production on the SER9.
2. **Phase 0 gate (4 weeks, PROPOSAL §12):** starts once M07 runs live. Press 👍 / 💡 on each weekly brief. When it passes, Marcus records it and sets phase 1 (`ads phase set 1`, D-082); M08's live steps and the Phase 1 measuring start then.
3. **Claude (next session, fresh context):** `start-session`, then `start-milestone` for **M10b** (dashboard review views, D-090). Also check the checklist's ticks (`ArtifactData` `list`, collection `progress`) and record any live-step results.
4. **Marcus, this weekend:** the Phase 0 setup (his plan, 2026-10-19). For T5, create the two Google service accounts (D-071).
5. **Marcus, any time:** SnapPool still owes one real `/start` on production that shows `attribution`, `user_agent` and `page_url` filled (SnapPool's memory, 0e).
6. **Before 2026-10-27:** nothing to do. Meta's v26 changes apply to all versions then; the client already avoids them (GOTCHAS).

## In flight
- **M10b** on branch `claude/elegant-goodall-ursfd8` (started 2026-10-19). Next: Build 1, the dashboard's reads in `packages/db/src/repos/dashboard.ts`.

## Blocked on Marcus
- Nothing blocks the builds (D-074).
- Now (the end of Phase 0): setup tasks T1 (optional part), T2–T14 (T6b is already live); then the live steps of M00 through M07, M08's and M09a's step 1, M09b's steps 1–3 and 5, and M10a's (needs T10).

## Live steps for Marcus
_All of these run now, at the end of Phase 0 (D-074), in milestone order: M00, M01a, M02, M03, M04, M05a, M05b, M06a, M06b, M07, then M08's step 1 and M09a's step 1, then M09b's steps 1–3 and 5, then M10a's (needs T10). The rest wait for the Phase 0 gate._

**M10a** (after M07's deploy; needs T10; migration `0007`). Full text in the M10a milestone file:
1. Migrate dev and prod (`0007`) → `migrations and roles.sql applied`.
2. With **SQL** in Neon (prod and the dev branch), not the console: `create role ads_dashboard login password '…'; grant agent_dashboard to ads_dashboard;` and check its only membership is `agent_dashboard` (query in the milestone file). Paste the result, not the password.
3. T10: a Cloudflare Access app for `ads.<your domain>` (only your email); note the AUD tag and team domain.
4. T10: a Vercel project, root `apps/web`, Standard Protection, the custom domain through Cloudflare; env: Production `DASHBOARD_DATABASE_URL` (prod, `ads_dashboard`, `-pooler` host), Preview `DASHBOARD_DEV_DATABASE_URL`; both `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`.
5. Doppler `worker`: add `web:<your email>` to `OPERATOR_ACTORS`; `docker compose up -d --build`.
6. `curl … https://<project>.vercel.app/` → `401`; `https://ads.<your domain>` → Access sign-in, then "Products". Report "401 seen, signed in".
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
2. T6a: a read-only role on SnapPool's Neon (`ads_agent_ro`: `grant select on pool_requests, hosts, events`, `default_transaction_read_only = on`); its connection string in Doppler `dev` as `SNAPPOOL_DATABASE_URL`.
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

**M00** (SER9, no secrets): `docker compose -p ads-agent-dev up --build` → two `"msg":"ready"` lines; `ps` → both `healthy`; `stop` → `"msg":"stopped"`, exit 0; `down`. Full steps in the M00 milestone file.

## Deployed
- Ads Agent: nothing yet.
- **SnapPool tracking (T6b): live on production since 2026-09-25 17:01 UTC** (SnapPool Session 41, its PR #108; migration `0032` adds `pool_requests.attribution`, `user_agent`, `page_url`). Attribution data starts then. Until T14 (the ad URL settings) is done, only Meta's `fbclid` arrives.

## Milestone tracker (one row = one session)
| M | Title | Ph | Status | PR | Notes |
|---|---|---|---|---|---|
| M00 | Scaffold, contracts, boundaries, CI | 0 | **awaiting live acceptance** | [#3](https://github.com/marcustanforwork/agenticAdsManager/pull/3) (merged) | Live: compose up/stop on the SER9 (to do) |
| M01a | Database schema and repositories | 0 | **awaiting live acceptance** | [#4](https://github.com/marcustanforwork/agenticAdsManager/pull/4) (merged) | Live: Neon migrate + seed (to do; needs T2, T3) |
| M01b | Queue, leader lock, vault, request processor | 0 | **done** | [#5](https://github.com/marcustanforwork/agenticAdsManager/pull/5) (merged) | No live steps; tokens are loaded in M02/M03 |
| M02 | Meta read connector | 0 | **awaiting live acceptance** | [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6) (merged) | Live: link, dry sync, record fixtures (to do; needs T4 read side, M01a) |
| M03 | Google read connector | 0 | **awaiting live acceptance** | [#7](https://github.com/marcustanforwork/agenticAdsManager/pull/7) (merged) | Live: link, dry sync, record fixtures (to do; needs T5 (service accounts), M01a) |
| M04 | Sync, drift, trust checks | 0 | **awaiting live acceptance** | [#8](https://github.com/marcustanforwork/agenticAdsManager/pull/8) (merged) | Live: two daily cycles + a restart (to do; after M03's steps) |
| M05a | Pack SDK, SnapPool pack, settings | 0 | **awaiting live acceptance** | [#9](https://github.com/marcustanforwork/agenticAdsManager/pull/9) (merged) | Live: outcomes, starting settings, KPI switch (to do; needs T6a) |
| M05b | Property pack (G8), attribution, product docs | 0 | **awaiting live acceptance** | [#10](https://github.com/marcustanforwork/agenticAdsManager/pull/10) (merged) | G8 passed; live: docs seeded, attribution rate (needs T6a; real ids need T14) |
| M06a | AI layer, finding registry, detectors | 0 | **awaiting live acceptance** | [#11](https://github.com/marcustanforwork/agenticAdsManager/pull/11) (merged) | Live: model ping + trace, detect on real data (needs T9, `ANTHROPIC_API_KEY`) |
| M06b | Analyst input, look-ups, analyse stage | 0 | **awaiting live acceptance** | [#12](https://github.com/marcustanforwork/agenticAdsManager/pull/12) (merged) | Live: analysed cycle, findings, trace, property case with the real model |
| M07 | Digest, brief, services (Phase 0 exit) | 0 | **awaiting live acceptance** | [#13](https://github.com/marcustanforwork/agenticAdsManager/pull/13) (merged) | Live: deploy on the SER9, 7 days unattended (needs T7, T8) |
| M08 | Draft stage, proposals, replay v0 | 1 | **awaiting live acceptance** | [#14](https://github.com/marcustanforwork/agenticAdsManager/pull/14) (merged) | Built before the gate (D-082); live: migrate now, the rest after the gate |
| M09a | Telegram bot core and proposal cards | 1 | **awaiting live acceptance** | [#15](https://github.com/marcustanforwork/agenticAdsManager/pull/15) (merged) | Built before the gate (D-084); live: migrate now, cards after the gate |
| M09b | Telegram operator commands | 1 | **awaiting live acceptance** | [#17](https://github.com/marcustanforwork/agenticAdsManager/pull/17) (merged) | Built before the gate (D-086); live: a week run from Telegram |
| M10a | Dashboard: app, sign-in, settings | 1 | **awaiting live acceptance** | [#18](https://github.com/marcustanforwork/agenticAdsManager/pull/18) (merged) | Built before the gate (D-088); live: deploy behind Access, configure SnapPool (needs T10) |
| M10b | Dashboard: review views | 1 | **in progress** | — | Built before the gate (D-090) |
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
| 1 → 2 | ≥ 70% agree over 3 weeks, with ≥ 15 agent proposals | not started |
| 2 → 3 | ≥ 20 live changes, 0 wrong, 0 unexplained verify failures, 1 undo drill | not started |
| 3 → 4 | 4 weeks: no guard bypass, no wrong budget change, no ceiling breach caused by the agent | not started |
| 4 → 5 | Variants pass the checks; a dropped required string is always blocked | not started |
