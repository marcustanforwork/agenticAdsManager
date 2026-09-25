# `@ads/gateway`

**Job:** The only write path to the ad platforms: allowlist, guards, fingerprint, two-phase apply, verify, undo (BLUEPRINT §6). Built in M11a/M11b.

**May depend on:** `@ads/contracts`, `@ads/db`, `@ads/vault` and all four connectors; `@ads/connector-testing` as a devDependency.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
