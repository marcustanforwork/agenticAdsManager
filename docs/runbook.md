# Runbook (stub, M07; completed in M16b)

How to run the Ads Agent on the SER9. Plain commands, in the repo checkout (`~/agenticAdsManager` or wherever it lives). **Production** is the compose project `ads-agent` (the default in `docker-compose.yml`). **Development** is `-p ads-agent-dev` with `dev` Doppler tokens only (D-058). Never run global Docker clean-ups (`docker system prune`, `docker volume prune`): other projects share the machine.

## What runs

| Container | What it does | Health |
|---|---|---|
| `worker` | Startup reconciliation; the job queue (daily and weekly cycles); on the leader: the schedule (daily 06:00 SGT, weekly Monday 07:00 SGT), Telegram (sending, the brief buttons) and the notifications outbox | `GET 127.0.0.1:8081/healthz` inside the container; `worker-alive` heartbeat every 10 min; `daily-sync` after each daily run |
| `gateway` | M07: a stub that sends its `gateway-alive` heartbeat only. The apply loop arrives in M11b | `GET 127.0.0.1:8082/healthz`; `gateway-alive` every 10 min |

Both restart by themselves (`restart: unless-stopped`) after a crash, a `docker compose restart` or a reboot, as long as Docker starts on boot (Q2).

## Settings (names only; values live in Doppler)

Worker config: `DATABASE_URL` (Neon, **direct** host, not `-pooler`), `VAULT_READ_KEY`, `OPERATOR_ACTORS`, `SNAPPOOL_DATABASE_URL`, `ANTHROPIC_API_KEY` (and optional `MODEL_<STAGE>`), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID` (T7), `HEALTHCHECK_WORKER_URL`, `HEALTHCHECK_DAILY_SYNC_URL` (T8).
Gateway config: `HEALTHCHECK_GATEWAY_URL` (T8); optional `DATABASE_URL` (the heartbeat then checks the database first).
On the SER9, a `.env` file next to `docker-compose.yml` (never committed) holds one Doppler service token per process: `DOPPLER_TOKEN_WORKER=…`, `DOPPLER_TOKEN_GATEWAY=…`.

Without `DATABASE_URL` and `VAULT_READ_KEY` the worker runs its health endpoint only. Without the Telegram settings, notifications stay queued in the database (nothing is lost) until they are set.

## Start, stop, logs, restart

```sh
docker compose up -d --build        # start, or update after a git pull
docker compose ps                   # both "healthy" after ~20 s
docker compose logs -f --tail 200 worker
docker compose stop                 # clean stop: SIGTERM, 30 s grace; a running cycle stops between stages
docker compose restart worker       # the worker resumes an interrupted cycle at startup
```

What healthy looks like in the worker log (JSON lines): `ready`, `startup reconciliation done`, then on the leader `leader: starting the schedule, Telegram and the outbox`. After 06:00 SGT: `daily cycles done`.

## Run something by hand

```sh
docker compose exec worker ads-entrypoint ads digest --product snappool      # preview today's digest (nothing sent)
docker compose exec worker ads-entrypoint ads brief --product snappool       # the latest brief, as stored
docker compose exec worker ads-entrypoint ads cycle --product snappool --kind manual   # a full manual cycle; its brief is queued and sent
```

## Upgrade

1. `git pull` on `main` (only merged, CI-green commits).
2. If the release adds a migration, run it with the Neon **owner** string, as M01a's live step 5 does: `read -rs DATABASE_URL && export DATABASE_URL`, then `pnpm --filter @ads/db db:migrate && unset DATABASE_URL`.
3. `docker compose up -d --build`, then `docker compose ps` and the log lines above.
4. Tag what is deployed: `git tag deploy-YYYY-MM-DD && git push origin deploy-YYYY-MM-DD`; note the tag in `docs/memory/NOW.md` ("Deployed").

## Roll back

1. `git checkout deploy-<previous date>` (the last good tag).
2. `docker compose up -d --build`.
3. Migrations only add things until M16b, so the older code runs on the newer schema. If a release ever needs a down-migration, its milestone says so.
4. `git switch main` once the fix is merged; deploy again.

## When something is wrong

- **Heartbeat alert (`worker-alive` or `gateway-alive`):** `docker compose ps`; `docker compose logs --tail 200 <service>`; `docker compose restart <service>`. Database unreachable shows as `database unreachable: heartbeat reports a failure`.
- **`daily-sync` late or failed:** `docker compose logs worker | grep -E 'daily cycles done|job failed'`; then `ads cycle --product <slug> --kind daily` by hand to see the summary.
- **No Telegram messages:** check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID` in Doppler; the log says `no TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID` if they are missing. Queued messages go out once they are set.
- The `incident` skill has the fuller checklist.
