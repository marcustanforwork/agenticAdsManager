// Signing in to Google (D-071 / D-046): one interface, two providers. The token exchange uses its own `fetch`,
// never the one the API client records, so a fixture can't capture a token, an assertion or a key.
import { createSign } from 'node:crypto';
import { GoogleAuthError } from './errors.ts';
import { GOOGLE_ADS_SCOPE, GOOGLE_TOKEN_URL } from './version.ts';

export interface AccessTokenProvider {
  /** A valid OAuth access token for the Google Ads scope (cached until shortly before it expires). */
  getAccessToken(): Promise<string>;
  /** Forget the cached token, e.g. after Google answered 401. */
  invalidate(): void;
}

interface TokenOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/** Shared by both providers: exchanges a form for a token at Google's token endpoint, and caches it. */
abstract class OAuthTokenProvider implements AccessTokenProvider {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  protected readonly now: () => Date;
  #token: { value: string; expiresAt: number } | undefined;

  constructor(opts: TokenOptions) {
    this.#fetch = opts.fetch ?? fetch;
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
    this.now = opts.now ?? (() => new Date());
  }

  protected abstract form(): URLSearchParams;

  invalidate(): void {
    this.#token = undefined;
  }

  async getAccessToken(): Promise<string> {
    const nowMs = this.now().getTime();
    if (this.#token && this.#token.expiresAt > nowMs) return this.#token.value;
    let res: Response;
    let text: string;
    try {
      res = await this.#fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: this.form().toString(),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      text = await res.text();
    } catch {
      // The request body holds the credential: the cause is never attached.
      throw new GoogleAuthError('the token endpoint could not be reached (network or timeout)');
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // handled below
    }
    const token = body['access_token'];
    if (!res.ok || typeof token !== 'string' || token === '') {
      const code = typeof body['error'] === 'string' ? body['error'] : `HTTP ${res.status}`;
      const why = typeof body['error_description'] === 'string' ? `: ${body['error_description']}` : '';
      throw new GoogleAuthError(`${code}${why}`);
    }
    const lifetime = typeof body['expires_in'] === 'number' ? body['expires_in'] : 3_600;
    // Renew a minute early, so a token never expires mid-request.
    this.#token = { value: token, expiresAt: nowMs + Math.max(0, lifetime - 60) * 1000 };
    return token;
  }
}

const base64url = (data: string | Buffer): string => Buffer.from(data).toString('base64url');

/** A service account's key file (D-071): a JWT signed with its private key, exchanged for an access token. */
export class ServiceAccountTokenProvider extends OAuthTokenProvider {
  readonly #clientEmail: string;
  readonly #privateKey: string;
  readonly #keyId: string | undefined;

  constructor(opts: TokenOptions & { clientEmail: string; privateKey: string; privateKeyId?: string }) {
    super(opts);
    this.#clientEmail = opts.clientEmail;
    this.#privateKey = opts.privateKey;
    this.#keyId = opts.privateKeyId;
  }

  /** The signed assertion (RS256), valid for an hour. */
  assertion(): string {
    const iat = Math.floor(this.now().getTime() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', ...(this.#keyId === undefined ? {} : { kid: this.#keyId }) };
    const claims = { iss: this.#clientEmail, scope: GOOGLE_ADS_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3_600 };
    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    let signature: string;
    try {
      signature = createSign('RSA-SHA256').update(unsigned).sign(this.#privateKey, 'base64url');
    } catch {
      throw new GoogleAuthError('the service account private key could not sign (is it the PEM from the key file?)');
    }
    return `${unsigned}.${signature}`;
  }

  protected form(): URLSearchParams {
    return new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: this.assertion(),
    });
  }
}

/** A Google login's refresh token plus the OAuth client it was issued to (D-046, if Q13 keeps logins). */
export class RefreshTokenProvider extends OAuthTokenProvider {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #refreshToken: string;

  constructor(opts: TokenOptions & { clientId: string; clientSecret: string; refreshToken: string }) {
    super(opts);
    this.#clientId = opts.clientId;
    this.#clientSecret = opts.clientSecret;
    this.#refreshToken = opts.refreshToken;
  }

  protected form(): URLSearchParams {
    return new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
      refresh_token: this.#refreshToken,
    });
  }
}

/** A fixed token: for replay tests, where no sign-in happens. */
export class StaticTokenProvider implements AccessTokenProvider {
  readonly #token: string;
  constructor(token: string) {
    this.#token = token;
  }
  getAccessToken(): Promise<string> {
    return Promise.resolve(this.#token);
  }
  invalidate(): void {}
}
