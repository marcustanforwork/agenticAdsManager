// Errors the Meta connector throws. Messages never contain a token (scrubbed), so they're safe to log.

const scrub = (text: string): string => text.replace(/EAA[A-Za-z0-9]+/g, 'REDACTED');

/** Meta answered with an error object (`{ error: { message, type, code, error_subcode, fbtrace_id } }`). */
export class MetaApiError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly fbtraceId: string | undefined;

  constructor(input: { status: number; message: string; code?: number; subcode?: number; fbtraceId?: string }) {
    const codes = [input.code, input.subcode].filter((c) => c !== undefined).join('/');
    super(`Meta API error ${input.status}${codes ? ` (${codes})` : ''}: ${scrub(input.message)}`);
    this.name = 'MetaApiError';
    this.status = input.status;
    this.code = input.code;
    this.subcode = input.subcode;
    this.fbtraceId = input.fbtraceId;
  }
}

/** Throttled for longer than the client is willing to wait. Retry after `retryAfterMs`. */
export class MetaRateLimitError extends MetaApiError {
  readonly retryAfterMs: number;

  constructor(input: ConstructorParameters<typeof MetaApiError>[0] & { retryAfterMs: number }) {
    super(input);
    this.name = 'MetaRateLimitError';
    this.retryAfterMs = input.retryAfterMs;
    this.message = `${this.message} (rate limited; retry in ${Math.ceil(input.retryAfterMs / 60_000)} min)`;
  }
}

/** The response didn't have the shape we expect: Meta changed something, or the fixture is wrong. */
export class MetaShapeError extends Error {
  constructor(what: string, issues: string) {
    super(`unexpected Meta response for ${what}: ${issues}`);
    this.name = 'MetaShapeError';
  }
}
