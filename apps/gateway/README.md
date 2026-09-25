# `@ads/app-gateway`

**Job:** The gateway process: apply loop, recovery and undo. Also the `ads-gw` CLI. The only process that may hold write credentials.

**May depend on:** `@ads/contracts`, `@ads/db`, `@ads/vault`, `@ads/gateway`.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
