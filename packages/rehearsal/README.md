# `@ads/rehearsal`

**Job:** The pre-live rehearsal (F3, D-092): the first live weekend, run end to end in CI on the fixture accounts and a fresh database, plus a check of every command in the live steps. Test-only: no `src`, nothing imports it, nothing of it is deployed.

**May depend on (devDependencies only):** the worker and the dashboard apps (`@ads/app-worker`, `@ads/app-web`, through their source-only `exports`), `@ads/contracts`, `@ads/db`, `@ads/core`, `@ads/vault`, `@ads/connector-google` (its token URL), `@ads/connector-testing`, and `@ads/pack-saas-snappool` (its fixture database). It is the one package that sees the worker and the dashboard together; `apps/web`'s own tree is unchanged.

What it fakes, and nothing else: the ad platforms (the connectors' cassettes), Google's token endpoint, SnapPool's database (a throwaway database with SnapPool's tables), the AI model, Telegram (a fake API; presses and messages go to the bot's own handlers), the healthchecks pings and the clock.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
