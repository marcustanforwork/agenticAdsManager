# Session log

Newest entry on top. One entry per working session, written by the `end-session` skill. Stick to facts, absolute dates and links.

---

## 2026-09-25 — Plan v3: review, rewrite, workflow and memory system
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR: none yet
- **Did:**
  - Reviewed the v2 proposal and blueprint, and moved the originals to `docs/archive/` without changes.
  - Re-checked external facts: the Google Data Manager API switch, Explorer access, API v25.2, Node 24 LTS, AI SDK 6, Vercel Hobby terms, Neon's free tier, and Meta's special ad categories.
  - Wrote `docs/plan/PROPOSAL.md` v3, `BLUEPRINT.md` v3 and `CHANGES-v3.md`.
  - Designed the git workflow (`docs/process/GIT-WORKFLOW.md`) and the session and memory system (`docs/process/SESSIONS.md`, `docs/memory/*`, `docs/milestones/_TEMPLATE.md`).
  - Added 7 process skills (`.claude/skills/`), the SessionStart and Stop hooks (`.claude/hooks/`, `.claude/settings.json`), a PR template and the `memory-check` CI job.
- **Decided:** D-001 to D-019 (carried over from v2); D-020 to D-038 (v3 fixes). D-039 to D-053 are proposed and need Marcus's OK.
- **Learned:** GOTCHAS now has the environment facts and 12 external facts, plus 1 fact still unverified (Meta's `execution_options`).
- **Next:** Marcus reviews the plan and answers Q1–Q10. Then Claude starts M00.
- **Open:** Q1–Q10; setup tasks T1–T13.
