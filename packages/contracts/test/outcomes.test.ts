// Outcome contracts: route destinations that aren't set up yet, and the per-platform email hashes (D-076).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FeedbackRoute,
  HashedContact,
  hashEmail,
  normaliseEmailForGoogle,
  normaliseEmailForMeta,
  platformOfUtmSource,
} from '../src/index.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('FeedbackRoute', () => {
  it('accepts a destination that is not set up yet (null), but not an empty one', () => {
    expect(FeedbackRoute.safeParse({ stage: 'signup', platform: 'google', destinationId: null }).success).toBe(true);
    expect(FeedbackRoute.safeParse({ stage: 'signup', platform: 'google', destinationId: '' }).success).toBe(false);
    expect(FeedbackRoute.safeParse({ stage: 'signup', platform: 'google' }).success).toBe(false);
  });
});

describe('email hashing', () => {
  it("matches Meta's published example (trim, lower-case, SHA-256 hex)", () => {
    expect(normaliseEmailForMeta('  John_Smith@gmail.com ')).toBe('john_smith@gmail.com');
    expect(hashEmail('John_Smith@gmail.com').emailSha256).toBe(
      '62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f',
    );
  });

  it("follows Google's rules: no whitespace, lower-case, no dots before a Gmail address's @", () => {
    expect(normaliseEmailForGoogle(' Jane.Q.Doe@GMail.com ')).toBe('janeqdoe@gmail.com');
    expect(normaliseEmailForGoogle('jane.doe@googlemail.com')).toBe('janedoe@googlemail.com');
    expect(normaliseEmailForGoogle('Jane .Doe@Example.com')).toBe('jane.doe@example.com');
    expect(hashEmail('Jane.Doe@gmail.com')).toEqual({
      emailSha256: sha256('jane.doe@gmail.com'),
      emailSha256Google: sha256('janedoe@gmail.com'),
    });
  });

  it('gives hashes only (valid HashedContact), and nothing for an empty email', () => {
    const hashed = hashEmail('someone@example.com');
    expect(HashedContact.parse(hashed)).toEqual(hashed);
    expect(JSON.stringify(hashed)).not.toContain('someone');
    expect(hashEmail('   ')).toEqual({});
  });
});

describe('platformOfUtmSource', () => {
  it('names the ad platform a utm_source means, and nothing for other sources', () => {
    expect(platformOfUtmSource('google')).toBe('google');
    for (const s of ['meta', 'Facebook', ' instagram ', 'fb', 'IG']) expect(platformOfUtmSource(s)).toBe('meta');
    for (const s of ['newsletter', 'linkedin', '', undefined]) expect(platformOfUtmSource(s)).toBeUndefined();
  });
});
