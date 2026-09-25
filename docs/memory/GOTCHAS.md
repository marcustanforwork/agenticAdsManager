# Gotchas and verified facts

Things that surprised us, and external facts the plan depends on.
- **Deduplicate:** update an existing entry instead of adding a near-copy.
- **Date everything:** every external fact has a source and a re-check date (the `verify-external-facts` skill).

---

## Environment (Claude Code sessions)

- **Cloud sessions have no `gh` CLI.** Use the GitHub MCP tools, loading them with ToolSearch if they're deferred. *(2026-09-25)*
- **The cloud container** runs Ubuntu 24.04, Node 22.22 and pnpm 10.33, and has ripgrep.
  - PostgreSQL 16 is installed but stopped. Start it with `pg_ctlcluster 16 main start`.
  - Docker is the **client only, with no daemon**: build images in CI, not in cloud sessions.
  - The project targets Node 24: the SessionStart hook downloads Node 24.21.0 (checksum-verified) to `~/.cache/ads-agent/` in cloud sessions and puts it first on `PATH` via `$CLAUDE_ENV_FILE`.

  *(2026-09-25)*
- **The network proxy in cloud sessions blocks some documentation sites:** `developers.facebook.com`, `developers.google.com` and `ads-developers.googleblog.com` (WebFetch returns `EGRESS_BLOCKED`). WebSearch works and usually quotes those pages. *(2026-09-25)*
- **In cloud sessions, `api.github.com` answers only for this repo** (other repos get "GitHub access to this repository is not enabled"). `git ls-remote --tags https://github.com/<owner>/<repo>` and GitHub release downloads still work, e.g. to check action and CLI versions. `cli.doppler.com` is blocked. *(2026-09-25)*
- **Node's built-in TypeScript** (type stripping in Node 24) runs `scripts/*.ts` directly, with no build step: `node scripts/check-boundaries.ts`. Only erasable syntax is allowed (`erasableSyntaxOnly` in tsconfig): no enums, no parameter properties. *(2026-09-25)*
- **The cloud harness has its own Stop hook,** which blocks stopping while changes are uncommitted or unpushed. This repo's Stop hook only adds the memory check, plus a push check for local sessions. *(2026-09-25)*
- **The SER9 (local sessions, D-058)** runs Linux with Docker, and no login is needed after a reboot. It's shared with production (`ads-agent`) and possibly other projects' containers (e.g. SnapPool's `snappool-worker`). Use the compose project `ads-agent-dev` for dev, and **never** run `docker system prune` or `docker volume prune`. *(2026-09-25)*
- **Project hooks load at session start.** Edits to `.claude/settings.json` take effect in the *next* session. *(2026-09-25)*
- **Vercel functions are short-lived and reach Neon through the pooler,** so they can't use LISTEN. The dashboard polls `operator_requests` for results instead (BLUEPRINT M10a). *(design note, 2026-09-25)*

## External facts (checked 2026-09-25)

| Fact | Source | Re-check by |
|---|---|---|
| **Google conversion uploads:** since 2026-06-15, `ConversionUploadService.UploadClickConversions` (Google Ads API) is blocked for developer tokens not on the legacy allowlist (tokens active in roughly the first half of 2026). The replacement is the **Data Manager API**: `POST https://datamanager.googleapis.com/v1/events:ingest`, OAuth scope `https://www.googleapis.com/auth/datamanager`, **no developer token**. The destination is `operatingAccount {product: GOOGLE_ADS, accountId}` plus `productDestinationId` (the conversion action id). Offline events need a conversion action of type `UPLOAD_CLICKS`, and the OAuth user needs Standard or Admin access. | ppc.land "Google blocks new offline conversion imports via Ads API from June 15"; developers.google.com/data-manager/api (field mappings, `events.ingest`, destinations; reached via search) | before M13 (latest 2026-12-25) |
| **Google Ads API access levels:** **Explorer** (since Feb 2026) reaches production accounts without an application, with a cap of 2,880 operations/day, and blocks the planning services, account creation, user management and billing. **Basic** allows 15,000/day. **Standard** is unlimited. Applications have had backlogs. | developers.google.com/google-ads/api/docs/api-policy/access-levels; ppc.land "developer token application backlog as new API tier debuts" | 2026-12-25 |
| **Google Ads API version:** v25.2 is the latest. v25 was released 2026-07-22 and sunsets in Aug 2027. There are monthly minor releases and a few majors a year. | developers.google.com/google-ads/api/docs/release-notes (updated 2026-09-23); Google Ads Developer Blog | 2026-10-25 |
| **`google-ads-api` (Opteo, npm):** moved to Google Ads API **v25.1** on 2026-09-17 and requires Node ≥ 22. Each library release supports **one** API version, so the library and API versions are upgraded together. | github.com/Opteo/google-ads-api PR #549 | at M03 |
| **Official Google Ads MCP** (`googleads/google-ads-mcp`): read-only, with 3 tools (`list_accessible_accounts`, `search` (GAQL), `get_resource_metadata`). Open source since 2025-10-03. A July 2026 security fix stopped OAuth credentials being written to logs. | ppc.io/blog/google-ads-mcp; github.com/googleads/google-ads-mcp | 2026-12-25 |
| **Meta ads MCP** (`mcp.facebook.com/ads`): launched 2026-04-29; the "available for developers" post is dated 2026-07-16. Writes need the `ads_management` permission. Third-party, unofficial Meta MCP tools have got ad accounts banned. | developers.facebook.com blog 2026-07-16 (via search); soku.ai Meta Ads MCP guide; portermetrics.com | 2026-12-25 |
| **Meta Conversions API time limit:** if any website event's `event_time` is more than 7 days in the past, the **whole request is rejected** (error subcode 2804003). `physical_store` events allow 62 days. CRM events use `action_source=system_generated`. Batches hold up to 500 events. | customerlabs.com offline-conversions guide; dev.to "Meta's CAPI wants seconds"; search summaries of the Meta CAPI docs | at M12 |
| **Meta special ad categories** (Housing and others) now apply beyond the US: Canada, Europe, Asia and Africa. Housing removes age, gender and postcode targeting and forces a 15-mile minimum radius. **Marcus confirmed that it's required for property ads (D-062).** | data-axle.com "2025 Meta special ad categories rules"; jonloomer.com special ad categories guide | at M14 |
| **Node.js release lines:** 24 is the Active LTS (maintenance from 2026-10-20, end of life 2028-04-30); latest 24.x is **24.21.0** (2026-09-07). 22 is in maintenance (end of life 2027-04-30). 26 (26.10.0) becomes the Active LTS on 2026-10-28. **M00 pins Node 24.21.0**; move to 26 after it is LTS and the dependencies below support it. | endoflife.date/nodejs; nodejs.org/dist/index.json | 2026-11-15 (Node 26 switch) |
| **Toolchain versions pinned in M00** (`npm view`, 2026-09-25): pnpm **10.34.5** (latest-10; 11 and 12 exist, not adopted); TypeScript **6.0.3**; zod **4.6.5**; Vitest **5.0.1** (Node ^22.12 / ^24 / ≥26); ESLint **10.11.0**; typescript-eslint **8.70.1**; Turborepo **2.11.4**; dependency-cruiser **18.4.0**; Prettier **3.9.9**; commander **15.0.0**; fast-check **4.10.2**; pino **10.3.1**. | npm registry (`npm view <pkg> version`, `peerDependencies`, `engines`) | 2026-12-25 |
| **TypeScript 7 (7.0.2, the native Go compiler) is `latest`, but typescript-eslint 8.70 declares `typescript >=4.8.4 <6.1.0`.** So the repo stays on TypeScript 6.0.x until typescript-eslint supports 7. | npm registry: `npm view typescript-eslint peerDependencies` | 2026-12-25 |
| **AI SDK 7 is `latest`** (`ai` 7.0.114); v6 is still published under the `ai-v6` tag (6.0.291). The plan (PROPOSAL §10) says AI SDK 6. M06a decides after reading the v7 migration guide. | npm registry: `npm view ai dist-tags` | at M06a |
| **Drizzle (chosen in M01a):** `drizzle-orm` `latest` is **0.45.3** and `drizzle-kit` `latest` is **0.31.11** (both published 2026-09-21); 1.0 is still `1.0.0-rc.4` (tag `rc`). M01a pins the stable 0.45.3 / 0.31.11 with node-postgres `pg` **8.23.0** (`@types/pg` 8.23.1); drizzle-orm's peer range for `pg` is `>=8`. Move to 1.0 once it's `latest`. | npm registry: `npm view drizzle-orm dist-tags`, `npm view drizzle-kit dist-tags`, `npm view pg dist-tags` | 2026-12-25 |
| **AI SDK 6** deprecated `generateObject`/`streamObject`. Use `generateText`/`streamText` with `output: Output.object({ schema })`; multi-step flows need `stopWhen`. | ai-sdk.dev/docs/migration-guides/migration-guide-6-0; vercel.com/blog/ai-sdk-6 | at M06 |
| **Vercel's Hobby plan** is for personal, non-commercial use only. Commercial use needs Pro or Enterprise. *(Not a problem here: Marcus has Vercel Pro, D-054.)* | vercel.com/docs/plans/hobby; vercel.com/docs/limits/fair-use-guidelines | at M10 |
| **Neon:** the Free plan gives 100 compute-hours per project per month, and compute scales to zero after 5 idle minutes. The pooler is PgBouncer in **transaction mode**, so LISTEN/NOTIFY, session advisory locks and `SET` don't work through it. Use the direct host for those. *(Marcus is on the paid plan, D-055, so the free-tier limits don't apply; the pooler limits still do.)* | neon.com/docs/connect/connection-pooling; neon.com pricing and FAQs | at M01 |
| **Meta Conversions API, website events:** `client_user_agent`, `action_source` and `event_source_url` are **required**; events missing them may not be usable for optimisation or measurement. This is why SnapPool must capture the user agent and page URL (SNAPPOOL-TRACKING §3.3). | developers.facebook.com/documentation/ads-commerce/conversions-api/parameters (via search); Meta developer community thread "Action source, user agent and event source URL parameters required" | at M12 |
| **Meta account spending limit** is a **lifetime, cumulative** cap across all campaigns, not a monthly one. When it's reached, every campaign stops. It's reset manually in Payment Settings; some accounts offer auto-reset on the 1st of the month. | facebook.com/business/help/1892523930869907 (reset); adamigo.ai and leadenforce.com spending-limit guides | at M02 (the check runs from M04, D-063) |
| **UNVERIFIED:** whether the Meta Marketing API's `execution_options` (a validate-only option) is available on the campaign, ad set and ad update endpoints. The docs were blocked by the proxy. | — | verify in M12 |

## Design traps to remember while coding

These come from the v3 review. The ones marked *(training knowledge)* weren't re-verified on 2026-09-25, so verify them in the milestone named.

- **`JSON.stringify` throws on BigInt.** Money in JSON is a decimal string of micros (BLUEPRINT §3.1).
- **Meta money units:** budgets are in minor units (SGD cents), while insights report spend as decimal strings. Google uses micros. Convert exactly; never `parseFloat`.
- **Meta can't map an `fbclid` to a campaign.** Put `{{campaign.id}}`, `{{adset.id}}` and `{{ad.id}}` URL parameters on every ad, and capture them at landing.
- **Google shared budgets** belong to several campaigns, so this system never changes them.
- **Telegram `callback_data` is limited to 1–64 bytes.** *(training knowledge; well established. Confirm in M09.)*
- **Telegram allows one `getUpdates` consumer per bot.** Only the leader replica polls. *(training knowledge; M09)*
- **Google `click_view`** can be queried for only one day at a time, and only for the last ~90 days. *(training knowledge; M03)*
- **A Meta ad account's timezone and currency** can't simply be changed after creation. *(training knowledge; M02)*
- **Google can spend up to 2× a campaign's daily budget on a single day,** so daily budgets aren't hard caps. *(training knowledge; M14)*

## SnapPool facts (read from its repo on 2026-09-25, commit `a6c190a`)

See `docs/plan/SNAPPOOL-TRACKING.md` §1–2, the single place these live: stack, the funnel tables (`pool_requests` → `hosts` → `events.first_upload_at`), open signup since 2026-09-20, no checkout (free beta; signup window to 2026-11-30), no tracking at all, CSP, the middleware (only the `/host` login guard), pending requests deleted after 30 days, and what the privacy page promises today. Re-read that section, and SnapPool's own `memory/MEMORY.md`, before M05a, because SnapPool changes fast.
