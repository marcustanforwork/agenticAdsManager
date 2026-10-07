# M06a — AI layer, finding registry, detectors

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-10-07 |
| **Finished** | — |
| **PRs** | — |

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
  - [ ] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

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
- [ ] 3. Detectors (§5.9) produce candidate findings with `source = 'detector'`.
- [ ] 4. `ads cycle --until detected` prints the candidates.

## Tests
- [ ] Model layer, with a mock provider: schema-failure retry; tags present; cost recorded.
- [ ] Evidence computation matches hand-computed sums over fixture rows.
- [ ] Each detector has a fires / doesn't-fire pair, including low volume.
- [ ] Thresholds are applied to computed evidence, never to anything the AI returns.

## Done when (cloud)
- [ ] All tests are green.

## Done when (live, run by Marcus)
- [ ] A SnapPool cycle up to `detected` runs on real synced data.
- [ ] Langfuse receives a test trace.

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- _Written at close._

## Skills to create
- None for M06a (`add-finding-type` comes with M06b).

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
| 14 | No production write capability outside the gateway | | |
| 15 | Cut items moved at most once | | |
| 16 | Memory is current | | |

## Evidence
<!-- command output that proves "Done when (cloud)" -->

## Notes and surprises
- 2026-10-07: `ai` 7.0.130 is `latest` on npm; 6.x is published under the `ai-v6` tag. Langfuse's own integration (`@langfuse/vercel-ai-sdk` 5.13.0) requires `ai` 7. So M06a uses AI SDK 7 (D-078). The API the plan names (`generateText` + `Output.object`) is unchanged; `system` became `instructions`, `experimental_telemetry` became `telemetry`, and tracing is a registered integration.
- 2026-10-07: `@ai-sdk/anthropic` 4.0.74 knows `claude-fable-5-1`, `claude-opus-5-5` and `claude-sonnet-5-5`, and sends structured output as `output_config.format` (it avoids forced tool use, which those models reject).
- 2026-10-07: the `findings` table requires an ad entity as the target, but `tracking_gap` is about an ad account and `pacing_risk` about the whole product. Migration `0004` lets a finding target an account or the product (D-079).
