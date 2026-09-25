---
name: close-milestone
description: Finish a blueprint milestone. Proves its "Done when (cloud)" criteria, reviews the invariants over the milestone's full diff, records cuts and where they moved, writes the "Leave behind" notes, and hands the live acceptance steps to Marcus. Use when every Build item of the active milestone is ticked or explicitly cut, or when the user asks to close or wrap up a milestone.
---

# Close a milestone

## 1. Every item accounted for

In the milestone file (e.g. `docs/milestones/M05a-pack-sdk-snappool.md`), every Build and Test item is either ticked or cut with a destination milestone. An item may move **once**. If it was already moved into this milestone, it can't be cut again: do it, or ask Marcus.

## 2. Prove "Done when (cloud)"

Run each listed check. Paste the command and the key lines of its output into the milestone file under **Evidence**. Then run the full `preflight` skill.

## 2b. Code review (D-067)

Run the `code-review` skill at **high** effort over the whole milestone diff (`origin/main...HEAD`). For each finding:
- **Confirm it** against the code. For a bug, write a test that fails on the old code.
- **Fix it**, or record why not in the milestone file's Notes and in the PR (e.g. "efficiency only; not worth the risk").
- Security-sensitive milestones (M01b, M10a, M11b, M12, M13) also run `security-review`.

Re-run the full `preflight` after the fixes.

## 3. Review the invariants (BLUEPRINT §8)

Review the **whole milestone's** changes, not just the last PR:

```bash
git log --oneline --grep='(m05a)' origin/main        # use this milestone's scope, e.g. m03 or m05a, to find where it started
git diff <first-milestone-commit>^..HEAD --stat       # then read the risky parts
```

Answer all 16 invariants, yes or no, in the milestone file's table. **Any "no" means the milestone isn't done.**

## 4. Leave behind

Write every **Leave behind** item that BLUEPRINT asks for: pinned API versions, prompts, the command grammar and so on. Durable technical facts also go in `GOTCHAS.md`. If this milestone creates a domain skill (`docs/process/SKILLS.md` §2), write it now, from the real code.

## 5. Is the plan still true?

If the implementation departed from BLUEPRINT (a renamed field, an added table, a changed flow), run the `update-plan` skill, so the next milestone doesn't read stale instructions.

## 6. Hand over live acceptance

- Write **Live steps for Marcus** (exact commands, the expected output, what to report back) in three places: the milestone file, `NOW.md` and the PR body.
- Set the status to `awaiting live acceptance`, or to `done` if there are no live steps.
- When Marcus confirms (a later session records it), set the status to `done`, and ask him whether to tag `m<NN>-done` on `main`.

## 7. Phase exit?

If the milestone ends a phase (M07, M10b, M13, M14, M15b), add the phase gate to `NOW.md` as `measuring`, with its start date and how it is measured (`PROPOSAL.md` §12). The next phase starts only after Marcus records the gate as passed.

## 8. Update memory

Update the `NOW.md` tracker and **Next action** (the next milestone, or "waiting for gate"). Add a `LOG.md` entry, then commit, push and update the PR.
