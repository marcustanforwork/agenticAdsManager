# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-10-13 · cloud session · **M08 squash-merged into `main` through PR [#14](https://github.com/marcustanforwork/agenticAdsManager/pull/14)** on Marcus's instruction, after every check passed (D-057). M08 was built ahead of the Phase 0 gate (D-082). Marcus's Phase 0 to-do list is the artifact **[Phase 0 Live Checklist](https://claude.ai/artifact/12LGui2vrbD3b2yxrrao4f)** (his ticks are in its `progress` collection: read them with `ArtifactData` `list`). SnapPool's tracking change (T6b) has been live since 2026-09-25.

## Where we are
- **Phase:** 0.
- **Active milestones:** **M07** (Phase 0 exit) and **M08** (draft stage, proposals, replay v0), both **awaiting live acceptance**. M08 (`docs/milestones/M08-draft-proposals-replay.md`): weekly and manual cycles draft proposals from confirmed findings, with exact action, planned undo, fingerprint and expiry; the AI writes only the words (number-checked); `ads proposals`, `ads phase`, `ads eval replay`; the agree rate in the brief.
- **D-082 (Marcus, 2026-10-13):** M08 is built before the Phase 0 gate. The stored phase (`system_flags.phase`) is 0, so nothing is drafted on production; Marcus sets phase 1 (`ads phase set 1 --note …`) when he records the gate as passed. **M09a onwards still wait for the gate.**
- **M00–M07** are merged; all but M01b await live acceptance (below).
- **Status:** BLUEPRINT v3.21, PROPOSAL v3.9. **D-083:** M08 build choices (pauses and negatives proposed from phase 1; drafting rules; planned undo and fingerprint at draft time; eval cases and `analyst_runs`; the agree rate). **D-081:** M07 build choices (a daily cycle no longer analyses; reports cover the days before the cycle's date; the brief's AI writes prose only, with every number checked, sign included; the outbox and worker service). **D-080:** M06b build choices (analyst targets as `FindingTargetRef`; the input, look-ups and validation; the analyst may add only `zero_outcome_spend`, `wasteful_search_term`, `no_delivery`, and only when their rule holds; replay case v0). **D-079:** M06a build choices. **D-078:** AI SDK 7 + Langfuse. **Open: Q13** (Google service accounts vs logins; can wait for the setup, D-074). D-069 to D-077: earlier build choices (see DECISIONS).
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens (BLUEPRINT §9).

## Next action
1. **Marcus:** work through the [Phase 0 Live Checklist](https://claude.ai/artifact/12LGui2vrbD3b2yxrrao4f), in its order (same content as below):
   - answer Q13;
   - do the setup tasks: T1's optional part, then T2–T9 (T7 Telegram and T8 healthchecks are M07's), then the rest as the milestones need them;
   - run the live steps below in milestone order, M00 → M07, then M08's step 1 (migration `0005`; nothing visible changes); M07's live steps deploy to production on the SER9.
2. **Phase 0 gate (4 weeks, PROPOSAL §12):** starts once M07 runs live. Press 👍 / 💡 on each weekly brief. When it passes, Marcus records it and sets phase 1 (`ads phase set 1`, D-082); M08's live steps and the Phase 1 measuring start then.
3. **Claude (next session):** read the checklist's ticks (`ArtifactData` `list`, collection `progress`), record live-step results in the milestone files and fix what they find. No new milestone until the gate passes (M09a needs it), unless Marcus says otherwise.
4. **Marcus, any time:** SnapPool still owes one real `/start` on production that shows `attribution`, `user_agent` and `page_url` filled (SnapPool's memory, 0e).
5. **Before 2026-10-27:** nothing to do. Meta's v26 changes apply to all versions then; the client already avoids them (GOTCHAS).

## In flight
- Nothing. PR [#14](https://github.com/marcustanforwork/agenticAdsManager/pull/14) (M08) was squash-merged into `main` on 2026-10-13.

## Blocked on Marcus
- Nothing blocks the builds (D-074).
- Now (the end of Phase 0): Q13; setup tasks T1 (optional part), T2–T14 (T6b is already live); then the live steps of M00 through M07, and M08's step 1.

## Live steps for Marcus
_All of these run now, at the end of Phase 0 (D-074), in milestone order: M00, M01a, M02, M03, M04, M05a, M05b, M06a, M06b, M07, then M08's step 1. M08's other steps wait for the Phase 0 gate._

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

**M03** (to do; needs T5, your Q13 answer, the M01a steps 1–4 and M02's step 2; Doppler `dev`, Neon dev branch, read credential only). Full text in the M03 milestone file:
1. `git pull` on `main`, `pnpm install`; `doppler run --config dev -- pnpm --filter @ads/db db:migrate` (adds `accounts.login_customer_id`).
2. Key file outside the repo: `~/google-read.json` (the Read only service account's key; or `{ "type": "authorized_user", … }` if Q13 = B), `chmod 600`.
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
| M03 | Google read connector | 0 | **awaiting live acceptance** | [#7](https://github.com/marcustanforwork/agenticAdsManager/pull/7) (merged) | Live: link, dry sync, record fixtures (to do; needs T5, Q13, M01a) |
| M04 | Sync, drift, trust checks | 0 | **awaiting live acceptance** | [#8](https://github.com/marcustanforwork/agenticAdsManager/pull/8) (merged) | Live: two daily cycles + a restart (to do; after M03's steps) |
| M05a | Pack SDK, SnapPool pack, settings | 0 | **awaiting live acceptance** | [#9](https://github.com/marcustanforwork/agenticAdsManager/pull/9) (merged) | Live: outcomes, starting settings, KPI switch (to do; needs T6a) |
| M05b | Property pack (G8), attribution, product docs | 0 | **awaiting live acceptance** | [#10](https://github.com/marcustanforwork/agenticAdsManager/pull/10) (merged) | G8 passed; live: docs seeded, attribution rate (needs T6a; real ids need T14) |
| M06a | AI layer, finding registry, detectors | 0 | **awaiting live acceptance** | [#11](https://github.com/marcustanforwork/agenticAdsManager/pull/11) (merged) | Live: model ping + trace, detect on real data (needs T9, `ANTHROPIC_API_KEY`) |
| M06b | Analyst input, look-ups, analyse stage | 0 | **awaiting live acceptance** | [#12](https://github.com/marcustanforwork/agenticAdsManager/pull/12) (merged) | Live: analysed cycle, findings, trace, property case with the real model |
| M07 | Digest, brief, services (Phase 0 exit) | 0 | **awaiting live acceptance** | [#13](https://github.com/marcustanforwork/agenticAdsManager/pull/13) (merged) | Live: deploy on the SER9, 7 days unattended (needs T7, T8) |
| M08 | Draft stage, proposals, replay v0 | 1 | **awaiting live acceptance** | [#14](https://github.com/marcustanforwork/agenticAdsManager/pull/14) (merged) | Built before the gate (D-082); live: migrate now, the rest after the gate |
| M09a | Telegram bot core and proposal cards | 1 | not started | — | |
| M09b | Telegram operator commands | 1 | not started | — | |
| M10a | Dashboard: app, sign-in, settings | 1 | not started | — | T10 (Vercel Pro, Cloudflare) |
| M10b | Dashboard: review views | 1 | not started | — | |
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
