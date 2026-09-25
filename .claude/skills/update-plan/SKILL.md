---
name: update-plan
description: Change the plan (PROPOSAL.md, BLUEPRINT.md, the process docs, CLAUDE.md, skills) safely and consistently. Use when Marcus makes or changes a decision or answers a question in QUESTIONS.md, when a milestone's scope changes, when implementation shows the plan is wrong or stale, or when an external fact (API, library, pricing) turns out different from what the plan says.
---

# Update the plan

The plan is code. It changes only through a commit that records the decision, and every document that mentions the changed thing is updated in that same commit.

## 1. Who decides

- **Marcus** decides product and risk questions. Decisions marked *(Marcus)*, or listed as **needs OK**, change only with his explicit answer: in chat, in a PR comment, or in `QUESTIONS.md`.
- **Claude** may fix clear errors, contradictions and outdated facts on its own, but must record them (step 2) and mention them in the PR.
- **Unsure?** Add a question to `docs/memory/QUESTIONS.md` with the options and your recommendation. Keep working on anything that doesn't depend on the answer.

## 2. Record the decision in `docs/memory/DECISIONS.md`

Use the next free number (`D-NNN`) and the entry format at the top of that file. **Never edit the substance of an old decision.** Add a new one with **Supersedes: D-xxx**, and mark the old one **Superseded by D-NNN**.

## 3. Update every place it appears

- `docs/plan/PROPOSAL.md`: the what and why.
- `docs/plan/BLUEPRINT.md`: contracts, schema, mechanics, milestones, invariants.
- `docs/process/*`, `CLAUDE.md`, `.claude/skills/*`: only if the process changed.
- The active milestone file: if its Builds, Tests or "Done when" changed.

To find stale references:
```bash
grep -rn "<old term>" docs CLAUDE.md README.md .claude
```
If a question was answered, move it to **Answered** in `QUESTIONS.md`, with the date and the D-number.

## 4. Version line

Bump the version in the header of each plan document you changed (v3.0 → v3.1; a big restructure → v4.0), and set the date.

## 5. Commit and tell

- Commit as `docs(plan): <what changed> (D-NNN)`.
- In the PR body's **Plan changes** section, add one line per decision.
- If the change affects a finished milestone (a schema change, for example), add the follow-up work to the right milestone file or to `NOW.md`. Never leave the code and the plan silently disagreeing.
