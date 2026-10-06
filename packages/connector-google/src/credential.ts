// The shape of a Google read credential, as stored in the vault (`ads credentials put --role read`). The vault
// returns it unvalidated (M01b); it's checked here, and errors name fields only, never values.
//   - a service account's key file, as downloaded from the Cloud console (D-071, Q13 option A), or
//   - a Google login: `{ "type": "authorized_user", client_id, client_secret, refresh_token }` (D-046, option B),
//     the format `gcloud` writes for user credentials.
import { z } from 'zod';
import { type AccessTokenProvider, RefreshTokenProvider, ServiceAccountTokenProvider } from './tokens.ts';
import { GOOGLE_TOKEN_URL } from './version.ts';

const ServiceAccountKey = z.looseObject({
  type: z.literal('service_account'),
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
  private_key_id: z.string().optional(),
  /** Must be Google's token endpoint: a signed assertion is never sent anywhere else. */
  token_uri: z.literal(GOOGLE_TOKEN_URL).optional(),
});
const AuthorizedUser = z.looseObject({
  type: z.literal('authorized_user'),
  client_id: z.string().min(10),
  client_secret: z.string().min(10),
  refresh_token: z.string().min(10),
});

export const GoogleReadCredential = z.discriminatedUnion('type', [ServiceAccountKey, AuthorizedUser]);
export type GoogleReadCredential = z.infer<typeof GoogleReadCredential>;

export function parseGoogleReadCredential(value: unknown): GoogleReadCredential {
  const r = GoogleReadCredential.safeParse(value);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(root)'))].join(', ');
    throw new Error(
      `the stored Google read credential is invalid (check: ${fields}); expected a service account key file ` +
        `or { type: "authorized_user", client_id, client_secret, refresh_token }`,
    );
  }
  return r.data;
}

/** The token provider for a stored credential. `fetch` here is the token endpoint's, never the recorded one. */
export function tokenProviderFor(
  credential: unknown,
  opts: { fetch?: typeof fetch; now?: () => Date } = {},
): AccessTokenProvider {
  const c = parseGoogleReadCredential(credential);
  if (c.type === 'service_account') {
    return new ServiceAccountTokenProvider({
      ...opts,
      clientEmail: c.client_email,
      privateKey: c.private_key,
      ...(c.private_key_id === undefined ? {} : { privateKeyId: c.private_key_id }),
    });
  }
  return new RefreshTokenProvider({
    ...opts,
    clientId: c.client_id,
    clientSecret: c.client_secret,
    refreshToken: c.refresh_token,
  });
}
