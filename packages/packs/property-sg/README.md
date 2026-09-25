# `@ads/pack-property-sg`

**Job:** The Property SG product pack: `src/manifest.ts` (pure data) and `src/runtime.ts` (the outcome adapter). Built in M05b.

**May depend on:** `@ads/contracts`, `@ads/pack-sdk`, plus its own adapter libraries. **Never** a connector, core, gateway or db.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
