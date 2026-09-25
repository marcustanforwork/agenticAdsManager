---
name: end-session
description: Save the session's state so the next session (cloud or local) can continue. Updates the memory files, commits, pushes, and opens or updates the PR. Use before ending any working session; at the ~550k-token checkpoint or the 600k hard stop; before a long wait; when the user says "wrap up", "stop", "pause", "handoff" or "that's it for today"; or when the Stop hook says memory is behind.
---

# End a session (handoff)

The test: **could a fresh session, cloud or local, continue in under 5 minutes using only the files?**

## 1. Check the work

Run the `preflight` skill. Record failures honestly, in the PR and in `NOW.md`. Never claim something is green without having seen the output.

## 2. Update the milestone file (in `docs/milestones/`, e.g. `M05a-pack-sdk-snappool.md`)

- Tick finished items, with a one-line note each: the files and tests involved.
- A half-done item stays unticked. Write exactly what exists and what's missing.
- A cut item is written as `Cut → M<XX>` in the **Cut / moved** table. An item that was already moved once can't move again: do it, or ask Marcus.
- Add verify commands, and any **Leave behind** notes you now know.

## 3. Rewrite `docs/memory/NOW.md`

Keep its headings. The current file is the template. It must contain:
- **Last updated:** date, environment (cloud or local), branch, PR link.
- **Where we are:** phase, active milestone, one-line status.
- **Next action:** numbered and executable (file + function + failing test), each with an owner (Claude or Marcus).
- **In flight:** branch, PR, and its state (draft, ready, awaiting merge).
- **Blocked on Marcus:** question ids, setup tasks, live steps.
- **Live steps for Marcus:** exact commands and what to report back, or "none".
- **Deployed:** what runs on the SER9 (from M07).
- **Milestone tracker** and **Phase gates:** updated.

Keep it to ~90 lines. Detail belongs in the milestone file, history in `LOG.md`.

## 4. Add a `LOG.md` entry on top

```
## YYYY-MM-DD — <short title>
- **Where:** cloud|local · branch `<branch>` · PR <link or "none yet">
- **Did:** <facts, with file paths>
- **Decided:** D-xxx … (or "—")
- **Learned:** GOTCHAS entries added (or "—")
- **Next:** <the first Next action>
- **Open:** Q-ids / blockers (or "—")
```

## 5. Other memory files (only if something happened)

- A decision was made or changed: add it to `DECISIONS.md`, via the `update-plan` skill if the plan changes.
- A surprise about an API, tool or the environment: add it to `GOTCHAS.md`, dated, with its source.
- You need something from Marcus: add it to `QUESTIONS.md`, with the options and your recommendation.

## 6. Commit and push

```bash
git add -A && git status --short        # review the list: no secrets, no stray files
git commit -m "docs(memory): session handoff — <summary>"
git push -u origin <branch>             # on a network failure, retry after 2s, 4s, 8s, 16s
```

At the **600k hard stop**, commit whatever state you're in anyway. Start the subject with `WIP:`, say whether tests are red, and push. The next session continues the same milestone part.

## 7. Open or update the PR

Marcus's standing instruction (`CLAUDE.md`) is that every working session ends with a PR.
- **No PR yet:** create one (a draft if the work is unfinished) using `.github/pull_request_template.md`. Cloud: GitHub MCP `create_pull_request`. Local: `gh pr create --draft`, or the web UI.
- **A PR already exists:** update its title and body (`update_pull_request` or `gh pr edit`).
- **You continued someone else's unmerged branch from a cloud session:** open a new PR "… (continues #N)", then close #N with the comment "Superseded by #M".
- **Marcus said not to open PRs in this session:** skip this step, and say so.

## 8. Tell Marcus, in plain words and briefly

- what shipped, and what didn't;
- what's next;
- what he needs to do: answers (by Q-id), live steps, merging the PR.
