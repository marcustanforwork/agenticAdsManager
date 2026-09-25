# M<NN> — <title>

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | not started · in progress · awaiting live acceptance · done |
| **Phase** | <n> |
| **Started** | YYYY-MM-DD |
| **Finished** | — |
| **PRs** | — |

## Goal
<!-- copied from BLUEPRINT -->

## Needs
- [ ] <setup task / decision / previous milestone>: <status>

## Read first
- <BLUEPRINT sections, other milestone files, external docs>

## Slices (one PR is roughly one slice)
1. <slice name>: Builds <x–y>
2. …

## Builds
- [ ] 1. <copied from BLUEPRINT>
  - notes: <files, tests, commit>
- [ ] 2. …

## Tests
- [ ] …

## Done when (cloud)
- [ ] <criterion>
  - evidence: `<command>` → <key output>

## Done when (live, run by Marcus)
- [ ] <criterion>
  - result: <date, what Marcus reported>

### Live steps for Marcus
1. `<exact command>`
   - expect: <what success looks like>
   - report back: <what to paste or confirm>

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- …

## Skills to create
- …

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
- YYYY-MM-DD: …
