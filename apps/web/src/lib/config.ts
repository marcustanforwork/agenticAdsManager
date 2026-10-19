// Which database the dashboard may use (M10a). Only Vercel's production deployment (VERCEL_ENV=production) reads
// DASHBOARD_DATABASE_URL. Everything else, previews and a local `next dev` included, reads only
// DASHBOARD_DEV_DATABASE_URL (a Neon dev branch), so it can never reach the production database, even if the
// production variable is set there by mistake. On Vercel the URL must be Neon's pooled host (`-pooler`): functions
// are short-lived and many, and the pooler is what they're for.
export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function databaseUrlFromEnv(env: Env): string {
  const vercelEnv = env['VERCEL_ENV']; // 'production' | 'preview' | 'development' on Vercel; unset locally
  const name = vercelEnv === 'production' ? 'DASHBOARD_DATABASE_URL' : 'DASHBOARD_DEV_DATABASE_URL';
  const url = (env[name] ?? '').trim();
  if (url === '') throw new ConfigError(`${name} is not set`);
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new ConfigError(`${name} is not a URL`);
  }
  if (vercelEnv !== undefined && !host.includes('-pooler.')) {
    throw new ConfigError(`${name} must use Neon's pooled host (-pooler) on Vercel`);
  }
  return url;
}
