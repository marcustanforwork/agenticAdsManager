# Session log

Newest entry on top. One entry per working session, written by the `end-session` skill. Stick to facts, absolute dates and links.

---

## 2026-09-25 — Plan v3.1: Marcus's answers, sessions resized, PR opened
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Marcus's answers:
    - he already has Vercel Pro, so the dashboard runs there (D-054, superseding D-050);
    - he's already on Neon's paid plan (D-055);
    - build sessions run from a clean context on Opus 5.5 at medium effort, each within 400–600k tokens including tests, reviews and fixes (D-056).
  - Re-estimated every milestone against v2's yardstick (500k ≈ 1,500–2,500 lines including tests). Split the 8 that no longer fit into a/b parts, giving 25 sessions and about 11.6M tokens (BLUEPRINT §0, §7, §9; CHANGES §H).
  - Restored the per-session token budget and checkpoints (SESSIONS §4), and wired them into CLAUDE.md, the skills and the milestone template.
- **Decided:** D-054, D-055, D-056 (Marcus). D-050 superseded; D-033 partly superseded.
- **Learned:** GOTCHAS got a design note that Vercel functions can't use LISTEN through Neon's pooler, so the dashboard polls instead.
- **Next:** Marcus reviews the PR and answers Q1–Q5 and Q8–Q10. Then the M00 session.
- **Open:** Q1–Q5, Q8–Q10; setup tasks T1–T13.

## 2026-09-25 — Plan v3: review, rewrite, workflow and memory system
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1) (opened later the same day)
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
