---
name: incident
description: Handle something going wrong in production: a heartbeat alert, a missing or wrong digest or brief, a cycle that keeps failing, a suspected leaked token, or (from Phase 2) a bad change to an ad account. Stop the harm first, then find the cause from the logs and the database, fix forward or roll back, and write it up. Use when Marcus says "something's wrong", "the digest didn't come", "healthchecks is red", "halt everything", "revoke the token", or reports odd numbers.
---

# Incident

Order: **stop the harm → understand → fix → write it up.** Production actions are Marcus's (D-058): a session tells
him exactly what to run and reads what he pastes back. Never paste tokens, connection strings or personal data into
the conversation, the repo, logs or PR text.

## 1. Stop the harm

| Situation | Do this now |
|---|---|
| The agent is changing ad accounts wrongly (Phase 2+) | Halt: Telegram `/halt` (M09b) or the dashboard's halt (M10a); `writes_enabled = false` in `system_flags`. Until those exist there are no writes at all. |
| Spend is running away | Marcus pauses the campaign in Ads Manager / Google Ads directly. The Meta account spending limit is the hard backstop (D-063). |
| A token or key may have leaked | Revoke it at the source (Meta Business settings, Google Cloud, Anthropic, Telegram BotFather `/revoke`, healthchecks.io), then rotate in Doppler and `ads credentials put` / `ads-gw credentials put`. Rotate the vault master key only by its documented procedure. |
| The worker is crash-looping | `docker compose stop worker` (it is read-only in Phase 0–1: stopping it loses nothing; queued notifications wait in the database). |

## 2. Understand

- `docker compose ps` and `docker compose logs --tail 300 worker` (JSON lines: look for `job failed`,
  `startup reconciliation`, `heartbeat`, `leader`).
- The cycle: `ads cycle --product <slug> --kind daily` prints its summary (or `already_finished`); `ads findings`,
  `ads brief`, `ads digest` show what it produced.
- The database (Neon SQL editor, read only): `cycles` (stage_reached, trust_result, error), `trust_checks`,
  `jobs` (status, attempts, last_error), `notifications` (sent_at null = not sent yet), `operator_requests`.
- Heartbeats: `worker-alive` silent = process down or database unreachable; `daily-sync` late = the daily job
  didn't finish (see `jobs`); `/fail` = a product's cycle failed (the log names it).
- Check `docs/memory/GOTCHAS.md` before assuming a platform bug; verify external facts with
  `verify-external-facts`.

## 3. Fix

- Code bug: a normal PR (tests that fail on the old code), merged when Marcus says so, then `deploy-worker`.
- Bad deploy: roll back with `deploy-worker` (the previous `deploy-…` tag).
- Bad settings: `ads settings set` (an operator request; the processor validates it).
- A wrong change to an ad account (Phase 2+): `ads-gw revert` through the gateway (M11b), never by hand in the database.

## 4. Write it up

`docs/memory/LOG.md`: what happened, when, the impact, the cause, the fix, and what stops it happening again (a
test, a guard, a GOTCHAS entry). If it changed a decision, record it with `update-plan`.
