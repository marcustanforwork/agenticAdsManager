# SnapPool conversion tracking: spec

| | |
|---|---|
| **Version** | v1.2 — 2026-09-25 (approved by Marcus; fixes from reading SnapPool's code, D-064; the prompt for the SnapPool session, §7) |
| **Status** | **Approved** by Marcus on 2026-09-25 (D-060, Q11). Not built yet: setup task T6b. |
| **Built in** | The **SnapPool repo** (`marcustanforwork/snappool`), by a SnapPool session following SnapPool's own process. This repo only uses what it produces. |
| **Used by** | M05a (outcomes), M05b (attribution), M12 (Meta uploads) and M13 (Google uploads) in this repo |
| **Based on** | The SnapPool repo at commit `a6c190a` (still its `main` on 2026-09-25) and its `memory/MEMORY.md`, `CLAUDE.md` and blueprint, read on 2026-09-25. |

---

## 0. In short

- **This is a change to SnapPool, built in the `snappool` repo, not in the ads manager.** It's written down here because the ads manager depends on it. The ads manager's own part (reading what SnapPool saves, and sending the conversions to Google and Meta) is already in its milestones (§4).
- **Today SnapPool can't tell which ad brought a visitor.** It records nothing about where visitors came from and sends nothing to Google or Meta: no pixel, no Google tag, no analytics, and no capture of click IDs or `utm_*` parameters.
- **The plan:**
  1. SnapPool **remembers** the ad-click details when a visitor arrives.
  2. It **saves** them with the visitor's `/start` request.
  3. The ads agent **reads** them (read-only) and **sends** the conversions to Google and Meta itself: server to server, hourly, through its gateway with all its guards and caps.
- **No tracking pixel or Google tag in the browser, for now.** That means:
  - no Content-Security-Policy change and no cookie-consent machinery;
  - one place where conversion logic lives, so nothing is counted twice.

  Revisit this if match rates turn out poor (§5).
- **Do it early.** Attribution only works for visitors who arrive *after* this ships, so it should land before ad spend grows, and well before M05b.
- **Size:** one small SnapPool session: one migration, middleware, one API change, a privacy-page update and tests. Roughly 200–400 lines, most of them tests.
- **To build it:** paste the prompt in §7 into a Claude Code session in the `snappool` repo.

---

## 1. SnapPool today (facts from the repo)

| Topic | Fact |
|---|---|
| Stack | Next.js App Router on Vercel · Neon + Drizzle · next-auth magic link via Resend · Sentry · Cloudflare R2 for media · Node 24 |
| Domain | `snappool.photos` (served from `www`) |
| Signup | **Open on production since 2026-09-20** (`HOST_SIGNUP_MODE=open`). The kill switch is `allowlist` plus a redeploy. The brakes are 3 free pools per host, one pending `/start` request per email, and a sign-in mail cooldown. |
| Funnel | `/start` form (email, event title, event type) → `pool_requests` row (`pending`) → the visitor clicks the magic link → `onHostSignIn` creates the `hosts` row and claims the request (`claimed_at`, `event_id`) → a free pool is created → the first photo sets `events.first_upload_at` |
| Money | **No checkout.** The pricing phase is `beta` (free, no prices shown). Upgrades are free in beta; any other phase returns `checkout_unavailable`. Beta programme: signup window to **2026-11-30**; free plans honoured to **2027-01-01**. |
| Tracking | None. No pixel, no Google tag, no analytics tool, no click-ID or `utm_*` capture. |
| Security headers | CSP `script-src 'self' 'unsafe-inline'`. A browser pixel would need CSP changes; this plan needs none. |
| Middleware | `middleware.ts` (Next.js 15.5) is **only the Auth.js login guard for `/host`**. Its matcher is `/host/:path*`, and it redirects **every** matched request without a signed-in user to `/login`. |
| `/start` | The page is `app/start/page.tsx`, outside the marketing route group. It already says "By continuing you agree to the terms and privacy policy". The form POSTs JSON to `/api/start` (`app/api/start/route.ts`), which calls `startPool()` in `lib/pool-requests.ts`. A repeat `/start` for the same email updates the one pending row (an upsert) and re-sends the link. |
| Referrer policy | `strict-origin-when-cross-origin`, so the same-origin POST to `/api/start` carries the full `/start` URL in its `Referer` header. |
| Retention | Pending (unclaimed) requests are deleted after **30 days** (`POOL_REQUEST_TTL_DAYS`). |
| Privacy | A privacy page exists (`app/(marketing)/privacy`, text in `messages/en/privacy.json`). Today it promises "we never sell personal data, **never share it with advertisers**…", names three services that handle data (Resend, Sentry, Cloudflare Workers AI), and its Cookies section lists only the sign-in and guest cookies. |
| Migrations | SnapPool's own rule: deploys don't run migrations, so a migration isn't shipped until the **production** Neon branch has it. |
| Process | SnapPool sessions are numbered in `SnapPool-BLUEPRINT.md` (Session 40 is the latest), with its own `CLAUDE.md`, `memory/MEMORY.md` and `docs/DECISIONS.md`. |

---

## 2. SnapPool's funnel as outcome stages

These are the defaults for the `saas-snappool` pack (M05a). Marcus can edit them in settings.

| Stage | Tier | Happens when | Read from | Source id (basis of the upload event id) |
|---|---|---|---|---|
| `pool_request` | soft | `/start` is submitted | `pool_requests.created_at` | `pool_requests.id` |
| `signup` | **success: the primary KPI during beta** | The visitor clicks the email link, and the request is claimed | `pool_requests.claimed_at` | `pool_requests.id` |
| `activated` | success | The first photo lands in that pool | `events.first_upload_at`, where `events.id = pool_requests.event_id` | `events.id` |
| `paid` | hard | **No source yet.** SnapPool has no checkout. | — | — |

**Notes**
- Only **claimed `/start` requests** count as signups. Hosts created by co-host invites, or who sign in directly, aren't acquisitions and are left out automatically.
- **Test and internal signups** are recognised by **email domain** (Marcus, Q5), plus `hosts.is_superadmin`. The domain list is a product setting (`testTraffic.emailDomains`), kept in the database and not in either repo. Test outcomes are never uploaded and never counted in KPIs.
- **Activation is for reporting, not for bidding.** The first photo usually arrives on the event day, often weeks after the ad click, which is outside the platforms' attribution windows. Feeding it back would teach bidding very little.

---

## 3. What changes in SnapPool

### 3.1 Ad URLs: a setup step, not code (setup task T14)

Every ad carries its own identity in its URL, so attribution is exact:

| Platform | Where | Value |
|---|---|---|
| Google | Turn **auto-tagging** on (it adds `gclid`). Set an account-level **final URL suffix**: | `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&sp_agid={adgroupid}` |
| Meta | Set the ad-level **URL parameters** (Meta adds `fbclid` itself): | `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&sp_agid={{adset.id}}&sp_adid={{ad.id}}` |

`utm_campaign` carries the **platform's campaign id**, not a name. The agent looks up the names during its sync.

### 3.2 Remember the click (`middleware.ts`)

- **Keep the `/host` login guard exactly as it is.** Today the whole middleware is that guard, and it sends every matched request without a user to `/login`. Widening its matcher without splitting by path would send **every ad visitor to the login page**. So:
  - `/host/*` goes through the unchanged Auth.js guard;
  - landing pages run only the click capture, which never redirects and doesn't read the session.
- **Where the capture runs:** the pages an ad can land on, meaning the marketing pages and `/start`. Not API routes or assets, and not the guest pages (`/e`, `/g`), which are the busiest paths during an event.
- **When it sets the cookie:** the request carries any of `gclid`, `gbraid`, `wbraid`, `fbclid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `sp_agid` or `sp_adid`. SnapPool then sets a first-party cookie, **`sp_attr`**.
- **The cookie holds:**
  - those parameters, and only these keys:
    - click ids (`gclid`, `gbraid`, `wbraid`, `fbclid`) are kept **whole**, up to 512 characters. A longer one is dropped, never cut, because a cut id matches nothing.
    - other values are truncated to 255 characters.
  - `landing_url` (path + query, max 1,024 characters);
  - `captured_at` (ISO time);
  - and, when `fbclid` is present, `fbc = fb.1.<epoch_ms>.<fbclid>` (Meta's click-cookie format).

  The whole cookie stays under about 3.5 KB, because browsers cap a cookie at 4 KB. If it's larger, shorten `landing_url` first.
- **Cookie attributes:** `Path=/; Max-Age=7776000` (90 days); `SameSite=Lax; Secure; HttpOnly`. Only the server needs to read it.
- **The last paid click wins.** A new click id or `utm_source` replaces the cookie; a visit without parameters never clears it.
- No script is involved, so there's no CSP change.

### 3.3 Save it with the request (`/api/start` plus one migration)

- **Migration:** `pool_requests` gains three nullable columns:
  - `attribution jsonb`: the validated cookie contents;
  - `user_agent text`: at most 512 characters, from the request header. **Meta requires the browser user agent for website events.**
  - `page_url text`: the `/start` page URL, at most 1,024 characters. **Meta requires the event's page URL for website events.**
- **Order matters:** the migration goes on the **production** Neon branch *before* the code is deployed. Otherwise `/api/start` fails and signups stop (SnapPool's own rule, §1).
- **`/api/start`:**
  - It reads the `sp_attr` cookie and the `User-Agent` header.
  - It takes `page_url` from the `Referer` header, and only if that is a `snappool.photos` URL. The `/start` form doesn't change.
  - It validates all of it with zod, in a module that doesn't touch the database (like `lib/pool-start-input.ts`), and passes it to `startPool()`.
  - No cookie means an organic visit, so `attribution` stays null. A malformed cookie is ignored, not treated as an error.
  - **Nothing about attribution may ever block a signup.**
- **A repeat `/start`** (the upsert on the pending row) keeps the existing `attribution` unless the new request has one, so the last paid click wins. `user_agent` and `page_url` take the new values.
- **Keep it server-side:** these columns never appear in any API response, and their raw values aren't logged.
- **Don't store the IP address.** That keeps the privacy footprint small. The cost is a slightly lower Meta match rate, which is acceptable.

### 3.4 Privacy page (PDPA)

The page needs **three edits**, not just a new paragraph, because of what it says today (§1):
1. **The promise "never share it with advertisers".** Keep "we never sell personal data". Say plainly that SnapPool shares ad-click identifiers and a hashed email with Google and Meta, only to measure its own ads.
2. **The list of services that handle data:** add Google and Meta, for ad measurement.
3. **The Cookies section:** add the ad-click cookie. It's set only when a visitor arrives from an ad link, holds the ad's identifiers, and is kept for 90 days.

Then update the page's `updated` date. A starting point for the words: *"To learn which ads bring people to SnapPool, we share ad-click identifiers and a one-way scrambled (hashed) version of your email address with Google and Meta. They use it only to measure our ads."* Marcus OK'd the approach (Q11). **He approves the exact words in the SnapPool PR.**

### 3.5 Tests in SnapPool

- **Middleware:**
  - it sets `sp_attr` only when allowed parameters are present, and ignores any others;
  - it truncates long values, but drops a click id over 512 characters instead of cutting it;
  - the `fbc` format is right;
  - a later click replaces an earlier one, and a visit without parameters keeps it;
  - **`/host/*` without a session still redirects to `/login`**, and a landing page with ad parameters never redirects, whether or not the visitor is signed in.
- **`/api/start`:**
  - it stores `attribution`, `user_agent` and `page_url`;
  - an organic request stores nulls;
  - a malformed cookie, or a `Referer` from another site, is ignored and the signup still succeeds;
  - a repeat `/start` without a cookie keeps the earlier attribution.
- **The claim flow is unchanged,** so its existing tests keep passing.

---

## 4. What the ads agent does with it

| Milestone | Work |
|---|---|
| **M05a** | The SnapPool adapter reads `pool_requests` (plus `events` for activation) with the read-only connection. It emits one `OutcomeEvent` per stage, carrying: the ids from `attribution` (`gclid`/`gbraid`/`wbraid`, `fbc`, `utm_*`, `sp_*` → `googleCampaignId`/`metaCampaignId`/…); `web.userAgent` and `web.pageUrl`; the email hashed **inside the adapter** (SHA-256 of the trimmed, lower-cased address); and `isTest`. |
| **M05b** | Attribution: `utm_source` + `utm_campaign` (a platform campaign id) is an exact match. The fallback is a `gclid` lookup; otherwise `none`. |
| **M12** | Meta **Conversions API**: `action_source=website`, `event_source_url` = `page_url`, `client_user_agent`, `fbc`, the hashed email, and `event_id` = `<sourceId>:<stage>`. **Default feedback routes:** `pool_request → Lead` and `signup → CompleteRegistration`. First run with `test_event_code`. |
| **M13** | Google **Data Manager API**: a click conversion for `signup`, using `gclid` (or `gbraid`/`wbraid`), with transaction id = event id. |
| **Rhythm** | While Marcus approves uploads by hand (Phase 2), they're batched **daily**. Once auto-approval is switched on, they run **hourly**. An outcome is only ever sent to the platform its click came from. |

**Why two Meta events?** At about S$500 a month in ad spend, signups will be too few for Meta's optimisation to learn from quickly. `Lead` (a `/start` submit) happens more often. With both available, the campaign can optimise for `Lead` early on, and switch to `CompleteRegistration` once volume allows. That's a campaign setting in Ads Manager.

---

## 5. Why not a pixel or a Google tag (for now)

| | **Agent uploads** (chosen) | Pixel + tag in the browser |
|---|---|---|
| Work in SnapPool | Small: remember + save | Scripts, CSP changes, cookie consent, event wiring |
| Feedback speed | Hourly | Real time |
| Match quality | Good: `fbc`, hashed email, user agent; no IP | Better: cookies and IP |
| Double counting | None: one path | Needs shared event ids between browser and server |
| Where the logic lives | One place, tested, capped (the gateway) | Split across two repos |

**Revisit** if, after 4 weeks of data, Meta's event match quality is poor, or conversions are too few for the chosen optimisation event. In that case a pixel can be added **using the same `event_id`s**, so the two paths de-duplicate.

---

## 6. Status and what's left

- **Q11:** approved by Marcus on 2026-09-25 (D-060). He approves the privacy-page words in the SnapPool PR (§3.4).
- **The Meta event names:** the defaults are `Lead` and `CompleteRegistration`.
- **Setup task T14:** the ad URL settings in §3.1, applied when the ads are created.
- **When it's live on production, record the date** in this repo's `docs/memory/NOW.md`. Attribution data starts from that day.
- **For the agent (M05a):** SnapPool deletes pending requests after 30 days, so the adapter reads at least daily and keeps what it has read. A pending row that disappears is not a deleted outcome.

---

## 7. The prompt for the SnapPool session

Paste this into a new Claude Code session in the `snappool` repo, on a machine where `gh` is signed in. It reads this spec from `main` of this repo, so merge any pending change to this file first.

```text
We're adding ad-click attribution to SnapPool, so that the Ads Agent (a separate
project in marcustanforwork/agenticAdsManager) can later tell Google and Meta
which ads produced sign-ups. This session builds only SnapPool's part: remember
the ad click, and save it with the /start request. Nothing in SnapPool calls
Google or Meta, and there is no pixel or Google tag.

1. Read the spec. It's approved (Marcus, 2026-09-25) and it's the source of truth:
     gh api 'repos/marcustanforwork/agenticAdsManager/contents/docs/plan/SNAPPOOL-TRACKING.md?ref=main' -H 'Accept: application/vnd.github.raw'
   Build §3.2 to §3.5. (§3.1 is a setup step for me, not code.) §1 lists the
   SnapPool facts it was written against (commit a6c190a): re-check them against
   the current code, and tell me if anything no longer holds. If the command
   fails, ask me to paste the file.

2. Follow this repo's own process (CLAUDE.md, /session-start). This is new scope:
   add it to SnapPool-BLUEPRINT.md as the next numbered session, with Exit Gates,
   and record the decision in docs/DECISIONS.md. Confirm the session number with
   me before writing code.

3. Four things that must not go wrong:
   - middleware.ts is today only the Auth.js login guard for /host, and it
     redirects every matched request without a user to /login. Keep that guard
     exactly as it is. The click capture runs only on the pages an ad can land
     on (the marketing pages and /start): it never redirects and doesn't read
     the session. It doesn't run on /api, assets or the guest pages (/e, /g).
   - Nothing about attribution may block a sign-up. A missing or malformed
     cookie just means no attribution.
   - The migration must reach the production Neon branch BEFORE the code is
     deployed, or /api/start breaks and sign-ups stop. Remind me, and don't
     call the session done until I confirm it's applied.
   - The privacy page promises "never share it with advertisers". It needs the
     three edits in §3.4. Show me the exact new wording; I approve it in the PR.

4. Out of scope: any pixel or tag, any call to Google or Meta, a consent
   banner, and any admin or reporting screen.

5. Done when:
   - the §3.5 tests pass, and pnpm test is green (plus the e2e specs the change
     touches);
   - on a Vercel preview, opening /?utm_source=meta&fbclid=test123 sets the
     sp_attr cookie, and a /start submitted afterwards stores attribution,
     user_agent and page_url on its pool_requests row;
   - /host still redirects to /login when signed out.

6. When it's live on production, tell me the date. Attribution data starts that
   day, and the Ads Agent needs to know it.
```
