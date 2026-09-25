# `@ads/app-worker`

**Job:** The worker process: scheduler, job runner, Telegram bot and request processor. Also the `ads` CLI. Holds **no** write capability.

**May depend on:** `@ads/contracts`, `@ads/db`, `@ads/vault`, `@ads/core`, `@ads/pack-sdk`, and the packs. **Not** `@ads/gateway`, **not** any `*-write` package.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
