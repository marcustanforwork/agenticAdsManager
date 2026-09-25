// dependency-cruiser: the import-level half of the boundary checks (BLUEPRINT §2).
// The package-level half is scripts/check-boundaries.ts; the rules' data is scripts/boundary-rules.mjs.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-relative-cross-package',
      comment: 'No relative imports across package boundaries (BLUEPRINT §2 rule 5). Import the package by name.',
      severity: 'error',
      from: { path: '^((?:packages/packs|packages|apps)/[^/]+)/' },
      to: { path: '^(packages|apps)/', pathNot: ['^$1/'] },
    },
    {
      name: 'pack-manifest-is-pure',
      comment:
        'A pack manifest (src/manifest.ts) is pure data: only zod, @ads/contracts, @ads/pack-sdk and pure files of its own pack (BLUEPRINT §2 rule 4).',
      severity: 'error',
      from: { path: '^packages/packs/[^/]+/src/manifest\\.ts$' },
      to: {
        pathNot: ['(^|/)node_modules/(zod|@ads/contracts|@ads/pack-sdk)/', '^packages/packs/[^/]+/src/(?!runtime)'],
      },
    },
    {
      name: 'pack-manifest-no-builtins',
      comment: 'A pack manifest may not import Node built-ins (no I/O).',
      severity: 'error',
      from: { path: '^packages/packs/[^/]+/src/manifest\\.ts$' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import must resolve.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)dist/', '(^|/)scripts/test/fixtures/'] },
    preserveSymlinks: true,
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['@ads/source', 'import', 'types', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.d.ts'],
    },
  },
};
