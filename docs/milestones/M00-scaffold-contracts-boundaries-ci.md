# M00 — Scaffold, contracts, boundaries, CI

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-09-25 |
| **Finished** | — |
| **PRs** | [#3](https://github.com/marcustanforwork/agenticAdsManager/pull/3) |

## Goal
A monorepo where the dependency rules are enforced by tooling before any feature exists.

## Needs
- [x] T1 (GitHub repo settings, GIT-WORKFLOW §9): done 2026-09-25, except the ruleset's required status checks (optional; recorded in NOW). PR #3 merged on Marcus's instruction.
  - 2026-09-25: Marcus added a ruleset on `main`. Checked via the public API: PR required, force pushes and deletion blocked. **Still missing:** a required status check (`memory-check`, and `ci` once this PR has run it), squash-only merging, and "Automatically delete head branches". The Actions permission couldn't be checked from here.

## Read first
- PROPOSAL §10; BLUEPRINT §1–3 and §8; GIT-WORKFLOW §6.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order: 1 (versions) → 2 (workspace) → 5 (empty packages, so there is something to check) → 4 (contracts + tests) → 3 (boundaries + fixture tests) → 6 (entry points, CLIs) → 7 (Docker) → 8 (CI) → 9 (session tooling).
- Cut first, if behind at ~300k: the formatter; CLI commands beyond `version`. Never cut: the boundary checks and the Dockerfile.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. Verify current versions with the `verify-external-facts` skill: Node 24 vs 26, pnpm, TypeScript, zod 4, Vitest, ESLint, Turborepo, dependency-cruiser, Drizzle, AI SDK. Record them in GOTCHAS.
- [x] 2. Workspace setup:
  - pnpm workspace + Turborepo;
  - `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`);
  - `vitest.config.ts` using projects;
  - `eslint.config.js` (flat config);
  - a formatter;
  - Node version pinned (`engines` + `.nvmrc`).
- [x] 3. Boundaries: `scripts/check-boundaries.ts`, `.dependency-cruiser.cjs` and the ESLint mirror, all run by `pnpm check:boundaries` (§2).
- [x] 4. `packages/contracts` contains everything in §3:
  - money helpers and the JSON codec;
  - `canonicalJson` and `sha256Hex`;
  - `mergeGuardsTightenOnly`;
  - the undo table;
  - an SGD formatter.
- [x] 5. Empty but compiling packages and apps for every path in §1. Each has a `README.md` stating its single job and its allowed dependencies.
- [x] 6. `apps/worker` and `apps/gateway` entry points that log `ready`, serve a localhost health endpoint and exit cleanly on SIGTERM. CLIs `ads` and `ads-gw` (commander) with `--product` and `version`.
- [x] 7. Docker files:
  - `Dockerfile`: multi-stage, pnpm, non-root, one image, two entry points;
  - `docker-compose.yml`: project `name: ads-agent`, with `worker` and `gateway` services, `restart: unless-stopped`, healthchecks, env via `doppler run`. Local development uses the separate project name `ads-agent-dev` (D-058);
  - `.dockerignore`.
- [x] 8. CI (`.github/workflows/ci.yml`): install → typecheck → lint → check:boundaries → test → build → docker build (no push); plus a secret scan (gitleaks). Keep `memory-check.yml`.
- [x] 9. Session tooling:
  - add dependency installation for cloud sessions to `.claude/hooks/session-start.sh`, following the `session-start-hook` skill's conventions;
  - fill in "Commands" in `CLAUDE.md`;
  - put the real commands into the `preflight` skill.


### Build notes (2026-09-25)
- **1:** versions in GOTCHAS. Node 24.21.0, pnpm 10.34.5, TypeScript 6.0.3 (not 7), zod 4.6.5, Vitest 5.0.1, ESLint 10.11, Turborepo 2.11.4, dependency-cruiser 18.4. Drizzle and the AI SDK aren't installed yet; their versions are recorded for M01a and M06a.
- **2:** packages resolve each other's **TypeScript sources** through the custom export condition `@ads/source` (used by tsconfig `customConditions`, Vitest, dependency-cruiser and Node's `--conditions`). Builds switch it off (`tsconfig.build.json`) and emit `dist/`, which is what production uses. So typecheck and tests never need a build first. Relative imports use `.ts` extensions (`rewriteRelativeImportExtensions`).
- **3:** one rules file, `scripts/boundary-rules.mjs`, drives all three checks. `check-boundaries.ts` also checks each package's name, fails on a package with no rule, and walks apps/web's whole internal dependency tree.
- **4:** `packages/contracts/src/*`. Beyond BLUEPRINT §3: `MicrosCodec` (zod codec), `microsToMetaMinor`, `hashOf`, `CORE_GUARD_DEFAULTS`, `PLATFORM_GUARD_DEFAULTS`, `GuardLoosenedError`, `undoFor()` with `ApplyContext`, and minimal read-row shapes (`DateRange`, `AdEntityRecord`, `MetricRow`, `SearchTermRow`, `ClickRow`, `TrustSignalRow`) that §3.6 names but doesn't define. M02/M03 may add fields to those.
- **5:** 17 packages. Each has a README with its job and allowed dependencies. apps/web is a plain TypeScript package until M10a adds Next.js.
- **6:** the health endpoint listens on 127.0.0.1 (`HEALTH_HOST`, `HEALTH_PORT`; worker 8081, gateway 8082). A child-process test proves `ready`, then exit 0 on SIGTERM.
- **7:** `docker/entrypoint.sh` wraps the process in `doppler run --forward-signals --no-fallback` only when `DOPPLER_TOKEN` is set. Each compose service gets its own token (`DOPPLER_TOKEN_WORKER`, `DOPPLER_TOKEN_GATEWAY` in a git-ignored `.env`), so the gateway's write key never reaches the worker. Doppler CLI 3.76.6 is downloaded from GitHub releases and checksum-verified. `pnpm deploy --legacy` was tested locally: the pruned gateway app runs.
- **8:** CI adds `format:check` and a Docker smoke test (both entry points log `ready` and exit 0 on `docker stop`; both CLIs print a version) on top of the plan's steps. gitleaks needs `pull-requests: read`; PR comments are off.
- **9:** the hook's setup is tested both warm (~2 s) and from a clean cache. `.claude/settings.json` hook timeout is 300 s.

## Tests
- [x] A fixture package where `core` depends on `connector-google-write` makes `check:boundaries` fail. A relative cross-package import fails dependency-cruiser.
- [x] Contracts:
  - every schema round-trips (parse → serialise → parse);
  - the bigint JSON codec works;
  - `canonicalJson` is stable regardless of key order;
  - `decimalToMicros` property test: exact, and rejects junk;
  - `mergeGuardsTightenOnly` rejects looser values.

## Done when (cloud)
- [x] `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test` is green locally and in CI.
  - evidence: locally: 17/17 typecheck tasks, lint clean, `check-boundaries: OK (17 packages)`, `no dependency violations found`, `Tests 91 passed (91)`. CI run [36109818266](https://github.com/marcustanforwork/agenticAdsManager/actions/runs/36109818266): `ci`, `secret-scan` and `memory-check` all succeeded.
- [x] `apps/web` builds with only `contracts` + `db` in its dependency tree.
  - evidence: `pnpm build` builds `@ads/app-web`; `check-boundaries` walks its internal tree (test: `web-tree` fixture fails).
- [x] The Docker image builds in CI.
  - evidence: the same run built `ads-agent:ci`. The smoke test logged `"msg":"ready"`, then `"msg":"stopped"`, for worker (8081) and gateway (8082), exit code 0 on `docker stop`, and `ads 0.0.0` / `ads-gw 0.0.0`.

## Done when (live, run by Marcus)
- [ ] `docker compose up` on the SER9 prints `ready` for both services.
- [ ] `docker compose stop` exits cleanly.

### Live steps for Marcus
These use no secrets; `-p ads-agent-dev` keeps them away from the production project (D-058).
1. `docker compose -p ads-agent-dev up --build`
   - expect: a `"msg":"ready"` log line from `worker` and from `gateway`
2. `docker compose -p ads-agent-dev ps`
   - expect: both `healthy` within ~30 s
3. `docker compose -p ads-agent-dev stop`, then `docker compose -p ads-agent-dev ps -a`
   - expect: `"msg":"stopped"` from both, and `Exited (0)`
4. `docker compose -p ads-agent-dev down`
   - report back: "ready, healthy, stopped", or paste the output

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| none | — | — | — |

## Leave behind (for later milestones)
- **Adding a package:**
  1. Add its directory and allowed `@ads/*` dependencies to `scripts/boundary-rules.mjs` (a pack needs nothing: every `packages/packs/*` gets the pack rule).
  2. Create `package.json` named as the rule says (`@ads/<dir>`, apps `@ads/app-<dir>`, packs `@ads/pack-<dir>`), with `exports` `{ "@ads/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`, `files: ["dist"]`, and `typecheck` + `build` scripts. Copy `tsconfig.json` and `tsconfig.build.json` from a sibling.
  3. Add a README with its job and allowed dependencies. Tests go in `test/*.test.ts`; Vitest finds them.
  4. Run `pnpm install && pnpm check:boundaries`.
- **The boundary configuration:**
  - `check-boundaries.ts`: package.json edges (all dependency fields), package names, and the apps/web tree.
  - `.dependency-cruiser.cjs`: relative imports that escape a package; I/O, Node built-ins or `runtime.ts` imported from a pack's `src/manifest.ts`; unresolvable imports. It uses `preserveSymlinks`, so a workspace import resolves to `node_modules/@ads/...`, and only a real relative escape lands in another package's directory.
  - ESLint `no-restricted-imports` blocks, generated per package for editor feedback; `ADS_LINT_BOUNDARIES_ONLY=1` runs just those.
- **Money lint:** ESLint bans `parseFloat` and `Number.parseFloat` everywhere.

## Skills to create
- none listed for M00.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | Only `packages/gateway` declares the write connectors; `check:boundaries` enforces it, and a fixture test proves the failure. |
| 2 | No product logic in shared code | yes | The preflight grep over contracts, pack-sdk, core, gateway, connectors, vault, db and apps/web finds nothing. A product word in a contracts comment was removed. |
| 3 | AI calls through core/model | n/a | No AI calls yet. |
| 4 | The AI never supplies decision numbers | n/a | No AI yet. `AnalystFinding` carries no decision numbers beyond a clamped hint, as in BLUEPRINT §3.7. |
| 5 | Untrusted text is data | n/a | No prompts yet. |
| 6 | Money is bigint micros / decimal strings | yes | Money is bigint micros / `MicrosJson` strings. `decimalToMicros` rejects inexact input and never rounds. ESLint bans `parseFloat`. The invariant-6 grep hits only port parsing. |
| 7 | Every write action has an undo and a test | yes | `UNDO_TABLE` covers every action, and a property test proves apply-then-undo restores the snapshot. `upload_conversions` is listed as irreversible. |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | `mergeGuardsTightenOnly` has property tests (accepts tightening, rejects loosening). No copy rules yet. |
| 9 | Surfaces only record intent | yes | The CLIs only print a version; no state changes. |
| 10 | apps/web depends only on contracts + db | yes | `apps/web` depends on contracts + db; `check-boundaries` walks the whole tree. |
| 11 | product_id + an index on product-scoped tables | n/a | No tables yet (M01a). |
| 12 | No state outside Postgres | yes | The processes hold no state; the container runs with a read-only root filesystem. |
| 13 | No secrets or personal data | yes | No secrets; the token grep and gitleaks are clean. Doppler tokens live only in a git-ignored `.env` on the SER9. |
| 14 | No production write capability outside the gateway process | yes | No credentials anywhere. The compose file gives each service its own Doppler token (D-065). |
| 15 | Cut items moved at most once | yes | Nothing was cut. |
| 16 | Memory is current | yes | NOW.md and LOG.md are updated in this PR. |

## Evidence

## Notes and surprises
- 2026-09-25: versions checked with `npm view` and nodejs.org; see GOTCHAS "External facts". Choices: **Node 24.21.0** (26 isn't LTS until 2026-10-28), **pnpm 10.34.5**, **TypeScript 6.0.3, not 7**: typescript-eslint 8.70 supports only TypeScript < 6.1, and TS 7 is the new native compiler.
- 2026-09-25: **AI SDK 7 is now `latest`** (7.0.114); the plan says AI SDK 6 (6.0.291 still published). Not installed in M00. M06a decides, after checking the v7 migration guide.
