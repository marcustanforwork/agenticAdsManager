// Sign-in (M10a): Cloudflare Access sits in front of the dashboard and adds a signed token to every request it lets
// through, in the `Cf-Access-Jwt-Assertion` header. We verify it against the team's published keys, issuer and the
// application's audience tag, and fail closed: no config, no token, a bad signature, the wrong audience or issuer,
// an expired token or no email all mean "not signed in". So the raw `*.vercel.app` address, which Access doesn't
// front, gets a 401 too. Facts and sources: docs/memory/GOTCHAS.md ("Cloudflare Access tokens").
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** The header Access adds (lower case, as Headers reads it). The cookie isn't guaranteed, so it isn't used. */
export const ACCESS_HEADER = 'cf-access-jwt-assertion';

export interface AccessConfig {
  /** `https://<team>.cloudflareaccess.com`: the issuer, and where the keys are published. */
  teamDomain: string;
  /** The Access application's AUD tag. */
  audience: string;
}

const TEAM_DOMAIN = /^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/;

/** Reads CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD. Null (so every request is refused) when either is missing or
 *  malformed: a dashboard without its Access settings must not open. */
export function accessConfigFromEnv(env: Readonly<Record<string, string | undefined>>): AccessConfig | null {
  const teamDomain = (env['CF_ACCESS_TEAM_DOMAIN'] ?? '').trim().replace(/\/+$/, '');
  const audience = (env['CF_ACCESS_AUD'] ?? '').trim();
  if (!TEAM_DOMAIN.test(teamDomain) || !/^[0-9a-f]{32,128}$/.test(audience)) return null;
  return { teamDomain, audience };
}

// One key set per team: jose caches the keys and refetches on an unknown key id (Access rotates them).
const keySets = new Map<string, JWTVerifyGetKey>();
export function teamKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keySets.get(teamDomain);
  if (keys === undefined) {
    keys = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`), { timeoutDuration: 5_000 });
    keySets.set(teamDomain, keys);
  }
  return keys;
}

export interface Operator {
  /** The verified email, in lower case. The dashboard records requests as `web:<email>`. */
  email: string;
}

/** The signed-in operator, or null for anything that isn't a valid Access token for this application. */
export async function verifyAccessToken(
  token: string | null | undefined,
  config: AccessConfig | null,
  keys: JWTVerifyGetKey | null = config === null ? null : teamKeys(config.teamDomain),
): Promise<Operator | null> {
  if (config === null || keys === null || token === null || token === undefined || token === '') return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'email'],
    });
    const email = typeof payload['email'] === 'string' ? payload['email'].trim().toLowerCase() : '';
    return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) ? { email } : null;
  } catch {
    return null;
  }
}
