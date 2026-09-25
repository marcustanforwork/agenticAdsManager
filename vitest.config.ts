import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript sources (the "@ads/source" export condition),
// so tests never need a build first.
const conditions = ['@ads/source', 'module', 'node', 'development|production'];

/** One Vitest project per workspace package that has a test/ directory, plus the repo scripts. */
function projectDirs(): string[] {
  const dirs: string[] = ['scripts'];
  for (const parent of ['packages', 'packages/packs', 'apps']) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const dir = `${parent}/${entry.name}`;
      if (entry.isDirectory() && dir !== 'packages/packs' && existsSync(`${dir}/test`)) dirs.push(dir);
    }
  }
  return dirs;
}

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    projects: projectDirs().map((dir) => ({
      extends: true,
      test: {
        name: dir,
        root: dir,
        include: ['test/**/*.test.ts'],
        exclude: ['**/fixtures/**', '**/node_modules/**'],
      },
    })),
  },
});
