# Questions for Marcus

**How this works:** Claude adds questions with the options and a recommendation. Marcus answers here (edit the file and write under **Answer**), in chat, or on the PR. The next session records the answer as a decision (the `update-plan` skill) and moves the question to **Answered**.

None of these block milestone **M00**. Each question says what it blocks.

---

## Open

_None right now._

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
**Answer (Marcus):** "Not decided yet, but probably just $500 a month for starters." → **D-061**, now superseded by D-063 (Q12). Note that Meta's limit is a lifetime total, so it needs a monthly reset.

### Q9 — Does Meta require the Housing category for property ads? · answered 2026-09-25
**Answer (Marcus):** "Yes, probably. I searched on Google: you need to declare the special ad category for housing." → **D-062**.

### Q10 — Who merges PRs? · answered 2026-09-25
**Answer (Marcus):** "You can merge the PR when I instruct you to, and after CI passes." → **D-057**.

### Q11 — OK the SnapPool tracking change? · answered 2026-09-25
**Answer (Marcus):** First he asked which project it's for: SnapPool, built in the `snappool` repo, with this repo only reading what it saves. Then: "yes okay". → **D-060 adopted.** He approves the privacy-page words in the SnapPool PR. Reading SnapPool's code for the prompt turned up fixes (D-064): the page needs three edits, because it promises "never share it with advertisers".

**His follow-up:** "So we don't need Meta's pixel or Google API integration?" → **Right for SnapPool:** it gets no pixel, no Google tag and no Google or Meta API code. The API work lives in this repo: reading the ad accounts (M02, M03) and sending conversions (Meta Conversions API in M12, Google Data Manager API in M13). The platforms still need setup, but no code: a Meta dataset with a Conversions API token (T4), Google "import from clicks" conversion actions with the Data Manager API on (T11), and the ad URL settings (T14).

### Q12 — The ~500 a month: which currency, and does Meta auto-reset? · answered 2026-09-25
**Answer (Marcus):** "Yes, it's $500 dollars" (Singapore dollars). Not sure about auto-reset: "I'll manually do the reset if I need to, but I will adjust the limits when we are trying as well." → **D-063** (supersedes D-061). The agent reads the limit from Meta on every sync, never assumes a figure and never changes it. It warns at 80% used, and the digest reminds him on the 1st.

### (unasked) How will build sessions run? · answered 2026-09-25
**Answer (Marcus):** Each session starts from a clean context, on Opus 5.5 at medium effort, and must fit within 400–600k tokens, including testing, changes, reviews and fixes. Max effort was for planning only. → **D-056**; eight milestones split into a/b parts (25 sessions).
