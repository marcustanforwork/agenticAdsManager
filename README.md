# agenticAdsManager

An AI **ads assistant with a supervised hand** for Marcus's products. It:
- reads the Google Ads and Meta ad accounts;
- sends a short daily digest and a weekly report;
- points out wasted money, and suggests specific changes.

**Nothing changes in an ad account until Marcus approves it.** Approved changes are made by one guarded, audited component that can undo them.

**Status (2026-09-25):** planning is complete (plan v3), and the build starts at milestone M00. See [`docs/memory/NOW.md`](docs/memory/NOW.md) for where things stand right now.

## Start here

| If you want… | Read |
|---|---|
| The idea in one page | [`docs/plan/PROPOSAL.md`](docs/plan/PROPOSAL.md) §0 |
| What the latest review found and changed | [`docs/plan/CHANGES-v3.md`](docs/plan/CHANGES-v3.md) |
| The full plan: what and why | [`docs/plan/PROPOSAL.md`](docs/plan/PROPOSAL.md) |
| How it will be built: 17 milestones | [`docs/plan/BLUEPRINT.md`](docs/plan/BLUEPRINT.md) |
| Where the build stands | [`docs/memory/NOW.md`](docs/memory/NOW.md) |
| Questions waiting for Marcus | [`docs/memory/QUESTIONS.md`](docs/memory/QUESTIONS.md) |
| Every decision and why | [`docs/memory/DECISIONS.md`](docs/memory/DECISIONS.md) |

## Working on it with Claude Code

- **Cloud or local,** open a session on this repo and say **"continue"**. The session loads `docs/memory/NOW.md` automatically. A startup hook finds the newest work, even on an unmerged branch or in a stale local clone, and the `start-session` skill carries on from there.
- **Every session ends by updating `docs/memory/`,** pushing to GitHub and opening or updating a PR, so the next session can continue from anywhere.
- **Details:**
  - how sessions and the memory work: [`docs/process/SESSIONS.md`](docs/process/SESSIONS.md);
  - branches, commits and PRs: [`docs/process/GIT-WORKFLOW.md`](docs/process/GIT-WORKFLOW.md);
  - skills: [`docs/process/SKILLS.md`](docs/process/SKILLS.md).

## Layout

```
CLAUDE.md          rules for Claude sessions (auto-loaded; imports docs/memory/NOW.md)
docs/plan/         PROPOSAL (what/why) · BLUEPRINT (how) · CHANGES-v3 (review)
docs/memory/       NOW · LOG · DECISIONS · GOTCHAS · QUESTIONS
docs/milestones/   one progress file per started milestone
docs/process/      git workflow · sessions and memory · skills
docs/archive/      superseded plan versions (v2.1)
products/<slug>/   starting templates for STRATEGY / PLAYBOOK / LEARNINGS
.claude/           skills and hooks for Claude Code
.github/           PR template, CI checks
```

The code (`packages/`, `apps/`) arrives from milestone M00 onwards.
