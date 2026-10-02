---
name: record-fixture
description: Write, record or refresh the API fixtures (cassettes) the platform connectors replay in tests. Use when building or changing a connector method, when Meta or Google changes a response shape, when upgrading the pinned API version, when the M02/M03 live steps record real fixtures, or when a fixture test fails ("record fixtures", "refresh the Meta fixtures", "the replay test can't find a fixture").
---

# Record and maintain connector fixtures

A **cassette** is one JSON file of HTTP exchanges (`@ads/connector-testing`, `Cassette`): `source`, optional
`notes`, and `exchanges[]` of `{ request: { method, path, query }, response: { status, headers, body } }`.
The path has no API version prefix, and the query never holds `access_token` or `appsecret_proof`, so a version
bump or a different token still matches.

## 1. Layout

- Meta: `packages/connector-meta/fixtures/meta/`
  - hand-written cassettes (`account.json`, `entities.json`, `metrics-*.json`, `snapshot.json`, `trust.json`), whose
    `source` says "hand-written from … documented shapes";
  - `recorded/`: real recordings plus `manifest.json` (account, range, `recordedAt`, dataset, conversion types,
    snapshot refs). `test/recorded.test.ts` replays everything in it automatically, and is skipped while it's empty.
- Google (M03): the same layout under `packages/connector-google/fixtures/google/`.

## 2. Hand-written fixtures (cloud sessions)

- Build the bodies from the platform's documented response shapes (verify them with `verify-external-facts`), using
  fictional ids and names. Write them with a short script or by hand, then `pnpm format`.
- The query must be **exactly** what the client sends (same `fields` string, `limit`, JSON `time_range`). When the
  replayer says `no fixture for GET …`, the message prints the key it wanted and the keys it has: copy from it.
- Each identical request is served once per recorded copy, in order. A test that makes the same call twice needs
  two copies (e.g. the account read in `trust.json`).
- To test a date window computed from "now", shift the `time_range` in the test (see `core/test/dryRun.test.ts`)
  rather than writing a cassette per date.

## 3. Real recordings (Marcus, or a local session with his explicit go-ahead)

- **Read credentials only** (`ads_read`), never a write token. Never in a cloud session.
- Meta:
  ```bash
  RECORD=1 META_CREDENTIAL=/path/to/token.json \
    pnpm --filter @ads/connector-meta record --account act_… [--dataset <id>] [--events Lead] [--days 7]
  ```
  `token.json` is `{ "accessToken": "…", "appSecret": "…" }`, the same file given to `ads credentials put`.
  Keep it outside the repo and delete it afterwards.
- Then `pnpm test` (the recorded replay test runs), check `git diff` for anything personal, commit the
  `recorded/` files, and fix any difference between the docs and reality in the connector (and the hand-written
  fixtures, if the shape was wrong). Record what changed in GOTCHAS.

## 4. Redaction rules (enforced in code)

- The recorder (`recordingFetch` + `Redactor`) drops secret query parameters and JSON keys, replaces tokens
  (`EAA…`, `ya29.…`, `1//…`) and emails, replaces the values of name-like keys (`name`, `email`, `owner`, …)
  with stable placeholders (`redacted name 3`), and keeps only the rate-limit and content-type headers.
- `saveCassette` refuses to write a file in which `findSecrets` finds anything.
- `test/fixtures.test.ts` scans **every** file under the fixtures directory on every test run.
- Never weaken a redaction rule to make a recording pass. If something personal survives, add a rule and a test.

## 5. Upgrading the pinned API version

Change the version constant (Meta: `GRAPH_API_VERSION` in `connector-meta/src/version.ts`), update its GOTCHAS row,
re-record (step 3), and fix the differences. Fixtures don't need editing for the version itself.
