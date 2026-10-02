# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-10-02 · cloud session · branch `claude/gifted-franklin-hk0fku` · PR [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6) (M02, ready for review). Marcus confirmed M01b complete; the M00/M01a live steps aren't done yet and stay unticked. Later the same day: Marcus created the Google manager account (T5) and found that Google no longer issues developer tokens (D-070); **Q13 asked**.

## Where we are
- **Phase:** 0.
- **Active milestone:** **M02 (Meta read connector): built, awaiting live acceptance.** Cloud work done: Graph client, read methods, `connector-testing`, `ads sync --dry`, `ads accounts`, the recorder. Details: `docs/milestones/M02-meta-read.md`.
- **M01a** and **M00** are merged and still awaiting their live acceptance (below).
- **Status:** BLUEPRINT v3.10, PROPOSAL v3.6. **Open: Q13** (Google service accounts vs logins). **D-069:** M02 build choices (Graph API v26.0; link clicks; KPI-stage conversions; at most a 60 s rate-limit wait; `ads accounts`). **D-070:** Google API access now comes from the Cloud project; no developer token. **D-071 (proposed):** two Google service accounts instead of two logins. **D-072:** the Google connector calls the REST API with its own `fetch` client (the `google-ads-api` library is dropped).
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens (BLUEPRINT §9).

## Next action
1. **Marcus:** review PR [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6) (CI green on 2026-10-02); merge only on his word (D-057). M02's live steps don't block the merge.
2. **Marcus:** answer **Q13**, then continue T5 as rewritten (`PROPOSAL.md` §16): the manager account is **done** (2026-10-02); next, a Google Cloud project with the Google Ads API enabled (no developer token), the SnapPool ad account under the manager account, and the agent's two identities per Q13.
3. **Claude (next session: clean context, Opus 5.5, medium effort):** `start-milestone` for **M03** (Google read connector); it doesn't wait for Q13 (the identity type only changes the auth step). Reuse `@ads/connector-testing` and copy M02's fixture layout (M02 "Leave behind"). Cloud: if the assigned branch's PR is merged, reset it to `origin/main` first (`start-session` §2).
4. **Marcus, when T4 (read side) and the M01a steps 1–4 are done:** the M02 live steps (below).
5. **Marcus, when T2 and T3 are done:** the M01a live steps (below). **When at the SER9:** the M00 live steps.
6. **Marcus:** the SnapPool tracking change (T6b, prompt in `SNAPPOOL-TRACKING.md` §7); setup tasks T2–T5, T6a (`PROPOSAL.md` §16); optional part of T1 (require `memory-check`, `ci`, `secret-scan` in the `main` ruleset).
7. **Before 2026-10-27:** nothing to do. Meta's v26 changes apply to all versions then; the client already avoids them (GOTCHAS).

## In flight
- PR [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6): M02, branch `claude/gifted-franklin-hk0fku`, ready for review.

## Blocked on Marcus
- **Q13:** Google service accounts (recommended) or Google logins.
- Live steps: M02 (needs T4 read side + M01a), M01a (needs T2, T3), M00 (SER9). Setup tasks T1 (optional part), T2–T14; T6b.

## Live steps for Marcus
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
4. `doppler run --config dev -- pnpm --filter @ads/db db:seed` → `{"productsCreated":["snappool","property-sg"],...}`.
5. Prod: `read -rs DATABASE_URL && export DATABASE_URL` (paste the **prod** owner string), then `pnpm --filter @ads/db db:migrate && pnpm --filter @ads/db db:seed && unset DATABASE_URL`.
6. Neon SQL editor on prod: `select slug, status, settings_version from products order by slug; select key, value from system_flags;` → `property-sg dormant 1`, `snappool active 1`, `writes_enabled false`.
7. Report "migrated and seeded", or paste the error.

**M00** (SER9, no secrets): `docker compose -p ads-agent-dev up --build` → two `"msg":"ready"` lines; `ps` → both `healthy`; `stop` → `"msg":"stopped"`, exit 0; `down`. Full steps in the M00 milestone file.

## Deployed
- Ads Agent: nothing yet.
- SnapPool tracking (T6b): not built yet. Record its go-live date here; attribution data starts then.

## Milestone tracker (one row = one session)
| M | Title | Ph | Status | PR | Notes |
|---|---|---|---|---|---|
| M00 | Scaffold, contracts, boundaries, CI | 0 | **awaiting live acceptance** | [#3](https://github.com/marcustanforwork/agenticAdsManager/pull/3) (merged) | Live: compose up/stop on the SER9 (to do) |
| M01a | Database schema and repositories | 0 | **awaiting live acceptance** | [#4](https://github.com/marcustanforwork/agenticAdsManager/pull/4) (merged) | Live: Neon migrate + seed (to do; needs T2, T3) |
| M01b | Queue, leader lock, vault, request processor | 0 | **done** | [#5](https://github.com/marcustanforwork/agenticAdsManager/pull/5) (merged) | No live steps; tokens are loaded in M02/M03 |
| M02 | Meta read connector | 0 | **awaiting live acceptance** | [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6) | Live: link, dry sync, record fixtures (to do; needs T4 read side, M01a) |
| M03 | Google read connector | 0 | **next** | — | T5 for live steps only |
| M04 | Sync, drift, trust checks | 0 | not started | — | Includes the Meta spending-limit check (D-063) |
| M05a | Pack SDK, SnapPool pack, settings | 0 | not started | — | T6a (read-only DB URL); SnapPool facts in SNAPPOOL-TRACKING |
| M05b | Property pack (G8), attribution, product docs | 0 | not started | — | Real attribution needs T6b shipped |
| M06a | AI layer, finding registry, detectors | 0 | not started | — | T9 |
| M06b | Analyst input, look-ups, analyse stage | 0 | not started | — | |
| M07 | Digest, brief, services (Phase 0 exit) | 0 | not started | — | T7, T8 |
| M08 | Draft stage, proposals, replay v0 | 1 | not started | — | Phase 0 gate |
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
| 0 → 1 | Brief useful and new in 2 of the first 4 weeks; property pack added with zero core changes | not started |
| 1 → 2 | ≥ 70% agree over 3 weeks, with ≥ 15 agent proposals | not started |
| 2 → 3 | ≥ 20 live changes, 0 wrong, 0 unexplained verify failures, 1 undo drill | not started |
| 3 → 4 | 4 weeks: no guard bypass, no wrong budget change, no ceiling breach caused by the agent | not started |
| 4 → 5 | Variants pass the checks; a dropped required string is always blocked | not started |
