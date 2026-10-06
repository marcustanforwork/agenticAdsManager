// Errors the Google connector throws. Messages never contain a token or a key (scrubbed), so they're safe to log.

const scrub = (text: string): string =>
  text
    .replace(/ya29\.[A-Za-z0-9_-]+/g, 'REDACTED')
    .replace(/\b1\/\/[A-Za-z0-9_-]+/g, 'REDACTED')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'REDACTED');

export interface GoogleErrorInfo {
  /** HTTP status. */
  status: number;
  /** Google's canonical status, e.g. `INVALID_ARGUMENT`, `PERMISSION_DENIED`. */
  grpcStatus?: string;
  message: string;
  /** `<kind>:<name>` for each Google Ads error, e.g. `queryError:PROHIBITED_FIELD_IN_SELECT_CLAUSE`. */
  errorCodes?: string[];
  requestId?: string;
}

/** Google answered with an error. */
export class GoogleAdsApiError extends Error {
  readonly status: number;
  readonly grpcStatus: string | undefined;
  readonly errorCodes: string[];
  readonly requestId: string | undefined;

  constructor(info: GoogleErrorInfo) {
    const codes = info.errorCodes?.length ? ` [${info.errorCodes.join(', ')}]` : '';
    super(
      `Google Ads API error ${info.status}${info.grpcStatus ? ` ${info.grpcStatus}` : ''}${codes}: ${scrub(info.message)}`,
    );
    this.name = 'GoogleAdsApiError';
    this.status = info.status;
    this.grpcStatus = info.grpcStatus;
    this.errorCodes = info.errorCodes ?? [];
    this.requestId = info.requestId;
  }
}

/** Rate limited (`RESOURCE_TEMPORARILY_EXHAUSTED`) for longer than the client is willing to wait. */
export class GoogleRateLimitError extends GoogleAdsApiError {
  readonly retryAfterMs: number;

  constructor(info: GoogleErrorInfo & { retryAfterMs: number }) {
    super(info);
    this.name = 'GoogleRateLimitError';
    this.retryAfterMs = info.retryAfterMs;
    this.message = `${this.message} (rate limited; retry in ${Math.ceil(info.retryAfterMs / 1000)} s)`;
  }
}

/** The daily operations quota is used up: Google's own (`RESOURCE_EXHAUSTED`) or our soft cap on `api_usage`.
 *  Never retried; the next day's sync picks up. */
export class GoogleQuotaError extends Error {
  constructor(detail: string) {
    super(`Google Ads API daily operations quota: ${scrub(detail)}`);
    this.name = 'GoogleQuotaError';
  }
}

/** Signing in failed (the token exchange). The message names Google's error code, never the credential. */
export class GoogleAuthError extends Error {
  constructor(detail: string) {
    super(`Google sign-in failed: ${scrub(detail)}`);
    this.name = 'GoogleAuthError';
  }
}

/** The response didn't have the shape we expect: Google changed something, or the fixture is wrong. */
export class GoogleShapeError extends Error {
  constructor(what: string, issues: string) {
    super(`unexpected Google Ads response for ${what}: ${issues}`);
    this.name = 'GoogleShapeError';
  }
}
