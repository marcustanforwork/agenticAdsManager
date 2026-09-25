---
name: start-milestone
description: Begin a blueprint milestone (M00–M16). Checks its prerequisites and the phase gate, creates its milestone file from the template, verifies the external facts it depends on, and slices it into PR-sized chunks. Use when NOW.md says the next milestone should start, or when the user says "start M05" or "next milestone".
---

# Start a milestone

## 1. Is it allowed to start?

- In `NOW.md`'s tracker, the previous milestone in the same phase is `done`, or is `awaiting live acceptance` with nothing that this milestone depends on.
- **Crossing into a new phase?** The previous phase gate must be recorded as *passed* in `NOW.md`. That is Marcus's call, recorded in `DECISIONS.md`. If it isn't, **stop and tell Marcus. Don't start.**
- Check **Needs** in `docs/plan/BLUEPRINT.md` §7: setup tasks (T-numbers), and decisions still waiting for Marcus's OK. If something is unmet, tell Marcus exactly what's missing. Start only the parts that don't depend on it (for example, code against documented API shapes with hand-written fixtures), and note that in the milestone file.

## 2. Create the milestone file

- Copy `docs/milestones/_TEMPLATE.md` to `docs/milestones/M<NN>-<slug>.md`. Take the slug from the BLUEPRINT title, e.g. `M03-google-read`.
- Fill it from BLUEPRINT §7: Goal, Needs, Read first, Builds (as checkboxes), Tests (as checkboxes), Done when (cloud and live), Cut first, Leave behind, Skills to create.
- **Copy the requirements; don't paraphrase them away.** Put your own clarifications underneath them.

## 3. Verify external facts

Run the `verify-external-facts` skill for every API, library or service the milestone touches. Record the results in `GOTCHAS.md`. If a fact has changed, fix the plan with the `update-plan` skill **before** building on it.

## 4. Slice into PRs

Group the Builds into 1–4 slices. Each slice should be independently green and reviewable, for example "client + fixtures", "methods 1–3", "CLI + acceptance". Write the slices into the milestone file. One session is roughly one slice.

## 5. Update memory and commit

- In `NOW.md`: set the active milestone, status `in progress`, and make the first item of slice 1 the **Next action**. Update the tracker.
- Commit `docs(m<NN>): start milestone — <title>`, then push.
