import { createRequire } from 'node:module';
import { join } from 'node:path';
import { cruise, type IConfiguration } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';
import { checkBoundaries } from '../check-boundaries.ts';

const repoRoot = join(import.meta.dirname, '..', '..');
const fixture = (name: string): string => join(import.meta.dirname, 'fixtures', name);

describe('check-boundaries (package.json edges)', () => {
  it('passes on this repository', () => {
    expect(checkBoundaries(repoRoot)).toEqual([]);
  });

  it('fails when core depends on connector-google-write', () => {
    const violations = checkBoundaries(fixture('core-imports-write'));
    expect(violations).toEqual([
      expect.stringContaining('packages/core: may not depend on @ads/connector-google-write'),
    ]);
  });

  it('fails when apps/web reaches beyond contracts + db through its dependency tree', () => {
    const violations = checkBoundaries(fixture('web-tree'));
    expect(violations).toContainEqual(expect.stringContaining('packages/db: may not depend on @ads/core'));
    expect(violations).toContainEqual(expect.stringContaining('apps/web: its dependency tree may hold only'));
  });

  it('fails on a package with no rule', () => {
    expect(checkBoundaries(fixture('unknown-package'))).toEqual([
      expect.stringContaining('packages/mystery: no dependency rule'),
    ]);
  });
});

describe('dependency-cruiser (import-level rules)', () => {
  const config = createRequire(import.meta.url)(join(repoRoot, '.dependency-cruiser.cjs')) as IConfiguration;
  const { tsConfig: _tsConfig, exclude: _exclude, ...options } = config.options ?? {};

  async function violations(name: string, dirs: string[]): Promise<string[]> {
    const result = await cruise(dirs, {
      ...options,
      validate: true,
      ruleSet: { forbidden: config.forbidden ?? [] },
      baseDir: fixture(name),
    });
    if (typeof result.output === 'string') throw new Error('unexpected string output');
    return result.output.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`);
  }

  it('fails a relative import across package boundaries', async () => {
    expect(await violations('relative-import', ['packages'])).toEqual([
      'no-relative-cross-package: packages/core/src/index.ts -> packages/gateway/src/index.ts',
    ]);
  });

  it('fails I/O and runtime imports in a pack manifest', async () => {
    const found = await violations('impure-manifest', ['packages']);
    expect(found).toContain('pack-manifest-no-builtins: packages/packs/demo/src/manifest.ts -> fs');
    expect(found).toContain(
      'pack-manifest-is-pure: packages/packs/demo/src/manifest.ts -> packages/packs/demo/src/runtime.ts',
    );
  });
});
