# Git workflow

How work moves from a Claude session (cloud or local) into `main`, so that **any session can pick up exactly where the last one stopped**. It goes with `SESSIONS.md` (the memory system) and the `start-session` / `end-session` skills.

---

## 1. Principles

1. **GitHub is the only shared memory.** Cloud containers are wiped and local machines differ. Work that isn't pushed doesn't exist for the next session.
2. **`main` is always green.** It is only changed through PRs with passing checks, so every session can safely start from it.
3. **Small PRs, one per session.** One session = one milestone (or milestone part) = one PR (D-056). Each working session ends with a PR (draft if unfinished). This is a **standing instruction from Marcus** (also stated in `CLAUDE.md`). Marcus reviews. A PR is merged only when he says so, after CI passes (D-057, §8).
4. **Every PR updates the memory.** A PR that changes code or the plan also changes `docs/memory/NOW.md` and `docs/memory/LOG.md`. CI checks this.
5. **The plan is code.** `PROPOSAL.md` and `BLUEPRINT.md` change only through PRs, with a decision recorded in `DECISIONS.md` (the `update-plan` skill).
6. **No secrets, ever.** Not in commits, fixtures, logs, PR text or memory files.

---

## 2. Branches

| Branch | Who | Purpose |
|---|---|---|
| `main` | protected | Always green; the base for new work; deployed from (from M07) |
| `claude/<name>` | cloud sessions | Assigned automatically by Claude Code on the web. Use the assigned name; don't rename it. |
| `m<NN>/<short-slug>` | local sessions | e.g. `m03/gaql-builder`. Chosen by the session. |
| `plan/<slug>` | either | Plan-only changes (proposal, blueprint, process docs) |
| `fix/<slug>` | either | A fix to something already merged, outside the current milestone |

- **One branch = one PR = one session = one milestone (or part).** If a session hits the 600k hard stop, its PR stays a draft, and the next session continues it (§4).
- Merged branches are deleted automatically (repo setting, §9). So any `claude/*` or `m*/` branch still on GitHub is **unfinished work**, either an open PR or an abandoned attempt.

---

## 3. Which branch does a new session build on?

The SessionStart hook prints where the newest memory is. The `start-session` skill then decides:

```
Newest docs/memory/NOW.md is on…
├── origin/main ──────────────────────▶ start from origin/main (normal case: the last PR was merged)
└── a work branch (unmerged PR) ─────▶ CONTINUE that work (§4) — don't start parallel work from main
    If several work branches exist, the newest NOW.md wins; list the others to Marcus
    (merge them, close them, or keep them) rather than guessing.
```

**Why:** starting from `main` while a newer unmerged branch exists would redo or contradict that work, and the memory would split in two.

---

## 4. Continuing unmerged work

The normal flow is: session ends → PR open → Marcus merges → next session starts from `main`. If Marcus hasn't merged yet (or the PR needs more work), the next session continues the branch:

**Local session**, which can push to any branch:
```bash
git fetch origin
git switch <work-branch>            # e.g. claude/gifted-franklin-hk0fku or m03/gaql-builder
git pull --ff-only
# … work, commit, push to the same branch → the same PR updates
```

**Cloud session**, which must push to the branch the harness assigned:
```bash
git fetch origin
git log --oneline origin/main..HEAD          # must be EMPTY (the assigned branch has no work of its own yet)
git reset --hard origin/<work-branch>        # safe only because of the check above
# … work, commit, push to the ASSIGNED branch
# Open a new PR "… (continues #<old>)" and close the old PR with a comment "Superseded by #<new>".
```
The new PR contains all the old commits plus the new ones, so nothing is lost and the history stays linear. If the assigned branch *already* has commits (a resumed session), don't reset. Continue on it as it is.

**Exception: the assigned branch's PR is already merged.** This happens when a cloud session is cleared and reused after its PR was merged. A squash merge leaves the branch's old commits counted as "ahead" of `main`, though their content is already on `main`. Confirm the PR is merged (GitHub MCP `pull_request_read`), then:
```bash
git fetch --prune origin
git reset --hard origin/main
git push --force-with-lease -u origin <assigned-branch>   # only merged history is overwritten
```
Never do this while the branch has commits that aren't merged.

**If the work branch is behind `main`** (other PRs merged meanwhile): merge `origin/main` into it (`git merge origin/main`), resolve conflicts, run the checks, and push. Don't rebase or force-push a branch that has an open PR someone may have checked out.

---

## 5. Commits

**Format: [Conventional Commits](https://www.conventionalcommits.org/)** with the milestone or area as scope:

```
<type>(<scope>): <what changed, imperative, ≤ 72 chars>

<why — the reason, not a restatement of the diff. Wrap at 72.>

<trailers added by the environment, e.g. Co-Authored-By>
```

| Type | For |
|---|---|
| `feat` | new behaviour |
| `fix` | a bug fix |
| `test` | tests only |
| `refactor` | no behaviour change |
| `docs` | documentation, plan, memory |
| `chore` | tooling, dependencies |
| `ci` | CI workflows |
| `build` | Docker, build config |

**Scopes:** `m00` … `m16` for milestone work, including the part letter where there is one (`m05a`, `m05b`); `memory` for memory-file updates; `plan` for PROPOSAL/BLUEPRINT/process; `ci`, `deps`, `hooks`, `skills`.

Examples:
- `feat(m03): add GAQL query builder with field allowlist`
- `test(m11): property tests for the magnitude guard`
- `docs(memory): session handoff — M03 builds 1-3 done, 4 next`
- `docs(plan): switch Google uploads to the Data Manager API (D-028)`

**Rhythm:**
- Commit after each completed Build item or logical step, and never leave a session with uncommitted work.
- **Push at least every 30–60 minutes** and at every checkpoint. A cloud container can disappear at any time, and a local machine can crash.
- Each commit should leave the branch compiling. If you must commit something broken, say `WIP:` in the subject and fix it before the PR is marked ready.

---

## 6. CI checks

| Workflow | Runs on | Checks | From |
|---|---|---|---|
| `memory-check.yml` | every PR | If the PR changes anything outside `docs/memory/`, then `docs/memory/NOW.md` **and** `docs/memory/LOG.md` must be changed too. Skip with the label `skip-memory-check` (tiny fixes by Marcus). | now |
| `ci.yml` | every PR and push to `main` | install → typecheck → lint → check:boundaries → test → build → docker build; gitleaks secret scan | M00 |
| eval regression | PRs touching `packages/core/src/model`, `packages/packs/*`, prompts | replay eval vs `main`; fails beyond a noise-aware threshold | M16 |

**A red check is work, not waiting.** Fix it in the same PR. Never skip or disable a test to get green. If a failure is caused by something outside the PR, say so in the PR and in `NOW.md`.

---

## 7. Pull requests

- **Open early as a draft**, right after the first push of a session, so the work is visible even if the session dies.
- **Title:** `[M03] Google read connector: GAQL builder + campaign sync`, or `[plan] …` / `[memory] …` / `[fix] …`.
- **Body:** `.github/pull_request_template.md`:
  - what and why;
  - milestone items done;
  - tests run, with results;
  - what was cut or moved;
  - plan changes;
  - **live steps for Marcus**;
  - invariants checked;
  - memory updated.
- **Mark ready** when the preflight checks pass and the milestone items claimed in the PR are really done.
- **One PR per session.** When continuing someone else's unmerged PR from a cloud session, supersede it (§4). Otherwise push to the same branch.
- **Tools:** local sessions may use `gh`; cloud sessions use the GitHub MCP tools (`create_pull_request`, `update_pull_request`, …). Both do the same thing.

---

## 8. Review and merge

**Marcus reviews every PR.** It's merged when he says so: either he merges it, or he tells Claude to. Claude merges **only on his explicit instruction, and only after every check is green** (D-057). Otherwise the PR waits, however long.

What to look at, in order:
1. the PR body's **Live steps** (do they need doing now?);
2. the **Plan changes** section;
3. the diff of `docs/memory/NOW.md` (is the next step right?);
4. the code.

**Merge method: squash and merge.** One commit per PR on `main`, titled like the PR. The branch is deleted automatically.

After merging, the next session starts from `main` and finds everything in `docs/memory/`. When Claude merges from a cloud session, it then resets its assigned branch to `origin/main` and, if the branch still exists on GitHub, pushes it with `--force-with-lease` (§4, the exception), so a cleared session starts clean. A local session switches to `main` and pulls.

---

## 9. Repository settings (setup task T1, one-time, done by Marcus in GitHub → Settings)

- **Branches → Add rule for `main`:**
  - require a pull request before merging;
  - require status checks to pass (`memory-check` now; add `ci` after M00);
  - block force pushes;
  - block deletions.
- **General → Pull Requests:**
  - allow **squash merging** only;
  - enable **Automatically delete head branches**;
  - optionally, allow auto-merge.
- **Actions → General:**
  - allow GitHub Actions;
  - set workflow permissions to "Read repository contents".
- **Secrets:** none are needed for CI until M16. Never add production platform credentials to GitHub.

---

## 10. Tags and releases

| Tag | When | Who |
|---|---|---|
| `m<NN>-done`, e.g. `m05b-done` | A milestone (or part) is closed (all cloud "Done when" met and live acceptance confirmed) | Claude when asked, or Marcus |
| `phase-<N>-exit` | A phase gate passes | Marcus decides; either creates the tag |
| `deploy-YYYY-MM-DD[-n]` | A commit is deployed to the SER9 (from M07) | Marcus or a local session with his go-ahead |

Tags always point at commits on `main`. `docs/memory/NOW.md` records the currently deployed tag. From M07, the `deploy-worker` skill describes building and deploying an image and rolling it back. The dashboard deploys through Vercel's Git integration (from M10a): production from `main`, and protected previews from PR branches.

---

## 11. Database migrations (from M01a)

- Migrations are **forward-only** and generated with Drizzle (`pnpm db:generate`). **Never edit a migration that has been merged.** Write a new one instead.
- A PR that adds a migration says so in its title (`[M05] … (+migration)`) and in the body.
- Migrations are applied to the Neon `dev` branch by Marcus or a local session, and to `prod` as part of a deploy. They are never applied from a cloud session, which has no DB credentials.
- The `db-migration` skill (created in M01a) covers the details.

---

## 12. Changing the plan

Use the `update-plan` skill. In short:
1. Record the decision in `DECISIONS.md`.
2. Update `PROPOSAL.md` and/or `BLUEPRINT.md` consistently.
3. Search for stale references.
4. Bump the version line.
5. Mention it under **Plan changes** in the PR.

Plan changes can ride along in a milestone PR, or go in their own `plan/` PR if they're large. A decision marked *(Marcus)* is only reversed with his explicit OK.

---

## 13. Secrets and data hygiene

- `.gitignore` covers `.env*`, local Doppler files and other local state.
- Fixtures are scrubbed when recorded (M02). Review fixture diffs for anything that looks like a token, an email or a name.
- From M00, CI runs gitleaks on every PR.
- If a secret is ever committed, **rotate it first** (revoke it at the provider), then remove it from history with Marcus. Removing it from history alone is not enough.

---

## 14. Parallel sessions

**Default: one working session at a time.** Two sessions editing `NOW.md` on different branches produce conflicting memories.

If parallel work is unavoidable:
- give each session a **different milestone** (or a different package);
- each writes its own section of `NOW.md`, under `## In flight`;
- whoever merges second resolves the `NOW.md` conflict by keeping both sections and re-checking "Next action";
- `LOG.md` conflicts: keep both entries, in date order.

---

## 15. Quick reference

```bash
# See where things stand (the SessionStart hook does this for you)
git fetch origin --prune
git log --oneline -5 origin/main
git branch -r | grep -v -e 'origin/main' -e 'origin/HEAD'   # unfinished work branches

# Push (retry on network errors: wait 2s, 4s, 8s, 16s)
git push -u origin <branch>

# Bring main into a long-running branch
git fetch origin && git merge origin/main
```
