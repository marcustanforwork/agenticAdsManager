# Questions for Marcus

**How this works:** Claude adds questions with the options and a recommendation. Marcus answers here (edit the file and write under **Answer**), in chat, or on the PR. The next session records the answer as a decision (the `update-plan` skill) and moves the question to **Answered**.

None of these block milestone **M00**. Each question says what it blocks.

---

## Open

### Q11 — OK the SnapPool tracking plan? (D-060)
**Blocks:** the SnapPool tracking change (T6b). Attribution (M05b) and uploads (M12, M13) depend on it.

`docs/plan/SNAPPOOL-TRACKING.md` proposes the following:
- SnapPool remembers the ad click in a cookie and saves it, with the browser user agent and page URL, on the `/start` request. That's a small SnapPool session: one migration, middleware and one API change.
- The agent sends the conversions to Meta and Google itself, with **no pixel for now**.
- The privacy page gets a short paragraph about sharing hashed emails and click ids with Google and Meta, for ad measurement only.

**Answer with:** "OK", or what to change. Also give the privacy wording, or say "use the draft in §3.4".

**Answer:**

### Q12 — The ~500 a month: which currency, and does Meta auto-reset?
**Blocks:** the spending ceilings in settings (M05a live steps) and the M12 spend-limit check.

a) Is it **SGD**, the ad account's currency?

b) When you set Meta's account spending limit, does the billing page offer **"reset on the 1st of each month"**? If it doesn't, the digest will remind you to reset it on the 1st.

**Answer:**

---

## Answered

### Q1 — Do you accept the v3 recommendations? · answered 2026-09-25
**Answer (Marcus):** "looks okay to me". → D-039 to D-053 **adopted**. D-050 was already replaced by D-054, and D-047 was then replaced by D-060 after Q3.

### Q2 — Which machines will run local sessions, and how is the SER9 set up? · answered 2026-09-25
**Answer (Marcus):** The SER9 is a Linux machine with the Docker CLI, and Claude may run Docker commands there. No login is needed after a reboot. He's trying cloud sessions now, and will move to local sessions on the SER9 when cloud tokens run out. → **D-058**, with isolation rules for sharing the machine with production.

### Q3 — What does SnapPool already track? · answered 2026-09-25
**Answer (Marcus):** Nothing yet: no pixel and no Conversions API. SnapPool's own events (photo pools) each have a slug. "We might have to think of something." Claude checked the SnapPool repo and confirmed there's no tracking of any kind. → **D-060** (proposed, Q11) and `docs/plan/SNAPPOOL-TRACKING.md`.

### Q4 — Does SnapPool store click IDs and platform IDs on each signup? · answered 2026-09-25
**Answer (Marcus):** "No, probably not yet." Confirmed from the repo. → Part of the SnapPool tracking change (T6b, D-060), plus the ad URL settings (T14).

### Q5 — How do we recognise test and internal SnapPool signups? · answered 2026-09-25
**Answer (Marcus):** By email domain. → **D-059**. The domain list becomes a product setting (entered in the M05a live steps).

### Q6 — Where should the dashboard be hosted? · answered 2026-09-25
**Answer (Marcus):** He already has a Vercel Pro account, so the dashboard goes on Vercel Pro behind Cloudflare Access. → **D-054** (supersedes D-050).

### Q7 — Are you OK with a small Neon bill? · answered 2026-09-25
**Answer (Marcus):** He is already on Neon's paid plan. → **D-055**.

### Q8 — Will you set a spending limit on the Meta account, as the hard backstop? · answered 2026-09-25
**Answer (Marcus):** "Not decided yet, but probably just $500 a month for starters." → **D-061**. Note that Meta's limit is a lifetime total, so it needs a monthly reset. Currency and auto-reset: Q12.

### Q9 — Does Meta require the Housing category for property ads? · answered 2026-09-25
**Answer (Marcus):** "Yes, probably. I searched on Google: you need to declare the special ad category for housing." → **D-062**.

### Q10 — Who merges PRs? · answered 2026-09-25
**Answer (Marcus):** "You can merge the PR when I instruct you to, and after CI passes." → **D-057**.

### (unasked) How will build sessions run? · answered 2026-09-25
**Answer (Marcus):** Each session starts from a clean context, on Opus 5.5 at medium effort, and must fit within 400–600k tokens, including testing, changes, reviews and fixes. Max effort was for planning only. → **D-056**; eight milestones split into a/b parts (25 sessions).
