/** The Google Ads API version every call uses: the single pin (GOTCHAS "Google Ads API version"). Minor releases
 *  (v25.1, v25.2…) share the major version's endpoint, so only the major version is pinned. v25 sunsets in
 *  August 2027; check for v26 (expected October 2026) by the GOTCHAS re-check date. Upgrading: change this
 *  constant, re-record the fixtures (`record-fixture` skill), fix any differences. */
export const GOOGLE_ADS_API_VERSION = 'v25';

export const GOOGLE_ADS_BASE_URL = 'https://googleads.googleapis.com';

/** The OAuth scope of the Google Ads API (read and write share it; the read/write split is the identity's
 *  access level on the manager account: Read only vs Standard, D-046/D-071). */
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

/** Google's OAuth token endpoint. A credential naming any other token endpoint is refused. */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Explorer access: operations a day for the whole Cloud project (D-070, GOTCHAS "Google Ads API operations"). */
export const EXPLORER_DAILY_OPERATIONS = 2_880;
