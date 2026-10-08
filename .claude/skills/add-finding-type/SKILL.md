---
name: add-finding-type
description: Add a new finding type or detector, or change one (packages/core/src/findings, the analyst's validation): the registry entry (targets, action, params, phase, window), the detector rule, per-pack thresholds, the analyst's view of it, and the tests (fires / doesn't fire, low volume, injection, fake evidence) plus the replay case. Use when a milestone adds a detector (M14's budget pair, M15b's copy refresh), when a rule or window changes, or when the analyst should be allowed a new type ("add a detector", "new finding type", "change the cost spike rule").
---

# Add or change a finding type

A finding is a candidate problem with evidence **computed from SQL** and a verdict from the pack's threshold
(PROPOSAL §6.5, invariant 4). The AI never supplies a number that decides anything. The working examples are in
`packages/core/src/findings/detectors.ts`; copy the closest one (`zeroOutcomeSpend` for an entity rule,
`trackingGap` for an account, `pacingRisk` for the product, `wastefulSearchTerm` for a rule with a parameter).

## 1. The type and its registry entry

- `FindingTypeId` in `packages/contracts/src/findings.ts` (and BLUEPRINT §3.7). A new id is a contract change:
  record it with `update-plan`.
- `FINDING_TYPES` in `packages/core/src/findings/registry.ts`:
  - `targets`: entity types, `account` or `product` (D-079). The analyst's findings are checked against it.
  - `action` and `requiredParams`: the write action a proposal would carry (M08), or `null` (diagnose only).
  - `proposalsFromPhase`: when it may produce proposals (PROPOSAL §12).
  - `windowDays`: the days the rule looks at, ending yesterday. `evidenceWindowDays` stretches it to the pack's
    `minDays`.
  - `label`: plain words for summaries and the digest.

## 2. The detector

- A `Detector` (`type`, `detect(ctx)`) in `detectors.ts`, added to `DETECTORS` in order. Rules:
  - **Fail closed:** `thresholdFor(ctx.manifest, type)` null → no candidates.
  - Only active entities of active accounts (`activeEntities`); skip what a missed sync could fake (see
    `noDelivery`: accounts synced today).
  - Evidence: `computeEvidence` (or `searchTermEvidence`) over `windowEndingYesterday(...)`; the rule's own figures
    go in `detail` (money as decimal strings of micros, keys ending in `Micros`, so the analyst sees currency).
  - Keep a candidate only when the rule holds **and** `judgeEvidence(evidence, threshold).met`.
  - **Summaries from computed figures only**, never platform text (names, search terms). Untrusted text travels
    as a parameter (`negativeText`), as data. Money via `money()` (bigint, never a float).
- The analyst may add findings only of `ANALYST_TYPES` (the types `DETECTORS` covers, `analyst/analyse.ts`). A type
  with a budget action: `budgetChangePct` is dropped until M14 wires budgets; revisit `applyAnalystOutput` then.
- The analyst's instructions list the types from the registry (`analyst/instructions.ts`); a rule worth explaining
  to the model goes there too. Any change to the instructions bumps `ANALYST_PROMPT_VERSION`.

## 3. Thresholds (per pack)

- Every pack that should get the type needs `thresholds.<type>` in its manifest (`add-product-pack`):
  `minImpressions`, `minClicks`, `minSpendMicros`, `minDays`. The pack tests check monotonic thresholds.
- No threshold = no candidates and, for the analyst's own findings, `passedThreshold: false`.

## 4. Tests (`packages/core/test/detectors.test.ts`, `analyst.test.ts`)

- A **fires / doesn't fire** pair, including **low volume** (below the threshold, or fewer days than `minDays`),
  and the rule's own edges (a paused entity, a stale account…). Write the expected summary and `detail` by hand.
- If the type takes platform text: an **injection** case (the text stays data, out of the summary).
- The analyse stage: an analyst finding of the type with **fake evidence** (big claimed numbers on a tiny entity)
  must be stored with the computed evidence and `passedThreshold: false`; a wrong target kind is dropped.

## 5. The replay case

- If the property fixture (`packages/evals/src/property/fixture.ts`) should show the type, add the data there,
  then regenerate the case: `pnpm --silent --filter @ads/evals case:property --print-prompt` to read the input,
  then `--answer <file> --write` with a hand-written answer (or a real model run with the key), and review the
  diff of `packages/evals/cases/property-sg-0001.json`. The case test replays it.

## 6. Check

`pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm format:check`, then the `preflight`
skill. Record the rule in the milestone file and, if it differs from BLUEPRINT §5.9, fix the plan (`update-plan`).
