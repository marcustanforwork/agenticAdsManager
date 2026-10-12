---
name: deploy-worker
description: Deploy the worker and gateway containers to the SER9, check they are healthy, tag the deploy, and roll back if needed. Use when a merged milestone needs to go live, when Marcus says "deploy", "update the SER9", "roll back", or when a live step needs the stack running ("docker compose up", "restart the worker"). Production runs are Marcus's; a local session may run only the dev stack (ads-agent-dev) unless he explicitly says otherwise.
---

# Deploy the worker and gateway

The stack is `docker-compose.yml` (one image, two services: `worker`, `gateway`). Step-by-step commands for
Marcus are in `docs/runbook.md`; this skill is the checklist a session follows.

## Who may do what (D-058)

- **Production** (compose project `ads-agent`, Doppler `worker`/`gateway` tokens in `.env`): **Marcus only.** A
  session writes the commands for him; it never runs them, and never reads `.env`.
- **Dev** (`-p ads-agent-dev`, Doppler `dev` config): a local session may run it with Marcus's go-ahead.
- Never: `docker system prune`, `docker volume prune`, or touching other projects' containers.

## Before deploying

1. The commit is on `main`, CI is green on it, and its milestone's "Done when (cloud)" is ticked.
2. Read the milestone file's live steps: a migration (`db:migrate` with the Neon owner string) goes **before**
   `docker compose up`, and new settings must be in Doppler first (names in `docs/runbook.md` → Settings).
3. Note the currently deployed tag (`docs/memory/NOW.md` → Deployed): it is the rollback target.

## Deploy

```sh
git switch main && git pull --ff-only
docker compose up -d --build            # dev: docker compose -p ads-agent-dev up -d --build
docker compose ps                       # worker and gateway "healthy" within ~30 s
docker compose logs --tail 100 worker   # ready → startup reconciliation done → leader: starting …
```

Then, within 10 minutes, healthchecks.io shows `worker-alive` and `gateway-alive` green. If Telegram is set up, the
next notification arrives (a digest after 06:00 SGT, or `ads cycle --kind manual` to force a brief).

## Record it

- `git tag deploy-YYYY-MM-DD[-n] && git push origin deploy-YYYY-MM-DD[-n]` (Marcus, or a local session with his
  go-ahead; tags point at `main`, `docs/process/GIT-WORKFLOW.md` §tags).
- `docs/memory/NOW.md` → Deployed: the tag, the date, what it contains. `LOG.md`: one line.

## Roll back

```sh
git checkout deploy-<previous>
docker compose up -d --build
```

Migrations only add tables and columns until M16b, so older code runs on the newer schema. If a milestone ever
ships a destructive migration, its file must say how to roll back; don't improvise one. Afterwards: `git switch
main`, fix forward, deploy again, and record the rollback in `LOG.md`.

## Checks that prove it works (M07's live acceptance)

- 7 consecutive days with one `docker compose restart` and one host reboot, no manual help.
- Heartbeats green; SnapPool's digest every morning it spends, property's never (dormant); both weekly briefs on
  Monday 07:00 SGT.
- After a restart mid-cycle, the log shows `startup reconciliation done` with `cyclesResumed: 1`, and the cycle
  finishes (Telegram gets "The worker restarted and recovered its work").
