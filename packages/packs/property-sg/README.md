# `@ads/pack-property-sg`

**Job:** The Property SG product pack (BLUEPRINT M05b, the G8 test: added with no change to the core).
- `src/manifest.ts` (pure data): outcome stages `form_fill` (the KPI), `qualified_viewing`, `booked`; the launch phases teaser, VVIP, booking and clearing; the project fact schema; thresholds; Meta's Housing category; the CEA required strings as placeholders.
- `src/runtime.ts`: `detectPhase` from the offering's `launchDates`, and the outcome adapter.
- `src/airtable.ts`: the adapter. It reads the leads table of the Tally → Airtable pipeline (env `PROPERTY_AIRTABLE_TOKEN`, `PROPERTY_AIRTABLE_BASE_ID`, `PROPERTY_AIRTABLE_TABLE`) and hashes emails inside the pack. `LEAD_FIELDS` is the stage ↔ field mapping; it was written against a hand-made fixture (`test/fixtures/`), so confirm it against the real base when property resumes.

**May depend on:** `@ads/contracts`, `@ads/pack-sdk`, plus its own adapter libraries (`zod`; the platform's `fetch`). **Never** a connector, core, gateway or db.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).
