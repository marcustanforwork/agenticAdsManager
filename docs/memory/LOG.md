# Session log

Newest entry on top. One entry per working session, written by the `end-session` skill. Stick to facts, absolute dates and links.

---

## 2026-09-25 — M01b built: queue, leader lock, vault, request processor
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR PRLINK
- **Did:**
  - `packages/db/src/queue/`: the job queue (enqueue, SKIP LOCKED claim, heartbeat, complete, fail with backoff, release, reclaim), `startQueueRunner` (NOTIFY wake-up + 30 s poll), `listen`, `contendForLeadership`.
  - `packages/vault`: AES-256-GCM envelope encryption with read and write master keys, a `credential_access` row per `get`, and all-or-nothing key rotation. `credentials put | check | rotate-key` in `ads` and `ads-gw` (tokens from stdin only).
  - `packages/core`: the operator-request processor (`halt`, `resume_agent`, `settings_patch` with tighten-only, `brief_feedback`; other kinds refused with their milestone) and `recoverWorker`.
  - `roles.sql`: `agent_gateway` may insert/update `credentials`. 65 new tests (385 in the repo).
  - Code review (high): 10 findings, all fixed. Security review: no findings; one design point moved to M10a.
- **Decided:** D-068 (Claude, fix). BLUEPRINT v3.7.
- **Learned:** GOTCHAS entries on Commander subcommand settings, zod stripping keys, the Postgres facts proven by tests, and Node GCM usage.
- **Next:** Marcus reviews the PR; then a clean session starts M02.
- **Open:** no questions; live steps M00 (SER9) and M01a (T2, T3).

## 2026-09-25 — Code review of M01a; review becomes a closing step; PR #4 merged
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR [#4](https://github.com/marcustanforwork/agenticAdsManager/pull/4)
- **Did:**
  - Marcus asked whether sessions run a code review. They didn't; only preflight's self-review ran.
  - Ran `code-review` (high) on the M01a diff: 10 findings, 9 fixed, each with a regression test (7 of the 8 new tests fail on the old code). Details are in the M01a milestone notes.
  - `close-milestone` now includes the review step (2b).
  - Merged PR #4 on Marcus's instruction after CI passed. The M01a live steps stay undone (T2/T3 aren't set up).
- **Decided:** D-067 (Claude, fix): fingerprint fields move to contracts; the review fixes; `code-review` for every milestone. BLUEPRINT v3.6.
- **Learned:** Postgres row locks (`FOR UPDATE`/`FOR SHARE`) need UPDATE rights. drizzle-kit loads `schema.ts` with Node's resolver, so it needs `--conditions=@ads/source` to import workspace packages.
- **Next:** a clean session starts M01b.
- **Open:** live steps M00 (SER9) and M01a (T2, T3); T1's required status checks (optional).

## 2026-09-25 — M01a built: database schema, repositories, roles, seed
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR [#4](https://github.com/marcustanforwork/agenticAdsManager/pull/4)
- **Did:**
  - Pinned Drizzle 0.45.3 / drizzle-kit 0.31.11 / `pg` 8.23.0 (GOTCHAS).
  - `packages/db`: the full §4 schema (`src/schema.ts`, migration `migrations/0000_init.sql`), `sql/roles.sql` (three roles, re-runnable grants, `dashboard_outcomes` view), `db:generate` / `db:migrate` / `db:seed`, and `@ads/db/testing` (a template database cloned per test file).
  - Repositories in `src/repos/`: products and settings (optimistic concurrency + history), documents, offerings, pack manifests; accounts, entities, snapshots (only on hash change), metrics upsert (`restated_at` moves only on change), search terms, clicks, outcomes; cycles, trust checks, findings; proposals with the §3.9 transition table, `newVersion`, `recordDecision`, expiry; change log, `createUndoProposal`; briefs, operator requests, notifications, drift, system flags, API usage.
  - Seed data in `products/seed.json`. 230 new tests (320 in the repo), including all 144 status pairs and a role-permission test.
  - CI: a `postgres:16` service, and a check that `schema.ts` and the migrations agree. Skill `db-migration` created.
- **Decided:** D-066 (Claude, fix): migration `0000_init`, extra gateway grants (undo proposals, revert link, halt, its queue, API usage), worker read-only on `change_log`, the dashboard view, `product_id` indexes on accounts and credentials, the seed file. BLUEPRINT → v3.5.
- **Learned:** drizzle-kit can't serialise bigint defaults; Drizzle's jsonb reader re-parses JSON strings (fixed in `getFlag`); Drizzle wraps pg errors. See GOTCHAS.
- **Next:** Marcus reviews and merges the PR; then a clean session starts M01b.
- **Open:** no questions; M01a live steps (need T2, T3); M00 live steps.

## 2026-09-25 — M00 built: scaffold, contracts, boundaries, CI
- **Where:** cloud · branch `claude/trusting-wozniak-dcdxfu` · PR [#3](https://github.com/marcustanforwork/agenticAdsManager/pull/3)
- **Did:**
  - Checked Marcus's `main` ruleset through the public API. PR required, force pushes and deletion blocked. Still missing: required status checks, squash-only merging, auto-delete of head branches.
  - Verified toolchain versions (GOTCHAS) and pinned them.
  - Built all of M00: pnpm + Turborepo workspace with 17 packages (each with a README), strict TypeScript, Vitest, ESLint, Prettier.
  - `pnpm check:boundaries`: `scripts/check-boundaries.ts`, dependency-cruiser and the ESLint mirror, all driven by `scripts/boundary-rules.mjs`. Fixture tests show each one failing.
  - `packages/contracts` (BLUEPRINT §3), with round-trip and property tests: 91 tests in all.
  - The worker and gateway entry points, the `ads` and `ads-gw` CLIs, the Dockerfile, `docker-compose.yml`, CI (`ci.yml` plus gitleaks), the cloud setup in the SessionStart hook, Commands in CLAUDE.md, and the preflight commands.
- **Decided:** D-065 (Claude, fix): M00 build choices. PROPOSAL T3 now mentions per-service Doppler tokens (from M07).
- **Learned:** TypeScript 7 is out, but typescript-eslint needs TypeScript < 6.1. AI SDK 7 is `latest` (M06a decides). Drizzle 1.0 is a release candidate (M01a decides). The GitHub REST API is scoped to this repo in cloud sessions, but `git ls-remote` and release downloads work. See GOTCHAS.
- **Merged:** Marcus set Actions to read-only, squash-only merging and auto-delete of branches (T1; required status checks aren't on yet), and said to merge. PR #3 was squash-merged after every check passed (D-057). The M00 live test on the SER9 stays a to-do until he's at that machine.
- **Next:** a clean session starts M01a.
- **Open:** no questions; the SnapPool tracking change (T6b); setup tasks T1 (part), T2–T14.

## 2026-09-25 — Q11 approved; the SnapPool prompt; spec fixes from SnapPool's code
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` (reset to `main` after PR #1 merged) · PR [#2](https://github.com/marcustanforwork/agenticAdsManager/pull/2)
- **Did:**
  - Marcus OK'd Q11: **D-060 adopted**.
  - He asked whether a pixel or Google API work is needed. Answer: not in SnapPool. The API work is this repo's (M02, M03, M12, M13), plus platform setup (T4, T11, T14). T4 now says "create a dataset; don't install its pixel code".
  - He asked for a prompt to build the SnapPool change on his local machine. Reading SnapPool's code at `a6c190a` to write it found gaps, fixed in `SNAPPOOL-TRACKING.md` v1.2 (**D-064**):
    - the middleware is only the Auth.js `/host` guard, and would send every ad visitor to `/login` if simply widened;
    - click ids were being cut to 255 characters;
    - `page_url` now comes from `Referer`;
    - a repeat `/start` keeps the earlier attribution;
    - the privacy page promises "never share it with advertisers", so it needs three edits;
    - the migration must reach production before the deploy.
  - The prompt is §7. It has the SnapPool session add the work to SnapPool's own blueprint as its next session.
  - M05a: SnapPool deletes pending requests after 30 days, so the adapter reads at least daily.
  - Squash-merged PR #2 into `main` on Marcus's instruction, after CI passed (D-057), and reset the branch to `main`.
- **Decided:** D-060 adopted (Marcus); D-064 (Claude, fix).
- **Learned:** `gh api … -H 'Accept: application/vnd.github.raw'` returns a file's raw text (tested against this repo). SnapPool is on Next.js 15.5; its middleware lives in `middleware.ts`.
- **Next:** Marcus runs the SnapPool session with the §7 prompt. A clean session starts M00.
- **Open:** no questions; the SnapPool change (T6b); setup tasks T1–T14.

## 2026-09-25 — Q12 answered; Q11 clarified; PR #1 merged
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Q12 as D-063, superseding D-061. The budget is S$500 a month. Marcus resets Meta's spending limit by hand and will change it during trials, so the agent reads it live, never assumes it, and never changes it.
  - Moved the `spend_cap_headroom` check from M12 to **M04** and added a digest line (M07), because ads are live in Phase 0 and all Meta campaigns stop at the limit. The M05a live steps now enter the starting settings: test email domains and ceilings.
  - Q11: Marcus asked which project the tracking plan is for. The answer is SnapPool (the `snappool` repo); this repo only reads what it saves. Q11 and `SNAPPOOL-TRACKING.md` §0 now say so up front. Q11 is still open.
  - Documented how a cloud session restarts a branch whose PR is already merged (GIT-WORKFLOW §4 and §8; `start-session` §2).
  - Squash-merged PR #1 into `main` on Marcus's instruction, after CI passed (D-057), and reset the branch to `main`.
- **Decided:** D-063 (Marcus).
- **Next:** a clean-context session starts M00. Marcus: T1, Q11, and the long setup tasks T4, T5 and T6a.
- **Open:** Q11; setup tasks T1–T14.

## 2026-09-25 — Marcus's second answers; SnapPool repo read; tracking spec
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Q1–Q5 and Q8–Q10: D-039–D-053 adopted, and D-057–D-062 added.
  - Attached `marcustanforwork/snappool` (read-only) and read its schema, signup, pricing, security headers and memory.
  - Wrote `docs/plan/SNAPPOOL-TRACKING.md` (D-060, proposed).
  - Contracts: feedback **routes** (`FeedbackRoute`), a `web` context (user agent and page URL), and `testTraffic.emailDomains`.
  - Trust check `spend_cap_headroom`. Hourly uploads once auto-approved.
  - Local-session Docker isolation rules; the merge policy.
- **Decided:** D-057 (merge on instruction, after CI), D-058 (SER9 local sessions, isolation), D-059 (test signups by email domain), D-060 (SnapPool captures, the agent uploads; proposed), D-061 (Meta limit ~500, reset monthly), D-062 (Housing confirmed).
- **Learned:** GOTCHAS gained two verified Meta facts: CAPI website events **require** user agent and page URL, and the account spending limit is a **lifetime** total. It also gained the SER9 Docker rules and a pointer to the SnapPool facts.
- **Next:** Marcus answers Q11 and Q12 and says when to merge PR #1. Then the SnapPool tracking session (in the snappool repo) and M00.
- **Open:** Q11, Q12; setup tasks T1–T14.

## 2026-09-25 — Plan v3.1: Marcus's answers, sessions resized, PR opened
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Marcus's answers:
    - he already has Vercel Pro, so the dashboard runs there (D-054, superseding D-050);
    - he's already on Neon's paid plan (D-055);
    - build sessions run from a clean context on Opus 5.5 at medium effort, each within 400–600k tokens including tests, reviews and fixes (D-056).
  - Re-estimated every milestone against v2's yardstick (500k ≈ 1,500–2,500 lines including tests). Split the 8 that no longer fit into a/b parts, giving 25 sessions and about 11.6M tokens (BLUEPRINT §0, §7, §9; CHANGES §H).
  - Restored the per-session token budget and checkpoints (SESSIONS §4), and wired them into CLAUDE.md, the skills and the milestone template.
- **Decided:** D-054, D-055, D-056 (Marcus). D-050 superseded; D-033 partly superseded.
- **Learned:** GOTCHAS got a design note that Vercel functions can't use LISTEN through Neon's pooler, so the dashboard polls instead.
- **Next:** Marcus reviews the PR and answers Q1–Q5 and Q8–Q10. Then the M00 session.
- **Open:** Q1–Q5, Q8–Q10; setup tasks T1–T13.

## 2026-09-25 — Plan v3: review, rewrite, workflow and memory system
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1) (opened later the same day)
- **Did:**
  - Reviewed the v2 proposal and blueprint, and moved the originals to `docs/archive/` without changes.
  - Re-checked external facts: the Google Data Manager API switch, Explorer access, API v25.2, Node 24 LTS, AI SDK 6, Vercel Hobby terms, Neon's free tier, and Meta's special ad categories.
  - Wrote `docs/plan/PROPOSAL.md` v3, `BLUEPRINT.md` v3 and `CHANGES-v3.md`.
  - Designed the git workflow (`docs/process/GIT-WORKFLOW.md`) and the session and memory system (`docs/process/SESSIONS.md`, `docs/memory/*`, `docs/milestones/_TEMPLATE.md`).
  - Added 7 process skills (`.claude/skills/`), the SessionStart and Stop hooks (`.claude/hooks/`, `.claude/settings.json`), a PR template and the `memory-check` CI job.
- **Decided:** D-001 to D-019 (carried over from v2); D-020 to D-038 (v3 fixes). D-039 to D-053 are proposed and need Marcus's OK.
- **Learned:** GOTCHAS now has the environment facts and 12 external facts, plus 1 fact still unverified (Meta's `execution_options`).
- **Next:** Marcus reviews the plan and answers Q1–Q10. Then Claude starts M00.
- **Open:** Q1–Q10; setup tasks T1–T13.
