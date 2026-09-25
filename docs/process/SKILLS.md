# Skills

A **skill** is a folder `.claude/skills/<name>/` containing a `SKILL.md`. Its short `description` tells Claude *when* to use it, and its body says *how*. Claude loads a skill automatically when the situation matches the description, or when someone types `/<name>`. Skills live in the repo, so cloud and local sessions share them.

---

## 1. Process skills (exist now)

| Skill | Use when | What it does |
|---|---|---|
| `start-session` | A session begins; "continue", "resume", "what's next"; after a context compaction | Reads the hook's context block, gets onto the right branch (even continuing an unmerged one), checks Marcus's answers, reads only the active milestone, states the plan |
| `end-session` | Before stopping; the context is getting full; "wrap up", "stop", "pause", "handoff"; the Stop hook fires | Runs preflight, updates the milestone file, `NOW.md` and `LOG.md` (plus decisions, gotchas and questions), commits, pushes, opens or updates the PR, and tells Marcus what's next |
| `start-milestone` | The next milestone should begin | Checks prerequisites and phase gates, creates `docs/milestones/M<NN>-<slug>.md` from the template, verifies external facts, and slices the work into PRs |
| `close-milestone` | All of a milestone's items are ticked or cut | Proves "Done when (cloud)", reviews the invariants over the whole milestone diff, records cuts and leave-behind notes, hands live steps to Marcus, and starts gate measurement at a phase exit |
| `preflight` | Before a push, before marking a PR ready, at session end | Runs the automated checks, the grep checks and an adversarial self-review of the diff, and confirms the memory is updated |
| `update-plan` | A decision is made or changed; a question is answered; the plan is wrong or stale | Records the decision, updates every document consistently, and bumps versions |
| `verify-external-facts` | Starting a milestone that touches an external API or library; a fact is past its re-check date; something breaks in a way that suggests the API changed | Checks official sources and records each fact with its source and a re-check date in `GOTCHAS.md` |

## 2. Domain skills (create them in the milestone where the pattern first exists)

Writing these before the code exists would mean guessing. Each is created at the end of the milestone named, from the real code and conventions, and added to this table.

| Skill | Created in | Use when | Must cover |
|---|---|---|---|
| `db-migration` | M01 | Adding or changing tables | Drizzle generate/migrate; never editing a merged migration; the `product_id` + index rule; the transition table; role grants; the local test-DB recipe (Postgres 16 in cloud containers) |
| `record-fixture` | M02 | Recording or refreshing API fixtures | Hand-written fixtures from docs (cloud), then `RECORD=1` real recording (local, read-only credentials, Marcus's OK); redaction rules; scanning for PII and tokens; file layout |
| `add-product-pack` | M05 | A new pack or a change to a pack | Manifest vs runtime; `definePack`; defaults, thresholds, phases, facts schema; the adapter with hashing and `isTest`; the **G8 check** commands |
| `add-finding-type` | M06 | A new detector or finding type | Registry entry; detector rule; per-pack thresholds; type → action mapping; tests (including injection and fake evidence); a replay case |
| `deploy-worker` | M07 | Deploying to the SER9 | Build or pull the image, migrate, `docker compose up`, health and heartbeat checks, the `deploy-…` tag, rollback |
| `incident` | M07 | Something is wrong in production | Halt; read notifications and `ads doctor`; revert; break-glass (revoke tokens); write it up in `LOG.md` |
| `eval-replay` | M08 | Changing a model, prompt or pack; judging proposal quality | Adding cases; running replay and compare; reading the results; allowing for model randomness |
| `add-telegram-command` | M09 | A new bot command or button | Command grammar; callback data (≤ 64 bytes, versioned); the operator request kind; the user-id check; tests |
| `add-write-action` | M11 | A new `WriteOp` | The contracts union; undo table; `fieldsFor`; the allowlist flag; guards; both adapters; property tests; card rendering |
| `add-guard` | M11 | A new gateway guard | Module; its position in the pipeline (BLUEPRINT §6); tighten-only config; property test; docs |

## 3. Built-in skills worth using

These come with Claude Code or its environment. They may not exist everywhere; check the available-skills list.

| Skill | When, in this project |
|---|---|
| `session-start-hook` | M00: add dependency installation for cloud sessions to `.claude/hooks/session-start.sh` |
| `security-review` | Before closing M01 (vault), M10 (dashboard auth), M11 (gateway), M12/M13 (write adapters) |
| `code-review` | Before marking a large PR ready |
| `claude-api` | When touching `core/model` or AI SDK provider configuration (model ids, pricing, structured outputs) |
| `simplify` | After a milestone's code works, before closing it |

## 4. How to write a skill here

- **Frontmatter:** `name` (the folder name) and `description`. The description is the trigger, so say **when** to use it and name the situations and phrases that should activate it.
- **Body:** numbered steps; commands in code blocks; links to the docs instead of copies of them. Keep it under ~150 lines. A skill is a checklist, not a manual.
- **Point at the truth:** reference `BLUEPRINT` sections and files by path, so that when the plan changes, the skill stays correct.
- **Update this catalogue** in the same commit, and mention it in `CLAUDE.md`'s skill list if it's a process skill.
- **Test it once:** after writing a skill, follow it for the task that prompted it, and fix whatever step was wrong.
