# `@ads/connector-testing`

**Job:** Fixture recorder, replayer and redactor for the platform connectors. Built in M02.

**May depend on:** `@ads/contracts`.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).

## What's here

- `Cassette` / `Exchange`: the fixture format (`src/cassette.ts`). Paths drop the API version; queries drop secrets.
- `replayFetch(cassettes)`: a `fetch` that serves recorded exchanges and rejects anything else (`UnmatchedRequestError`).
- `recordingFetch(fetch)` + `saveCassette(file, cassette)`: record redacted exchanges; refuse to write a secret.
- `Redactor`, `redactString`, `findSecrets`: the redaction rules and the scanner every fixture must pass.

How to use them: the `record-fixture` skill.
