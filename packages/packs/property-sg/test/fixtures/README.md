# Airtable fixtures (hand-made)

`leads-page-*.json` are two pages of the Airtable Web API's **list records** response (`{records: [{id, createdTime, fields}], offset?}`; GOTCHAS "Airtable Web API"), written by hand in M05b: the real base wasn't reachable from the cloud, and the property product is on hold. The field names are `LEAD_FIELDS` in `src/airtable.ts`.

Everything here is made up: the emails use reserved example domains (`example.com`, `example.net`, `staff.example`), and the ids only look like real ones. Empty fields are left out, as Airtable does.

**When property resumes** (live Airtable wiring): record a page of the real leads table with a read-only token, replace every value with made-up ones, keep its field names, and fix `LEAD_FIELDS` to match.
