# M00 — Scaffold, contracts, boundaries, CI

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-09-25 |
| **Finished** | — |
| **PRs** | — |

## Goal
A monorepo where the dependency rules are enforced by tooling before any feature exists.

## Needs
- [ ] T1 (GitHub repo settings, GIT-WORKFLOW §9): needed **before merging**, not before building.
  - 2026-09-25: Marcus added a ruleset on `main`. Checked via the public API: PR required, force pushes and deletion blocked. **Still missing:** a required status check (`memory-check`, and `ci` once this PR has run it), squash-only merging, and "Automatically delete head branches". The Actions permission couldn't be checked from here.

## Read first
- PROPOSAL §10; BLUEPRINT §1–3 and §8; GIT-WORKFLOW §6.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order: 1 (versions) → 2 (workspace) → 5 (empty packages, so there is something to check) → 4 (contracts + tests) → 3 (boundaries + fixture tests) → 6 (entry points, CLIs) → 7 (Docker) → 8 (CI) → 9 (session tooling).
- Cut first, if behind at ~300k: the formatter; CLI commands beyond `version`. Never cut: the boundary checks and the Dockerfile.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [ ] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. Verify current versions with the `verify-external-facts` skill: Node 24 vs 26, pnpm, TypeScript, zod 4, Vitest, ESLint, Turborepo, dependency-cruiser, Drizzle, AI SDK. Record them in GOTCHAS.
- [ ] 2. Workspace setup:
  - pnpm workspace + Turborepo;
  - `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`);
  - `vitest.config.ts` using projects;
  - `eslint.config.js` (flat config);
  - a formatter;
  - Node version pinned (`engines` + `.nvmrc`).
- [ ] 3. Boundaries: `scripts/check-boundaries.ts`, `.dependency-cruiser.cjs` and the ESLint mirror, all run by `pnpm check:boundaries` (§2).
- [ ] 4. `packages/contracts` contains everything in §3:
  - money helpers and the JSON codec;
  - `canonicalJson` and `sha256Hex`;
  - `mergeGuardsTightenOnly`;
  - the undo table;
  - an SGD formatter.
- [ ] 5. Empty but compiling packages and apps for every path in §1. Each has a `README.md` stating its single job and its allowed dependencies.
- [ ] 6. `apps/worker` and `apps/gateway` entry points that log `ready`, serve a localhost health endpoint and exit cleanly on SIGTERM. CLIs `ads` and `ads-gw` (commander) with `--product` and `version`.
- [ ] 7. Docker files:
  - `Dockerfile`: multi-stage, pnpm, non-root, one image, two entry points;
  - `docker-compose.yml`: project `name: ads-agent`, with `worker` and `gateway` services, `restart: unless-stopped`, healthchecks, env via `doppler run`. Local development uses the separate project name `ads-agent-dev` (D-058);
  - `.dockerignore`.
- [ ] 8. CI (`.github/workflows/ci.yml`): install → typecheck → lint → check:boundaries → test → build → docker build (no push); plus a secret scan (gitleaks). Keep `memory-check.yml`.
- [ ] 9. Session tooling:
  - add dependency installation for cloud sessions to `.claude/hooks/session-start.sh`, following the `session-start-hook` skill's conventions;
  - fill in "Commands" in `CLAUDE.md`;
  - put the real commands into the `preflight` skill.

## Tests
- [ ] A fixture package where `core` depends on `connector-google-write` makes `check:boundaries` fail. A relative cross-package import fails dependency-cruiser.
- [ ] Contracts:
  - every schema round-trips (parse → serialise → parse);
  - the bigint JSON codec works;
  - `canonicalJson` is stable regardless of key order;
  - `decimalToMicros` property test: exact, and rejects junk;
  - `mergeGuardsTightenOnly` rejects looser values.

## Done when (cloud)
- [ ] `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test` is green locally and in CI.
  - evidence:
- [ ] `apps/web` builds with only `contracts` + `db` in its dependency tree.
  - evidence:
- [ ] The Docker image builds in CI.
  - evidence:

## Done when (live, run by Marcus)
- [ ] `docker compose up` on the SER9 prints `ready` for both services.
- [ ] `docker compose stop` exits cleanly.

### Live steps for Marcus
_Filled in at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- How to add a package without breaking the boundary rules, and the boundary configuration explained. _(written at close)_

## Skills to create
- none listed for M00.

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
| 14 | No production write capability outside the gateway process | | |
| 15 | Cut items moved at most once | | |
| 16 | Memory is current | | |

## Evidence

## Notes and surprises
- 2026-09-25: versions checked with `npm view` and nodejs.org; see GOTCHAS "External facts". Choices: **Node 24.21.0** (26 isn't LTS until 2026-10-28), **pnpm 10.34.5**, **TypeScript 6.0.3, not 7**: typescript-eslint 8.70 supports only TypeScript < 6.1, and TS 7 is the new native compiler.
- 2026-09-25: **AI SDK 7 is now `latest`** (7.0.114); the plan says AI SDK 6 (6.0.291 still published). Not installed in M00. M06a decides, after checking the v7 migration guide.
