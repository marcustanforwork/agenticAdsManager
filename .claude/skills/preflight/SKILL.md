---
name: preflight
description: Checks to run before every push, before marking a PR ready, and at session end. They are the repo's automated checks plus a fast self-review against the project invariants (BLUEPRINT §8). Use whenever you are about to push meaningful changes, open a PR or mark one ready, or claim that something works.
---

# Preflight

## 1. Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check
```
CI also builds the Docker image and smoke-tests both entry points; cloud sessions can't (no Docker daemon), so watch that CI job after pushing a change to `Dockerfile`, `docker/` or an app's startup code.

Everything must be green, or the failure must be reported. **Never claim green without having seen the output.**

## 2. Fast grep checks

Each check should print nothing, except where it says "review each hit".

```bash
# Invariant 1: only the gateway may depend on write connectors
grep -lE '"@ads/connector-(google|meta)-write": "workspace' packages/*/package.json packages/packs/*/package.json apps/*/package.json 2>/dev/null | grep -v '^packages/gateway/'
# Invariant 2: no product names in shared code
grep -rniE 'snappool|property-sg|sora' packages/contracts packages/pack-sdk packages/core packages/gateway packages/connector-* packages/vault packages/db apps/web --include='*.ts' --include='*.tsx' --exclude-dir=dist 2>/dev/null
# Invariant 6: floats near money (review each hit)
grep -rnE 'parseFloat|Math\.round|Number\(' packages apps --include='*.ts' --exclude-dir=dist --exclude-dir=node_modules 2>/dev/null | grep -iE 'micros|spend|budget|amount|value'
# Invariant 13: anything shaped like a platform token (Meta EAA…, Google ya29./1//0…, API keys AIza…)
grep -rnE 'EAA[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9_-]{20,}|1//0[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}' --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null
# Invariant 13: email addresses in fixtures (review each hit)
grep -rnE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' fixtures 2>/dev/null
```

The paths match the workspace layout (`packages/*`, `packages/packs/*`, `apps/*`). The invariant-2 grep also runs on `packages/contracts` and `packages/pack-sdk`: shared code names no product.

## 3. Read your own diff adversarially

Run `git diff origin/main...HEAD` and ask:
- **What would make CI fail?** Types, lint, a test that depends on local state, a file you forgot to add.
- **Which invariant (BLUEPRINT §8) does this touch?** Check that one explicitly.
- **Did I change behaviour that the plan describes?** If so, run `update-plan`.
- **Did I claim anything done that isn't tested?**

Fix what you find **before** pushing. One validated push beats three speculative ones.

## 4. Memory

If the branch changes anything outside `docs/memory/`, then `docs/memory/NOW.md` and `docs/memory/LOG.md` must be updated before the PR is marked ready. The CI job `memory-check` enforces this.

## 5. Report

In the PR body's **Tests run** section, list the commands and their results. Failures stay visible until they are fixed.
