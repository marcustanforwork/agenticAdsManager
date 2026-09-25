# `@ads/app-web`

**Job:** The dashboard and settings UI (Next.js on Vercel, from M10a). It only reads, and inserts operator requests.

**May depend on:** `@ads/contracts`, `@ads/db`, **nothing else**, and its whole internal dependency tree must stay those two (invariant 10).

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
