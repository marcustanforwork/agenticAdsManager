import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ADS_SCOPE,
  GOOGLE_TOKEN_URL,
  GoogleAuthError,
  RefreshTokenProvider,
  ServiceAccountTokenProvider,
  parseGoogleReadCredential,
  tokenProviderFor,
} from '../src/index.ts';

// A throwaway key made at run time: no key material is ever committed (the secret scanner would refuse it).
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const KEY_FILE = {
  type: 'service_account',
  project_id: 'ads-agent-test',
  private_key_id: 'abc123',
  private_key: PEM,
  client_email: 'ads-agent-read@ads-agent-test.iam.gserviceaccount.com',
  client_id: '1234567890',
  token_uri: GOOGLE_TOKEN_URL,
};

function tokenEndpoint(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), form: new URLSearchParams(String(init?.body)) });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('unexpected token request'));
    return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }));
  };
  return { calls, fetch };
}

describe('ServiceAccountTokenProvider', () => {
  it('signs an RS256 assertion for the Google Ads scope and caches the token until shortly before expiry', async () => {
    let now = new Date('2026-10-06T00:00:00Z');
    const t = tokenEndpoint([
      { status: 200, body: { access_token: 'ya29.first', expires_in: 3599, token_type: 'Bearer' } },
      { status: 200, body: { access_token: 'ya29.second', expires_in: 3599, token_type: 'Bearer' } },
      { status: 200, body: { access_token: 'ya29.third', expires_in: 3599, token_type: 'Bearer' } },
    ]);
    const p = tokenProviderFor(KEY_FILE, { fetch: t.fetch, now: () => now });
    expect(p).toBeInstanceOf(ServiceAccountTokenProvider);
    expect(await p.getAccessToken()).toBe('ya29.first');
    expect(await p.getAccessToken()).toBe('ya29.first'); // cached
    expect(t.calls).toHaveLength(1);

    const [call] = t.calls;
    expect(call?.url).toBe(GOOGLE_TOKEN_URL);
    expect(call?.form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = (call?.form.get('assertion') ?? '').split('.');
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, signature ?? '', 'base64url');
    expect(verified).toBe(true);
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: 'abc123',
    });
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toEqual({
      iss: KEY_FILE.client_email,
      scope: GOOGLE_ADS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: 1_791_244_800,
      exp: 1_791_244_800 + 3600,
    });

    now = new Date(now.getTime() + 3_540_000); // 59 min later: within the last minute, so renewed
    expect(await p.getAccessToken()).toBe('ya29.second');
    p.invalidate();
    expect(await p.getAccessToken()).toBe('ya29.third');
  });

  it("reports Google's error code, never the assertion or the key", async () => {
    const t = tokenEndpoint([
      { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' } },
    ]);
    const err = (await tokenProviderFor(KEY_FILE, { fetch: t.fetch })
      .getAccessToken()
      .catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect(err.message).toBe('Google sign-in failed: invalid_grant: Invalid JWT Signature.');
    expect(err.message).not.toMatch(/eyJ|PRIVATE/);
  });

  it('fails cleanly when the endpoint is unreachable, without attaching the request', async () => {
    const p = tokenProviderFor(KEY_FILE, { fetch: () => Promise.reject(new TypeError('fetch failed')) });
    const err = (await p.getAccessToken().catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect(err.cause).toBeUndefined();
  });

  it('refuses a key it cannot sign with', () => {
    const p = new ServiceAccountTokenProvider({ clientEmail: 'a@b.iam.gserviceaccount.com', privateKey: 'not a key' });
    expect(() => p.assertion()).toThrow(GoogleAuthError);
  });
});

describe('RefreshTokenProvider', () => {
  it('exchanges the refresh token with the OAuth client', async () => {
    const t = tokenEndpoint([{ status: 200, body: { access_token: 'ya29.user', expires_in: 3599 } }]);
    const p = tokenProviderFor(
      {
        type: 'authorized_user',
        client_id: 'client-id-0123456789',
        client_secret: 'client-secret-0123',
        refresh_token: 'refresh-0123456789',
      },
      { fetch: t.fetch },
    );
    expect(p).toBeInstanceOf(RefreshTokenProvider);
    expect(await p.getAccessToken()).toBe('ya29.user');
    expect(Object.fromEntries(t.calls[0]?.form ?? [])).toEqual({
      grant_type: 'refresh_token',
      client_id: 'client-id-0123456789',
      client_secret: 'client-secret-0123',
      refresh_token: 'refresh-0123456789',
    });
  });
});

describe('parseGoogleReadCredential', () => {
  it('accepts a key file or an authorized_user credential', () => {
    expect(parseGoogleReadCredential(KEY_FILE).type).toBe('service_account');
  });

  it('names the broken fields, never their values', () => {
    const bad = { ...KEY_FILE, private_key: 'no key here', client_email: 'not-an-email' };
    const err = (() => {
      try {
        parseGoogleReadCredential(bad);
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).toMatch(/client_email, private_key|private_key, client_email/);
    expect(err?.message).not.toContain('no key here');
  });

  it('refuses a key file that sends the assertion anywhere but Google', () => {
    expect(() => parseGoogleReadCredential({ ...KEY_FILE, token_uri: 'https://evil.example/token' })).toThrow(
      /token_uri/,
    );
  });

  it('refuses an unknown credential type, e.g. the Meta one', () => {
    expect(() => parseGoogleReadCredential({ accessToken: 'x', appSecret: 'y' })).toThrow(/type/);
  });
});
