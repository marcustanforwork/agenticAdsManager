---
name: verify-external-facts
description: Check facts about external APIs, libraries and services against current official sources before relying on them. Covers the Google Ads API, Google Data Manager API, Meta Marketing API and Conversions API, Telegram Bot API, Neon, Vercel, Cloudflare Access, Langfuse, Vercel AI SDK, Drizzle, zod, Node.js and pnpm. Use when starting a milestone that touches them, when a GOTCHAS entry has passed its re-check date, and when code fails in a way that suggests the API or library changed.
---

# Verify external facts

Platform APIs change monthly. Google closed its old conversion-upload path in June 2026, for example. **Memory from training data is not a source.**

## 1. List the claims the work depends on

These include versions, endpoints, field names, limits, quotas, auth scopes, pricing and deprecations. Start from the milestone's **Read first** list and the relevant rows of `docs/plan/PROPOSAL.md` §7.

## 2. Check each claim

- Use WebSearch and WebFetch where available. Prefer official docs, changelogs, release notes and the vendors' developer blogs over third-party articles. If only third-party sources are reachable, say so.
- **Cloud sessions:** the network proxy blocks some documentation sites, e.g. `developers.facebook.com`, `developers.google.com` and `ads-developers.googleblog.com` (as of 2026-09-25). Search results often quote them. If they don't, mark the fact **unverified**, and either ask Marcus to paste the page or verify it in a local session.
- **Libraries:** read the package's changelog or README, and check the published version (`npm view <package> version` works from the container).

## 3. Record it in the "External facts" table of `docs/memory/GOTCHAS.md`

Each fact gets one row: **fact · source URL · checked YYYY-MM-DD · re-check by YYYY-MM-DD**. The re-check date is about 90 days out, or 30 days for fast-moving platform APIs. Replace an older entry for the same fact rather than adding a duplicate.

## 4. If the plan is wrong

Run the `update-plan` skill. A changed fact is a correction Claude may make on its own, unless it forces a product decision. In that case, ask Marcus.

## 5. In code

Pin each integration's version in one constant or config file, with a comment pointing to its GOTCHAS entry. Never write "latest", or a version number you haven't verified.
