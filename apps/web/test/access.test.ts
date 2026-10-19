// Sign-in (M10a): the proxy lets a request through only with a valid Cloudflare Access token for this application;
// anything else gets a 401. Tokens are signed here with a local key pair standing in for the team's keys.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_HEADER, type AccessConfig, accessConfigFromEnv, verifyAccessToken } from '../src/lib/access.ts';
import { gate } from '../src/lib/gate.ts';
import { proxy } from '../src/proxy.ts';

const TEAM = 'https://adsteam.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const config: AccessConfig = { teamDomain: TEAM, audience: AUD };

let key: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  otherKey = (await generateKeyPair('RS256')).privateKey;
});
const keys = () => createLocalJWKSet({ keys: [jwk] });

async function token(
  claims: Record<string, unknown> = { email: 'Marcus@Example.com' },
  opts: { aud?: string; iss?: string; exp?: string | number; signWith?: CryptoKey; kid?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? 'k1' })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(opts.signWith ?? key);
}

const headersWith = (value?: string): Headers => new Headers(value === undefined ? {} : { [ACCESS_HEADER]: value });
const deps = { config: () => config, keys };

describe('the Access config', () => {
  it('needs a cloudflareaccess.com team domain and a hex AUD tag; anything else is null (every request refused)', () => {
    expect(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: `${TEAM}/`, CF_ACCESS_AUD: AUD })).toEqual(config);
    expect(accessConfigFromEnv({})).toBeNull();
    expect(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: TEAM })).toBeNull();
    expect(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: 'https://evil.example.com', CF_ACCESS_AUD: AUD })).toBeNull();
    expect(
      accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: 'http://adsteam.cloudflareaccess.com', CF_ACCESS_AUD: AUD }),
    ).toBeNull();
    expect(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: 'not hex' })).toBeNull();
  });
});

describe('verifyAccessToken', () => {
  it('returns the email, in lower case, for a valid token', async () => {
    expect(await verifyAccessToken(await token(), config, keys())).toEqual({ email: 'marcus@example.com' });
  });

  it('refuses a token for another application, another team, expired, badly signed, or without an email', async () => {
    const bad = [
      await token({ email: 'm@example.com' }, { aud: 'b'.repeat(64) }),
      await token({ email: 'm@example.com' }, { iss: 'https://other.cloudflareaccess.com' }),
      await token({ email: 'm@example.com' }, { exp: Math.floor(Date.now() / 1000) - 120 }),
      await token({ email: 'm@example.com' }, { signWith: otherKey }),
      await token({ email: 'm@example.com' }, { kid: 'unknown' }),
      await token({}),
      await token({ email: 'not an email' }),
      'not.a.jwt',
      '',
    ];
    for (const t of bad) expect(await verifyAccessToken(t, config, keys())).toBeNull();
  });

  it('refuses an unsigned token (alg none)', async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${enc({ alg: 'none' })}.${enc({ email: 'm@example.com', iss: TEAM, aud: AUD, exp: now + 600 })}.`;
    expect(await verifyAccessToken(unsigned, config, keys())).toBeNull();
  });

  it('refuses everything when the dashboard has no Access config', async () => {
    expect(await verifyAccessToken(await token(), null, keys())).toBeNull();
  });
});

describe('the proxy (middleware)', () => {
  it('gets a 401 for a missing, invalid or wrong-audience token', async () => {
    const cases = [
      headersWith(),
      headersWith('garbage'),
      headersWith(await token({ email: 'm@example.com' }, { aud: 'c'.repeat(64) })),
      headersWith(await token({ email: 'm@example.com' }, { signWith: otherKey })),
    ];
    for (const h of cases) {
      const response = await gate(h, deps);
      expect(response?.status).toBe(401);
      expect(response?.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('lets a valid token through', async () => {
    expect(await gate(headersWith(await token()), deps)).toBeNull();
  });

  it('fails closed without config: even a well-formed token gets a 401', async () => {
    expect((await gate(headersWith(await token()), { config: () => null, keys }))?.status).toBe(401);
  });

  it('the proxy itself refuses a request with no token (this is what the raw *.vercel.app address gets)', async () => {
    const response = await proxy(new NextRequest('https://ads-dashboard.vercel.app/products/some-product/settings'));
    expect(response.status).toBe(401);
  });
});
