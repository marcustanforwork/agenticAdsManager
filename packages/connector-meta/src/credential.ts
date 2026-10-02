// The shape of a Meta read credential, as stored in the vault (`ads credentials put --role read`).
// The vault returns it unvalidated (M01b); it's checked here, and errors name fields only, never values.
import { z } from 'zod';

export const MetaReadCredential = z.object({
  /** A system-user token with `ads_read` (never `ads_management` for the read role). */
  accessToken: z.string().min(20),
  /** The app secret, for `appsecret_proof`. */
  appSecret: z.string().min(16),
});
export type MetaReadCredential = z.infer<typeof MetaReadCredential>;

export function parseMetaReadCredential(value: unknown): MetaReadCredential {
  const r = MetaReadCredential.safeParse(value);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(root)'))].join(', ');
    throw new Error(
      `the stored Meta read credential is invalid (check: ${fields}); expected { accessToken, appSecret }`,
    );
  }
  return r.data;
}
