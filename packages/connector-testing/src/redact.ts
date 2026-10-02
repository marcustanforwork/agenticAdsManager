// Redaction: what the recorder runs on every exchange before it is written, and the scanner every fixture
// file must pass (invariant 13: no secrets or personal data in the repo).
import type { Exchange } from './cassette.ts';
import { SECRET_PARAMS } from './cassette.ts';

/** Response headers worth keeping (the back-off logic reads them). Everything else is dropped. */
export const KEPT_HEADERS = [
  'content-type',
  'retry-after',
  'x-business-use-case-usage',
  'x-fb-ads-insights-throttle',
  'x-app-usage',
  'x-ad-account-usage',
] as const;

/** Object keys whose string values are people's or businesses' names, or contact details. */
export const PERSONAL_KEYS = [
  'name',
  'business_name',
  'first_name',
  'last_name',
  'full_name',
  'username',
  'user_name',
  'email',
  'phone',
  'owner',
] as const;

export const REDACTED = 'REDACTED';
const SAFE_EMAIL = 'redacted@example.invalid';

const TOKEN_PATTERNS: RegExp[] = [
  /EAA[A-Za-z0-9]{20,}/g, // Meta access tokens
  /ya29\.[A-Za-z0-9_-]{10,}/g, // Google OAuth access tokens
  /\b1\/\/[A-Za-z0-9_-]{20,}/g, // Google OAuth refresh tokens
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const secretParam = (p: string) => new RegExp(`([?&]${p}=)([^&"\\s]*)`, 'g');

/** Replaces tokens, emails and secret URL parameters inside one string. */
export function redactString(text: string): string {
  let out = text;
  for (const p of SECRET_PARAMS) out = out.replace(secretParam(p), `$1${REDACTED}`);
  for (const re of TOKEN_PATTERNS) out = out.replace(re, REDACTED);
  return out.replace(EMAIL, SAFE_EMAIL);
}

/** Replaces personal names with stable placeholders, so equal names stay equal within one redactor
 *  (a rename between two recordings still shows up as a change). */
export class Redactor {
  readonly #names = new Map<string, string>();

  #placeholder(key: string, value: string): string {
    if (key === 'email') return SAFE_EMAIL;
    let p = this.#names.get(value);
    if (p === undefined) {
      p = `redacted ${key} ${this.#names.size + 1}`;
      this.#names.set(value, p);
    }
    return p;
  }

  value(v: unknown, key?: string): unknown {
    if (typeof v === 'string') {
      return key !== undefined && (PERSONAL_KEYS as readonly string[]).includes(key)
        ? this.#placeholder(key, v)
        : redactString(v);
    }
    if (Array.isArray(v)) return v.map((x) => this.value(x));
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if ((SECRET_PARAMS as readonly string[]).includes(k)) continue;
        out[k] = this.value(x, k);
      }
      return out;
    }
    return v;
  }

  exchange(x: Exchange): Exchange {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(x.response.headers)) {
      const name = k.toLowerCase();
      if ((KEPT_HEADERS as readonly string[]).includes(name)) headers[name] = redactString(v);
    }
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(x.request.query)) {
      if (!(SECRET_PARAMS as readonly string[]).includes(k)) query[k] = redactString(v);
    }
    return {
      request: { method: x.request.method, path: redactString(x.request.path), query },
      response: { status: x.response.status, headers, body: this.value(x.response.body) },
    };
  }
}

/** Every secret-looking thing in a text (a fixture file). Empty means clean. */
export function findSecrets(text: string): string[] {
  const found: string[] = [];
  for (const re of TOKEN_PATTERNS) for (const m of text.matchAll(re)) found.push(`token: ${m[0].slice(0, 8)}…`);
  for (const p of SECRET_PARAMS) {
    for (const m of text.matchAll(secretParam(p))) if (m[2] !== REDACTED) found.push(`url parameter: ${p}`);
    if (new RegExp(`"${p}"\\s*:`).test(text)) found.push(`json key: ${p}`);
  }
  for (const m of text.matchAll(EMAIL)) if (m[0] !== SAFE_EMAIL) found.push(`email: …@${m[0].split('@')[1]}`);
  return found;
}
