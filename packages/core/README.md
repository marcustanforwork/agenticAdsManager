# `@ads/core`

**Job:** The product-agnostic engine: cycle, sync, trust checks, detectors, the AI layer (`core/model`), analyst, drafting, briefs, settings, operator requests, attribution, queue and recovery. **Never imports a pack and never names a product.**

**May depend on:** `@ads/contracts`, `@ads/db`, `@ads/vault`, `@ads/connector-google`, `@ads/connector-meta`, `@ads/pack-sdk`; `@ads/connector-testing` as a devDependency.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
