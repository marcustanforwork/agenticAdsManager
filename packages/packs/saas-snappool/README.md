# `@ads/pack-saas-snappool`

**Job:** The SnapPool product pack: `src/manifest.ts` (pure data, no I/O imports) and `src/runtime.ts` (the outcome adapter). Built in M05a.

**May depend on:** `@ads/contracts`, `@ads/pack-sdk`, plus its own adapter libraries (e.g. `pg`). **Never** a connector, core, gateway or db.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
