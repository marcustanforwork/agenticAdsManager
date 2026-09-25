// The dependency rules of BLUEPRINT §2, as data. The single source for:
//   - scripts/check-boundaries.ts   (package.json edges; the apps/web dependency tree)
//   - .dependency-cruiser.cjs       (import-level checks: relative escapes, pack manifests)
//   - eslint.config.js              (the no-restricted-imports mirror, for editor feedback)
// To add a package: add its directory here with its allowed internal dependencies, then
// create it with a README.md. check-boundaries fails on any workspace package missing here.

/** Every internal package is published under this scope. */
export const SCOPE = '@ads/';

/**
 * @typedef {object} PackageRule
 * @property {string} name      the package name
 * @property {string[]} deps    internal packages it may depend on (any dependency field)
 * @property {string[]} [devDeps] internal packages it may additionally use as devDependencies
 */

/** Pack directories match this; their rule is PACK_RULE. */
export const PACKS_DIR = 'packages/packs/';

/** @type {Record<string, PackageRule>} keyed by directory, relative to the repo root */
export const PACKAGE_RULES = {
  'packages/contracts': { name: '@ads/contracts', deps: [] },
  'packages/db': { name: '@ads/db', deps: ['@ads/contracts'] },
  'packages/vault': { name: '@ads/vault', deps: ['@ads/contracts', '@ads/db'] },
  'packages/connector-testing': { name: '@ads/connector-testing', deps: ['@ads/contracts'] },
  'packages/connector-google': {
    name: '@ads/connector-google',
    deps: ['@ads/contracts'],
    devDeps: ['@ads/connector-testing'],
  },
  'packages/connector-meta': {
    name: '@ads/connector-meta',
    deps: ['@ads/contracts'],
    devDeps: ['@ads/connector-testing'],
  },
  'packages/connector-google-write': {
    name: '@ads/connector-google-write',
    deps: ['@ads/contracts', '@ads/connector-google'],
    devDeps: ['@ads/connector-testing'],
  },
  'packages/connector-meta-write': {
    name: '@ads/connector-meta-write',
    deps: ['@ads/contracts', '@ads/connector-meta'],
    devDeps: ['@ads/connector-testing'],
  },
  'packages/pack-sdk': { name: '@ads/pack-sdk', deps: ['@ads/contracts'] },
  'packages/core': {
    name: '@ads/core',
    deps: ['@ads/contracts', '@ads/db', '@ads/vault', '@ads/connector-google', '@ads/connector-meta', '@ads/pack-sdk'],
    devDeps: ['@ads/connector-testing'],
  },
  'packages/gateway': {
    name: '@ads/gateway',
    deps: [
      '@ads/contracts',
      '@ads/db',
      '@ads/vault',
      '@ads/connector-google',
      '@ads/connector-meta',
      '@ads/connector-google-write',
      '@ads/connector-meta-write',
    ],
    devDeps: ['@ads/connector-testing'],
  },
  'packages/evals': { name: '@ads/evals', deps: ['@ads/contracts', '@ads/db', '@ads/core', '@ads/pack-sdk', 'PACKS'] },
  'apps/worker': {
    name: '@ads/app-worker',
    deps: ['@ads/contracts', '@ads/db', '@ads/vault', '@ads/core', '@ads/pack-sdk', 'PACKS'],
  },
  'apps/gateway': { name: '@ads/app-gateway', deps: ['@ads/contracts', '@ads/db', '@ads/vault', '@ads/gateway'] },
  'apps/web': { name: '@ads/app-web', deps: ['@ads/contracts', '@ads/db'] },
};

/** Every pack: contracts and pack-sdk only. Never a connector, core, gateway or db. */
export const PACK_RULE = { deps: ['@ads/contracts', '@ads/pack-sdk'] };

/** A pack's package name is `@ads/pack-<directory name>`. */
export const packName = (/** @type {string} */ dir) => `${SCOPE}pack-${dir}`;

/** apps/web's whole internal dependency tree must be exactly these (BLUEPRINT §2 rule 3, invariant 10). */
export const WEB_APP_DIR = 'apps/web';
export const WEB_ALLOWED_TREE = ['@ads/contracts', '@ads/db'];

/** Pack manifests (pure data) may import only these packages (BLUEPRINT §2 rule 4). */
export const MANIFEST_ALLOWED_IMPORTS = ['zod', '@ads/contracts', '@ads/pack-sdk'];
