# Session log

Newest entry on top. One entry per working session, written by the `end-session` skill. Stick to facts, absolute dates and links.

---

## 2026-09-25 — Q11 approved; the SnapPool prompt; spec fixes from SnapPool's code
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` (reset to `main` after PR #1 merged) · PR [#2](https://github.com/marcustanforwork/agenticAdsManager/pull/2)
- **Did:**
  - Marcus OK'd Q11: **D-060 adopted**.
  - He asked whether a pixel or Google API work is needed. Answer: not in SnapPool. The API work is this repo's (M02, M03, M12, M13), plus platform setup (T4, T11, T14). T4 now says "create a dataset; don't install its pixel code".
  - He asked for a prompt to build the SnapPool change on his local machine. Reading SnapPool's code at `a6c190a` to write it found gaps, fixed in `SNAPPOOL-TRACKING.md` v1.2 (**D-064**):
    - the middleware is only the Auth.js `/host` guard, and would send every ad visitor to `/login` if simply widened;
    - click ids were being cut to 255 characters;
    - `page_url` now comes from `Referer`;
    - a repeat `/start` keeps the earlier attribution;
    - the privacy page promises "never share it with advertisers", so it needs three edits;
    - the migration must reach production before the deploy.
  - The prompt is §7. It has the SnapPool session add the work to SnapPool's own blueprint as its next session.
  - M05a: SnapPool deletes pending requests after 30 days, so the adapter reads at least daily.
  - Squash-merged PR #2 into `main` on Marcus's instruction, after CI passed (D-057), and reset the branch to `main`.
- **Decided:** D-060 adopted (Marcus); D-064 (Claude, fix).
- **Learned:** `gh api … -H 'Accept: application/vnd.github.raw'` returns a file's raw text (tested against this repo). SnapPool is on Next.js 15.5; its middleware lives in `middleware.ts`.
- **Next:** Marcus runs the SnapPool session with the §7 prompt. A clean session starts M00.
- **Open:** no questions; the SnapPool change (T6b); setup tasks T1–T14.

## 2026-09-25 — Q12 answered; Q11 clarified; PR #1 merged
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Q12 as D-063, superseding D-061. The budget is S$500 a month. Marcus resets Meta's spending limit by hand and will change it during trials, so the agent reads it live, never assumes it, and never changes it.
  - Moved the `spend_cap_headroom` check from M12 to **M04** and added a digest line (M07), because ads are live in Phase 0 and all Meta campaigns stop at the limit. The M05a live steps now enter the starting settings: test email domains and ceilings.
  - Q11: Marcus asked which project the tracking plan is for. The answer is SnapPool (the `snappool` repo); this repo only reads what it saves. Q11 and `SNAPPOOL-TRACKING.md` §0 now say so up front. Q11 is still open.
  - Documented how a cloud session restarts a branch whose PR is already merged (GIT-WORKFLOW §4 and §8; `start-session` §2).
  - Squash-merged PR #1 into `main` on Marcus's instruction, after CI passed (D-057), and reset the branch to `main`.
- **Decided:** D-063 (Marcus).
- **Next:** a clean-context session starts M00. Marcus: T1, Q11, and the long setup tasks T4, T5 and T6a.
- **Open:** Q11; setup tasks T1–T14.

## 2026-09-25 — Marcus's second answers; SnapPool repo read; tracking spec
- **Where:** cloud · branch `claude/gifted-franklin-hk0fku` · PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1)
- **Did:**
  - Recorded Q1–Q5 and Q8–Q10: D-039–D-053 adopted, and D-057–D-062 added.
  - Attached `marcustanforwork/snappool` (read-only) and read its schema, signup, pricing, security headers and memory.
  - Wrote `docs/plan/SNAPPOOL-TRACKING.md` (D-060, proposed).
  - Contracts: feedback **routes** (`FeedbackRoute`), a `web` context (user agent and page URL), and `testTraffic.emailDomains`.
  - Trust check `spend_cap_headroom`. Hourly uploads once auto-approved.
  - Local-session Docker isolation rules; the merge policy.
- **Decided:** D-057 (merge on instruction, after CI), D-058 (SER9 local sessions, isolation), D-059 (test signups by email domain), D-060 (SnapPool captures, the agent uploads; proposed), D-061 (Meta limit ~500, reset monthly), D-062 (Housing confirmed).
- **Learned:** GOTCHAS gained two verified Meta facts: CAPI website events **require** user agent and page URL, and the account spending limit is a **lifetime** total. It also gained the SER9 Docker rules and a pointer to the SnapPool facts.
- **Next:** Marcus answers Q11 and Q12 and says when to merge PR #1. Then the SnapPool tracking session (in the snappool repo) and M00.
- **Open:** Q11, Q12; setup tasks T1–T14.

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
