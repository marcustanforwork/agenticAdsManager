# SnapPool conversion tracking: spec

| | |
|---|---|
| **Version** | v1.1 — 2026-09-25 (§0 now says first which repo the work is in) |
| **Status** | **Proposed**. Decision D-060 needs Marcus's OK (QUESTIONS Q11). |
| **Built in** | The **SnapPool repo** (`marcustanforwork/snappool`), by a SnapPool session following SnapPool's own process. This repo only uses what it produces. |
| **Used by** | M05a (outcomes), M05b (attribution), M12 (Meta uploads) and M13 (Google uploads) in this repo |
| **Based on** | The SnapPool repo at commit `a6c190a` and its `memory/MEMORY.md`, read on 2026-09-25. |

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
- **Size:** one small SnapPool session: one migration, middleware, one API change, a privacy-page update and tests. Roughly 150–300 lines.

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
| Privacy | A privacy page exists (`app/(marketing)/privacy`, text in `messages/en/privacy.json`). |

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

- **When:** a page request (not an API route or an asset) carries any of `gclid`, `gbraid`, `wbraid`, `fbclid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `sp_agid`, `sp_adid`. SnapPool then sets a first-party cookie **`sp_attr`**.
- **The cookie holds:**
  - those parameters (only these keys, each truncated to 255 characters);
  - `landing_url` (path + query, max 1,024 characters);
  - `captured_at` (ISO time);
  - and, when `fbclid` is present, `fbc = fb.1.<epoch_ms>.<fbclid>` (Meta's click-cookie format).
- **Cookie attributes:** `Path=/; Max-Age=7776000` (90 days); `SameSite=Lax; Secure; HttpOnly`. Only the server needs to read it.
- **The last paid click wins.** A new click id or `utm_source` replaces the cookie; a visit without parameters never clears it.
- No script is involved, so there's no CSP change.

### 3.3 Save it with the request (`/api/start` plus one migration)

- **Migration:** `pool_requests` gains three nullable columns:
  - `attribution jsonb`: the validated cookie contents;
  - `user_agent text`: at most 512 characters, from the request header. **Meta requires the browser user agent for website events.**
  - `page_url text`: the `/start` page URL, at most 1,024 characters. **Meta requires the event's page URL for website events.**
- **`/api/start`** reads the cookie and headers, validates them with zod, and stores them. No cookie means an organic visit, so the columns stay null. A malformed cookie is ignored, not treated as an error.
- **Don't store the IP address.** That keeps the privacy footprint small. The cost is a slightly lower Meta match rate, which is acceptable.

### 3.4 Privacy page (PDPA)

Add a short paragraph along these lines: *"To learn which ads bring people to SnapPool, we share ad-click identifiers and a one-way scrambled (hashed) version of your email address with Google and Meta. They use it only to measure our ads."* **The final wording is Marcus's call (Q11).**

### 3.5 Tests in SnapPool

- **Middleware:**
  - it sets `sp_attr` only when allowed parameters are present, and ignores any others;
  - it truncates long values;
  - the `fbc` format is right;
  - a later click replaces an earlier one, and a visit without parameters keeps it.
- **`/api/start`:**
  - it stores `attribution`, `user_agent` and `page_url`;
  - an organic request stores nulls;
  - a malformed cookie is ignored.
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

## 6. Open points for Marcus

- **Q11:** OK this approach? And what wording for the privacy page?
- The Meta event names: the defaults are `Lead` and `CompleteRegistration`.
- **Setup task T14:** the ad URL settings in §3.1, applied when the ads are created.
