// Checks the package-level dependency rules of BLUEPRINT §2 (the rules themselves live in
// scripts/boundary-rules.mjs). Run by `pnpm check:boundaries`, together with dependency-cruiser
// (import-level checks) and the ESLint mirror. Exits 1 on any violation.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PACKAGE_RULES,
  PACKS_DIR,
  PACK_RULE,
  SCOPE,
  WEB_ALLOWED_TREE,
  WEB_APP_DIR,
  packName,
} from './boundary-rules.mjs';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface WorkspacePackage {
  dir: string;
  json: PackageJson;
}

/** Workspace package directories, as pnpm-workspace.yaml defines them. */
export function findPackages(root: string): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const parent of ['packages', PACKS_DIR.replace(/\/$/, ''), 'apps']) {
    const abs = join(root, parent);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      if (dir === PACKS_DIR.replace(/\/$/, '')) continue;
      const pj = join(root, dir, 'package.json');
      if (!existsSync(pj)) continue;
      found.push({ dir, json: JSON.parse(readFileSync(pj, 'utf8')) as PackageJson });
    }
  }
  return found;
}

function internalDeps(json: PackageJson, fields: (keyof PackageJson)[]): string[] {
  const names = new Set<string>();
  for (const field of fields) {
    const deps = json[field];
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps)) if (name.startsWith(SCOPE)) names.add(name);
    }
  }
  return [...names];
}

export function checkBoundaries(root: string): string[] {
  const violations: string[] = [];
  const packages = findPackages(root);
  const packNames = packages
    .filter((p) => p.dir.startsWith(PACKS_DIR))
    .map((p) => packName(p.dir.slice(PACKS_DIR.length)));
  const expand = (list: string[]): string[] => list.flatMap((d) => (d === 'PACKS' ? packNames : [d]));

  const byName = new Map<string, WorkspacePackage>();
  for (const pkg of packages) {
    const isPack = pkg.dir.startsWith(PACKS_DIR);
    const rule = isPack ? { name: packName(pkg.dir.slice(PACKS_DIR.length)), ...PACK_RULE } : PACKAGE_RULES[pkg.dir];
    if (!rule) {
      violations.push(
        `${pkg.dir}: no dependency rule for this package. Add it to scripts/boundary-rules.mjs (BLUEPRINT §2).`,
      );
      continue;
    }
    if (pkg.json.name !== rule.name) {
      violations.push(`${pkg.dir}: package name must be "${rule.name}", found "${pkg.json.name ?? '(none)'}".`);
    }
    byName.set(rule.name, pkg);

    const allowed = new Set(expand(rule.deps));
    const allowedDev = new Set([...allowed, ...expand('devDeps' in rule ? (rule.devDeps ?? []) : [])]);
    for (const dep of internalDeps(pkg.json, ['dependencies', 'peerDependencies', 'optionalDependencies'])) {
      if (!allowed.has(dep)) violations.push(`${pkg.dir}: may not depend on ${dep} (BLUEPRINT §2).`);
    }
    for (const dep of internalDeps(pkg.json, ['devDependencies'])) {
      if (!allowedDev.has(dep))
        violations.push(`${pkg.dir}: may not depend on ${dep}, even as a devDependency (BLUEPRINT §2).`);
    }
  }

  // apps/web: its whole internal dependency tree (runtime dependencies) must be contracts + db only.
  const web = packages.find((p) => p.dir === WEB_APP_DIR);
  if (web) {
    const seen = new Set<string>();
    const queue = internalDeps(web.json, ['dependencies', 'peerDependencies', 'optionalDependencies']);
    while (queue.length > 0) {
      const name = queue.pop();
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      const pkg = byName.get(name);
      if (pkg) queue.push(...internalDeps(pkg.json, ['dependencies', 'peerDependencies', 'optionalDependencies']));
    }
    const extra = [...seen].filter((n) => !WEB_ALLOWED_TREE.includes(n));
    if (extra.length > 0) {
      violations.push(
        `${WEB_APP_DIR}: its dependency tree may hold only ${WEB_ALLOWED_TREE.join(' + ')}; found ${extra.join(', ')}.`,
      );
    }
  }
  return violations;
}

if (import.meta.main) {
  const violations = checkBoundaries(process.cwd());
  if (violations.length > 0) {
    console.error(`check-boundaries: ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`check-boundaries: OK (${findPackages(process.cwd()).length} packages)`);
}
