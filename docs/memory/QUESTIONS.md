# Questions for Marcus

**How this works:** Claude adds questions with the options and a recommendation. Marcus answers here (edit the file and write under **Answer**), in chat, or on the PR. The next session records the answer as a decision (the `update-plan` skill) and moves the question to **Answered**.

None of these block milestone **M00**. Each question says what it blocks.

---

## Open

### Q1 — Do you accept the v3 recommendations?
**Blocks:** the parts of M05a–M15b that depend on them.

The recommendations D-039 … D-053 change or extend earlier decisions. There's a one-line summary of each, with its alternative, in `docs/plan/CHANGES-v3.md` §G. D-050 is already settled (you have Vercel Pro, D-054), and D-047 depends on Q3.

**Answer with:** "all OK", or list the ones you disagree with.

**Answer:**

### Q2 — Which machines will run local sessions, and how is the SER9 set up?
**Blocks:** M07 live acceptance.

a) Which machine(s) will you run local Claude Code sessions on (the SER9, a laptop), and on which OS?

b) What OS does the SER9 run? Does Docker start at boot **without anyone logging in**? M07 requires the services to survive a reboot unattended. On Windows, Docker Desktop normally waits for a login, and there are workarounds.

**Answer:**

### Q3 — What does SnapPool already track?
**Blocks:** D-047, the M05a defaults and M12.

- Is the Meta Pixel installed? The Conversions API? The Google tag?
- For which events: signup, purchase, others?
- Do those events carry an event id?

**Why it matters:** to avoid counting the same conversion twice (PROPOSAL §8, rule 2).

**Answer:**

### Q4 — Does SnapPool store click IDs and platform IDs on each signup?
**Blocks:** attribution in M05b.

These are `gclid`/`gbraid`/`wbraid`, `fbclid`, the `_fbc`/`_fbp` cookies, `utm_*`, and the landing-page URL parameters.
- If not: is it OK to add this in SnapPool's own code (outside this repo)?
- Also: is it OK to add `{campaignid}`/`{adgroupid}` (Google) and `{{campaign.id}}`/`{{adset.id}}`/`{{ad.id}}` (Meta) as URL parameters on every ad?

Without these, attribution and feedback can't work (PROPOSAL §8, rule 1).

**Answer:**

### Q5 — How do we recognise test and internal SnapPool signups?
**Blocks:** M05a.

By email domain? A flag on the account? A list of specific accounts? These must never be uploaded as conversions.

**Answer:**

### Q8 — Will you set a spending limit on the Meta account, as the hard backstop?
**Blocks:** M12 live steps.

Are you willing to set an **account spending limit** on the SnapPool ad account in Meta's billing settings? If so, at what amount? It should be at or above your monthly ceiling. It's the only true hard cap (PROPOSAL §6.9).

**Answer:**

### Q9 — Does Meta require the Housing category for property ads?
**Blocks:** the M05b property pack and M14 creates.

From running property ads in Singapore: does Meta require the **Housing special ad category** for them? It restricts age, gender and postcode targeting.

**Answer:**

### Q10 — Who merges PRs?
**Blocks:** nothing.

- **Default:** you merge every PR yourself.
- **Alternative:** Claude may merge PRs that only change `docs/memory/` once CI is green.

**Answer:**

---

## Answered

### Q6 — Where should the dashboard be hosted? · answered 2026-09-25
**Answer (Marcus):** He already has a Vercel Pro account, so the dashboard goes on Vercel Pro behind Cloudflare Access. → **D-054** (supersedes D-050).

### Q7 — Are you OK with a small Neon bill? · answered 2026-09-25
**Answer (Marcus):** He is already on Neon's paid plan. → **D-055**.

### (unasked) How will build sessions run? · answered 2026-09-25
**Answer (Marcus):** Each session starts from a clean context, on Opus 5.5 at medium effort, and must fit within 400–600k tokens, including testing, changes, reviews and fixes. Max effort was for planning only. → **D-056**; eight milestones split into a/b parts (25 sessions).
