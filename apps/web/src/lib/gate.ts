// The proxy's decision, apart from Next so it can be tested: every request needs a valid Access token, or it gets
// a 401. Nothing is excluded, not even static files (they carry no data, but a gap in the matcher is how such
// checks get bypassed).
import type { JWTVerifyGetKey } from 'jose';
import { ACCESS_HEADER, type AccessConfig, accessConfigFromEnv, verifyAccessToken } from './access.ts';

export interface GateDeps {
  config: () => AccessConfig | null;
  /** Tests pass local keys; the default fetches the team's. */
  keys?: (config: AccessConfig) => JWTVerifyGetKey;
}

const defaults: GateDeps = { config: () => accessConfigFromEnv(process.env) };

/** A 401 for anyone without a valid token, or null to let the request through. */
export async function gate(headers: Headers, deps: GateDeps = defaults): Promise<Response | null> {
  const config = deps.config();
  const keys = config === null || deps.keys === undefined ? undefined : deps.keys(config);
  const operator = await verifyAccessToken(headers.get(ACCESS_HEADER), config, keys);
  if (operator !== null) return null;
  return new Response('Unauthorized: sign in through Cloudflare Access.', {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
