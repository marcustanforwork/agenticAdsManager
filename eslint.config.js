// ESLint flat config. Two parts:
//   1. General TypeScript linting (`pnpm lint`).
//   2. The boundary mirror: no-restricted-imports per package, generated from scripts/boundary-rules.mjs.
//      `pnpm check:boundaries` runs only this part (ADS_LINT_BOUNDARIES_ONLY=1); `pnpm lint` runs both.
import { existsSync, readdirSync } from 'node:fs';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { PACKAGE_RULES, PACKS_DIR, PACK_RULE, packName } from './scripts/boundary-rules.mjs';

const packDirs = existsSync(PACKS_DIR)
  ? readdirSync(PACKS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  : [];
const packNames = packDirs.map(packName);
const allNames = [...Object.values(PACKAGE_RULES).map((r) => r.name), ...packNames];
const expand = (/** @type {string[]} */ list) => list.flatMap((d) => (d === 'PACKS' ? packNames : [d]));

/**
 * @param {string} dir @param {string} self @param {string[]} allowed
 * @returns {import('eslint').Linter.Config}
 */
function boundaryBlock(dir, self, allowed) {
  const forbidden = allNames.filter((n) => n !== self && !allowed.includes(n));
  return {
    files: [`${dir}/**/*.{ts,tsx,js,mjs}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: forbidden.map((name) => ({ name, message: `${self} may not import ${name} (BLUEPRINT §2).` })),
          patterns: [
            {
              group: forbidden.map((n) => `${n}/*`),
              message: 'Not an allowed dependency of this package (BLUEPRINT §2).',
            },
            {
              regex: '^(\\.\\./)+(packages|apps)/',
              message:
                'No relative imports across package boundaries; import the package by name (BLUEPRINT §2 rule 5).',
            },
          ],
        },
      ],
    },
  };
}

const boundaryBlocks = [
  ...Object.entries(PACKAGE_RULES).map(([dir, rule]) =>
    boundaryBlock(dir, rule.name, [...expand(rule.deps), ...expand(rule.devDeps ?? [])]),
  ),
  ...packDirs.map((d) => boundaryBlock(`${PACKS_DIR}${d}`, packName(d), PACK_RULE.deps)),
];

const ignores = {
  ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.turbo/**', 'scripts/test/fixtures/**'],
};

const boundariesOnly = process.env.ADS_LINT_BOUNDARIES_ONLY === '1';

export default boundariesOnly
  ? defineConfig(ignores, { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } }, ...boundaryBlocks)
  : defineConfig(
      ignores,
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      {
        languageOptions: {
          globals: globals.node,
          parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
        rules: {
          '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
          '@typescript-eslint/consistent-type-imports': 'error',
          // Money is bigint micros: never parse money as a float (invariant 6).
          'no-restricted-globals': [
            'error',
            { name: 'parseFloat', message: 'Money is bigint micros; see contracts/money.' },
          ],
          'no-restricted-properties': [
            'error',
            { object: 'Number', property: 'parseFloat', message: 'Money is bigint micros; see contracts/money.' },
          ],
        },
      },
      { files: ['**/*.js', '**/*.mjs', '**/*.cjs'], ...tseslint.configs.disableTypeChecked },
      ...boundaryBlocks,
      prettier,
    );
