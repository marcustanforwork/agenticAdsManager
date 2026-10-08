# M06a — AI layer, finding registry, detectors

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-10-07 |
| **Finished** | 2026-10-07 (cloud part) |
| **PRs** | branch `claude/gifted-franklin-hk0fku` (PR opened at close) |

## Goal
A traced, model-swappable AI layer, and fixed rules that find candidate problems, with evidence computed from the database.

## Needs
- [x] M05b: merged (PR #10, 2026-10-07). Its "Leave behind": outcomes per campaign come from `outcomes.attributed_entity_id` (campaign level, test outcomes excluded by `is_test`).
- [ ] **T9 (Langfuse: a project and API keys):** not done; setup waits until the end of Phase 0 (D-074). The model layer is built and tested with a mock model and an in-memory span exporter; the real test trace is a live step. The live step also needs an **AI provider key** (`ANTHROPIC_API_KEY`) in Doppler `dev`; T9's text now says so (D-078).
- [x] External facts checked (GOTCHAS, 2026-10-07): AI SDK 7 is the current major version and Langfuse ships an AI SDK 7 integration (D-078); Claude model ids and prices from the `claude-api` skill.

## Read first
- BLUEPRINT §3.7 (findings), §5.9 (detectors), §5.17 (model routing and tracing), §5.18 (personal data); PROPOSAL §6.5 and §10 (AI access).
- The code M06a extends: `core/src/cycle/runCycle.ts` (stages), `core/src/cycle/trust.ts` (check results the tracking detector reads), `pack-sdk/src/thresholds.ts` (the threshold engine), `connector-google/src/client.ts` (search terms, KPI conversions by action id).
- External: the AI SDK 7 docs shipped inside the `ai` npm package (`docs/08-migration-guides/23-migration-guide-7-0.mdx`, `docs/03-ai-sdk-core/55-testing.mdx`); the READMEs and types of `@langfuse/vercel-ai-sdk`, `@langfuse/otel` and `@langfuse/core` 5.13.0. `ai-sdk.dev` and `langfuse.com` are blocked by the cloud proxy.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order, each step green, committed and pushed:
  1. **Plan fix and dependencies:** D-078 (AI SDK 7 instead of 6; Langfuse through its AI SDK 7 integration), GOTCHAS rows, PROPOSAL §10; pin `ai`, the three providers, the Langfuse and OpenTelemetry packages in `@ads/core`.
  2. **`core/model` (Build 1):** `provider:model` specs per stage; the provider factory (`anthropic`, `openai`, `openai-compatible` for local endpoints); `generateStructured` (`generateText` + `Output.object`, one retry when the output fails the schema); Langfuse tracing tagged with product, cycle and stage; cost in USD micros from a price table, added to `cycles.model_cost_micros`; personal data redacted from prompts and masked in traces. `ads model ping` sends one traced call (the live step).
  3. **Findings schema and evidence (Build 2):** migration `0004` (a finding may target an ad account or the whole product, D-079); `ComputedEvidence` gains its window and days of data; the finding-type registry; `computeEvidence` for any target and window, from SQL.
  4. **Per-term KPI conversions in the Google sync** (§5.9 says M06a adds them before `wasteful_search_term`).
  5. **Detectors (Build 3)** in this order: `zero_outcome_spend`, `tracking_gap`, `pacing_risk`, `wasteful_search_term`, then `cost_spike` and `no_delivery`, then the two Phase 3 detectors (`budget_limited_efficient`, `overspend_inefficient`).
  6. **The detect stage and `ads cycle --until detected` (Build 4).**
  7. Plan updates (D-079), the `close-milestone` skill (preflight, code review, close).
- Cut first, if behind at ~300k: the `cost_spike` and `no_delivery` detectors (the plan's list). The two Phase 3 detectors would then move to M14, where they first produce proposals (M14 Build 5).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented (~200k with the external-fact checks: ai-sdk.dev and langfuse.com are blocked, so the facts came from the published npm packages)
  - [x] ~300k built, typecheck green: no; Builds 1–2 and the per-term conversions were done at ~460k (the session restarted once after a usage limit). The cut-first list was applied there: `cost_spike` and `no_delivery` to M06b, and the two Phase 3 detectors to M14.
  - [x] ~450k tests green, self-review done (Builds 3–4 at ~500k; the invariant self-review at close)
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. `core/model`:
  - a provider factory that reads `provider:model` env strings;
  - structured output via `generateText` + `Output.object`, retried once if the schema fails;
  - Langfuse tracing tagged with product, cycle and stage;
  - cost recorded per cycle;
  - no personal data in prompts or traces.
  - notes: `packages/core/src/model/` (`models.ts` specs and providers, `prices.ts` USD price table and `MODEL_PRICES`, `redact.ts`, `tracing.ts`, `generate.ts`); `addModelCost` in `db`; `ads model ping` (`apps/worker/src/model.ts`). Tests: `core/test/model.test.ts` (19), `worker/test/model.test.ts` (2). Commit c55147e. The vitest config no longer resolves Node-side imports with the `module` condition (OpenTelemetry's ESM build needs a bundler).
- [x] 2. The finding-type registry (§3.7), and evidence computation: `ComputedEvidence` from the DB for any target and window.
  - notes: migration `0004` (findings may target an ad account, or the product with both targets null; `findings_one_target_check`); `ComputedEvidence` gains `from`, `to`, `dataDays`, `detail`; `db/src/repos/evidence.ts` (`sumMetrics`, `countOutcomesByScope`, `sumSearchTerms`), `replaceDetectorFindings`; `core/src/findings/registry.ts`, `evidence.ts`. Tests: `core/test/evidence.test.ts` (8, hand-computed sums), `db/test/cycles.test.ts` (+3).
- [x] 3. Detectors (§5.9) produce candidate findings with `source = 'detector'`.
  - notes: `core/src/findings/detectors.ts`: `zero_outcome_spend`, `tracking_gap`, `pacing_risk`, `wasteful_search_term` (the latter after the per-term KPI conversions in the Google sync, commit 6ad34ae). `cost_spike` and `no_delivery` moved to M06b, the Phase 3 pair to M14 (see Cut / moved). Tests: `core/test/detectors.test.ts` (10). Commit cb12f95.
- [x] 4. `ads cycle --until detected` prints the candidates.
  - notes: `core/src/findings/stage.ts` (`detectStage`, the `detected` stage after the trust check); the summary's `detected.candidates` lists type, target (platform ids, never names), summary and evidence. `apps/worker/test/sync.test.ts` and `core/test/cycle.test.ts` cover it.

## Tests
- [x] Model layer, with a mock provider: schema-failure retry; tags present; cost recorded. (`core/test/model.test.ts`)
- [x] Evidence computation matches hand-computed sums over fixture rows. (`core/test/evidence.test.ts`)
- [x] Each detector has a fires / doesn't-fire pair, including low volume. (`core/test/detectors.test.ts`, for the four built; the moved two get theirs in M06b)
- [x] Thresholds are applied to computed evidence, never to anything the AI returns. (the detect-stage test checks the stored evidence equals `computeEvidence`; detectors take no AI input)

## Done when (cloud)
- [x] All tests are green.
  - evidence: `pnpm test` → 66 files passed, 1 skipped; 785 tests passed, 3 skipped (the recorded-fixture replays wait for the live recordings).

## Done when (live, run by Marcus)
- [ ] A SnapPool cycle up to `detected` runs on real synced data.
- [ ] Langfuse receives a test trace.

### Live steps for Marcus
_At the end of Phase 0 (D-074), after the M05b steps. Needs T9 (Langfuse keys) and the AI provider key; Doppler `dev`, Neon dev branch._
1. `git pull` on `main`, `pnpm install`; `doppler run --config dev -- pnpm --filter @ads/db db:migrate` (migration `0004`).
   - expect: `migrations and roles.sql applied`.
2. T9: in Langfuse, create a project and API keys; in Doppler `dev` add `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (your region, e.g. `https://cloud.langfuse.com`) and `ANTHROPIC_API_KEY`.
3. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads model ping --product snappool`
   - expect: JSON with `"model": "anthropic:claude-fable-5-1"`, `"attempts": 1`, a `costMicros` of a few thousand (US dollar micros), `"traced": true`; in Langfuse, a trace `analyst:snappool` tagged `product:snappool` and `stage:analyst`.
   - report back: the JSON, and "trace seen".
4. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads cycle --product snappool --kind manual --until detected`
   - expect: `"stageReached": "detected"` and a `"detected": {"candidates": [...]}` block. At low volume: none, or `pacing_risk` / `tracking_gap`.
   - report back: each candidate's `type`, `target` and `summary` (ids and figures only).

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| The `cost_spike` and `no_delivery` detectors (§5.9) | M06b (Build 5) | The plan's cut-first list, applied at the token checkpoint | 2026-10-07 |
| The `budget_limited_efficient` and `overspend_inefficient` detectors (§5.9, Phase 3) | M14 (Build 5) | They first make proposals there; the token checkpoint | 2026-10-07 |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- **For M06b (the analyse stage):**
  - Call the model with `generateStructured(deps, { context: { product: { id, slug }, cycleId, stage: 'analyst' }, schema: AnalystOutput, instructions, prompt })`; `deps` = `{ env, db, tracing }`. Create the tracing once per process with `createModelTracing(env)` (the worker doesn't yet: wire it at startup and `shutdown()` on exit). Cost lands on the cycle by itself.
  - Candidates are this cycle's `findings` with `source = 'detector'`: their `id` is the analyst's `fromCandidateId`. Account- and product-level candidates (`tracking_gap`, `pacing_risk`) have no ad entity, but `AnalystFinding.target` is an `EntityRef`: decide how the analyst confirms them (e.g. `target` optional when `fromCandidateId` names such a candidate).
  - Validate with the registry (`allowsTarget`, `FINDING_TYPES`), compute with `computeEvidence` over `windowEndingYesterday(now, tz, evidenceWindowDays(type, threshold))`, judge with `judgeEvidence`. A `negativeText` must equal a real term: `sumSearchTerms` lists them.
  - Build the two moved detectors (`cost_spike`, `no_delivery`) in `detectors.ts` and add them to `DETECTORS`.
- **Prices:** `MODEL_PRICES` in `core/src/model/prices.ts`, USD per million tokens (GOTCHAS, re-check 2026-12-07). Model ids: `claude-fable-5-1` (default), `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5`.
- **For M14:** the `budget_limited_efficient` and `overspend_inefficient` detectors; the registry already lists their targets and the `adjust_budget` action from Phase 3.
- **Pinned:** `ai` 7.0.130, `@ai-sdk/anthropic` 4.0.74, `@ai-sdk/openai` 4.0.86, `@ai-sdk/openai-compatible` 3.0.65, `@langfuse/*` 5.13.0, OpenTelemetry `api` 1.9.1 / `sdk-trace-base` 2.12.0 / `context-async-hooks` 2.12.0.

## Skills to create
- None for M06a (`add-finding-type` comes with M06b).

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | No write actions; nothing here touches an ad account |
| 2 | No product logic in shared code | yes | Thresholds come from the pack; the core tests write their own manifest instead of importing a pack |
| 3 | AI calls through core/model | yes | `generateText` is called only in `core/src/model/generate.ts` |
| 4 | The AI never supplies decision numbers | yes | Detectors take no AI input; evidence is SQL; the stored evidence equals `computeEvidence` (test) |
| 5 | Untrusted text is data | yes | Summaries hold computed figures only; a search term travels as `negativeText`; the injection-shaped term stays out of the summary (test) |
| 6 | Money is bigint micros / decimal strings | yes | Prices and costs in bigint micros, projections in bigint, summaries formatted from bigint |
| 7 | Every write action has an undo and a test | n/a | No write actions |
| 8 | Every guard has a property test; copy rules have pass/fail examples | n/a | No guards |
| 9 | Surfaces only record intent | yes | `ads model ping` changes nothing; `ads cycle` runs the cycle as before |
| 10 | apps/web depends only on contracts + db | yes | Untouched |
| 11 | product_id + an index on product-scoped tables | yes | `findings` keeps both |
| 12 | No state outside Postgres | yes | Model cost on `cycles`; candidates in `findings` |
| 13 | No secrets or personal data | yes | Test keys built at run time; emails and phone numbers redacted from prompts and masked in traces |
| 14 | No production write capability outside the gateway | yes | Read-only |
| 15 | Cut items moved at most once | yes | First moves, recorded above and in M06b / M14 |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-078, D-079), GOTCHAS updated at close |

## Evidence
- `pnpm typecheck` → 0 errors; `pnpm lint` → clean; `pnpm check:boundaries` → OK (17 packages, no dependency violations); `pnpm format:check` → clean; `pnpm --filter @ads/db db:generate` → "No schema changes".
- `pnpm test` → Test Files 66 passed, 1 skipped (67); Tests 785 passed, 3 skipped (788).
- Code review (D-067), `code-review` at high effort over `origin/main...HEAD`: 10 findings. Fixed, with tests: (1) summaries garbled the pack's descriptive stage labels ("signup (email link clicked)s"): they now name the KPI stage by its id; (2) `zero_outcome_spend` flagged every campaign of a platform whose outcomes can't be attributed yet (Google before T14): it now judges a platform only when some recent KPI outcome carries that platform's ids; (3) the `tracking_gap` summary quoted the evidence window's clicks, not the check's; (4) `wasteful_search_term` judged ad groups under a paused campaign; (5) terms over 10 words (Google's keyword limit) were kept; (6) a failed cost write could hide the model call's own error; (7) a `MODEL_PRICES` override priced cache writes at 1× input instead of 1.25×; (8) a doc comment sat on the wrong function; (9) `PACING_HIGH_PCT` was unused. Not fixed: (10) the detectors run a few queries per entity in sequence (efficiency only; at SnapPool's handful of campaigns it doesn't matter; revisit if a product has many).
- After the fixes: typecheck, lint, boundaries and format clean; `pnpm test` → 66 files passed, 1 skipped; 786 tests passed, 3 skipped.

## Notes and surprises
- 2026-10-07: `ai` 7.0.130 is `latest` on npm; 6.x is published under the `ai-v6` tag. Langfuse's own integration (`@langfuse/vercel-ai-sdk` 5.13.0) requires `ai` 7. So M06a uses AI SDK 7 (D-078). The API the plan names (`generateText` + `Output.object`) is unchanged; `system` became `instructions`, `experimental_telemetry` became `telemetry`, and tracing is a registered integration.
- 2026-10-07: `@ai-sdk/anthropic` 4.0.74 knows `claude-fable-5-1`, `claude-opus-5-5` and `claude-sonnet-5-5`, and sends structured output as `output_config.format` (it avoids forced tool use, which those models reject).
- 2026-10-07: the `findings` table requires an ad entity as the target, but `tracking_gap` is about an ad account and `pacing_risk` about the whole product. Migration `0004` lets a finding target an account or the product (D-079).
