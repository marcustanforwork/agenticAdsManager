# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-09-25 · cloud session · branch `claude/trusting-wozniak-dcdxfu` · PR for M01a (see In flight).

## Where we are
- **Phase:** 0.
- **Active milestone:** **M01a: cloud work done**; status **awaiting live acceptance** (Neon migrate + seed, below). Details, evidence and "Leave behind": `docs/milestones/M01a-database-schema-repositories.md`.
- **M00** is merged and still awaiting its live acceptance (the SER9 Docker check).
- **Status:** plan v3.5 (BLUEPRINT). No open questions. D-066 records M01a's build choices (Drizzle 0.45, migration `0000_init`, extra gateway grants, seed data in `products/seed.json`).
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens (BLUEPRINT §9).

## Next action
1. **Marcus:** review the M01a PR; merge when happy and CI is green (D-057).
2. **Claude (next session: clean context, Opus 5.5, medium effort):** `start-milestone` for **M01b** (queue, leader lock, vault, request processor). Cloud: if the assigned branch's PR is merged, reset it to `origin/main` first (`start-session` §2). Start with the `db-migration` skill's test-DB recipe (`pg_ctlcluster 16 main start` + the postgres password).
3. **Marcus, when T2 and T3 are done:** the M01a live steps (below). They don't block M01b's cloud work.
4. **Marcus, when at the SER9:** the M00 live steps (in `docs/milestones/M00-scaffold-contracts-boundaries-ci.md`).
5. **Marcus, optional part of T1:** in the `main` ruleset, turn on "Require status checks to pass" with `memory-check`, `ci` and `secret-scan`.
6. **Marcus:** the SnapPool tracking change (T6b), early (prompt in `SNAPPOOL-TRACKING.md` §7); setup tasks T2–T5, T6a (`PROPOSAL.md` §16).

## In flight
- M01a PR from `claude/trusting-wozniak-dcdxfu`: ready for review. All local checks green (320 tests).

## Blocked on Marcus
- No open questions.
- Live steps: M01a (needs T2, T3), M00 (SER9). Setup tasks T1 (optional part), T2–T14; the SnapPool tracking change (T6b).

## Live steps for Marcus
**M01a** (after the PR is merged; needs T2 + T3). Use the Neon **owner** connection strings, **direct** host (no `-pooler`):
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
| M01a | Database schema and repositories | 0 | **awaiting live acceptance** | open (this session) | Live: Neon migrate + seed (needs T2, T3) |
| M01b | Queue, leader lock, vault, request processor | 0 | **next** | — | |
| M02 | Meta read connector | 0 | not started | — | T4 (read side) |
| M03 | Google read connector | 0 | not started | — | T5 |
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
