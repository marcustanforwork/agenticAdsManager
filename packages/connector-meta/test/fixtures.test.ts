// Redaction: every committed fixture parses as a cassette and holds no token, secret parameter or email.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Cassette, findSecrets } from '@ads/connector-testing';
import { describe, expect, it } from 'vitest';
import { FAKE_TOKEN, FIXTURES } from './helpers.ts';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : [],
  );
}

describe('fixtures', () => {
  const all = files(FIXTURES);

  it('exist', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all.map((f) => [f.slice(FIXTURES.length + 1), f]))('%s is a clean cassette', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(findSecrets(text)).toEqual([]);
    expect(text).not.toContain(FAKE_TOKEN);
    expect(() => Cassette.parse(JSON.parse(text))).not.toThrow();
  });
});
