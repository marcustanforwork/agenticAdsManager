// Every command in Marcus's live steps (F3 build 2), checked against what will run it: each `ads …` against the
// worker CLI's own command tree (subcommands, flags, their values' choices, mandatory options, `--product` where a
// command needs one), and each `pnpm --filter <package> <script> …` against the workspace (the package, its
// script, and the flags that script reads). A command written wrong in the docs fails here, before a live weekend.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildProgram } from '@ads/app-worker/cli.ts';
import { findCommand } from '@ads/app-worker/telegram/commands.ts';
import type { Command, Option } from 'commander';
import { describe, expect, it } from 'vitest';
import { type LiveCommand, liveStepCommands, shellCommands, withoutComment } from './support/liveSteps.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');

/** The worker CLI's command tree, built as the CLI builds it (nothing runs). */
const program = buildProgram({
  env: {},
  readStdin: () => Promise.resolve(''),
  print: () => undefined,
  connect: () => {
    throw new Error('not connected');
  },
});

/** The commands that act on no one product. Every other command needs `--product`. */
const NO_PRODUCT = new Set(['version', 'seed', 'phase', 'phase set', 'eval replay', 'credentials put']);

const ELIDED = /^(…|\.\.\.)$/;
const PLACEHOLDER = /[<>…]/;

const pathOf = (cmd: Command): string => {
  const names: string[] = [];
  for (let c: Command | null = cmd; c !== null && c !== program; c = c.parent) names.unshift(c.name());
  return names.join(' ');
};

function findOption(cmd: Command, flag: string): Option | undefined {
  for (let c: Command | null = cmd; c !== null; c = c.parent) {
    const found = c.options.find((o) => o.long === flag);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Commander keeps whether a command has its own action in a private field; a command with subcommands and no
// action can't be run on its own.
const hasAction = (cmd: Command): boolean => (cmd as unknown as { _actionHandler: unknown })._actionHandler != null;

/** What's wrong with `ads <argv…>`, if anything. */
export function checkAds(argv: string[]): string[] {
  if (argv.length === 0 || ELIDED.test(argv[0] ?? '')) return []; // `ads …`: any command
  const problems: string[] = [];
  let cmd: Command = program;
  const given = new Set<string>();
  let args = 0;
  let elided = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (ELIDED.test(token)) {
      elided = true; // whatever it stands for isn't known: what follows is still checked, what's missing isn't
      continue;
    }
    if (token.startsWith('--')) {
      const [flag = '', inline] = token.split('=', 2);
      const option = findOption(cmd, flag);
      if (option === undefined) {
        problems.push(`\`${pathOf(cmd)}\` has no option ${flag}`);
        continue;
      }
      given.add(option.attributeName());
      let value = inline;
      if (value === undefined && (option.required || option.optional)) {
        const next = argv[i + 1];
        if (option.required || (next !== undefined && !next.startsWith('-'))) {
          value = next;
          i++;
        }
      }
      if (option.required && value === undefined) problems.push(`${flag} needs a value`);
      const choices = option.argChoices;
      if (choices !== undefined && value !== undefined && !PLACEHOLDER.test(value) && !choices.includes(value)) {
        problems.push(`${flag} ${value}: not one of ${choices.join(', ')}`);
      }
      continue;
    }
    const sub = cmd.commands.find((c) => c.name() === token || c.aliases().includes(token));
    if (sub !== undefined && args === 0) {
      cmd = sub;
      continue;
    }
    if (args < cmd.registeredArguments.length) {
      args++;
      continue;
    }
    if (!elided) problems.push(`\`${pathOf(cmd)}\` has no subcommand or argument "${token}"`);
  }
  if (cmd === program) problems.push('no command');
  if (elided) return problems;
  if (cmd.commands.length > 0 && !hasAction(cmd)) problems.push(`\`${pathOf(cmd)}\` needs a subcommand`);
  for (const o of cmd.options) {
    if (o.mandatory && !given.has(o.attributeName())) problems.push(`\`${pathOf(cmd)}\` needs ${o.long}`);
  }
  const required = cmd.registeredArguments.filter((a) => a.required).length;
  if (args < required) problems.push(`\`${pathOf(cmd)}\` needs ${required} argument(s)`);
  if (!NO_PRODUCT.has(pathOf(cmd)) && !given.has('product')) problems.push(`\`${pathOf(cmd)}\` needs --product`);
  return problems;
}

interface PackageJson {
  name: string;
  scripts?: Record<string, string>;
}

const packages: { dir: string; json: PackageJson }[] = ['packages', 'packages/packs', 'apps'].flatMap((parent) =>
  readdirSync(join(REPO, parent), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      try {
        const dir = join(REPO, parent, e.name);
        return [{ dir, json: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson }];
      } catch {
        return [];
      }
    }),
);

/** What's wrong with `pnpm … --filter <package> <script> <args…>`, if anything. */
export function checkPnpmFilter(tokens: string[]): string[] {
  const at = tokens.indexOf('--filter');
  const name = tokens[at + 1] ?? '';
  const pkg = packages.find((p) => p.json.name === name);
  if (pkg === undefined) return [`no workspace package ${name}`];
  const rest = tokens.slice(at + 2).filter((t) => t !== '--silent');
  const script = rest[0] ?? '';
  const body = pkg.json.scripts?.[script];
  if (body === undefined) return [`${name} has no script "${script}"`];
  if (script === 'ads') return []; // the CLI itself: checked by checkAds
  // A `node … file.ts` script reads its flags with parseArgs: each flag given must be one it declares.
  const file = /\s(\S+\.ts)\b/.exec(body)?.[1];
  if (file === undefined) return [];
  const source = readFileSync(join(pkg.dir, file), 'utf8');
  return rest
    .slice(1)
    .filter((t) => t.startsWith('--') && t !== '--')
    .map((t) => t.slice(2).split('=')[0] ?? '')
    .filter((flag) => !new RegExp(`(?<![\\w-])['"]?${flag}['"]?\\s*:\\s*\\{\\s*type:`).test(source))
    .map((flag) => `${name} ${script} reads no --${flag}`);
}

/** The `ads` command inside a shell command: after `pnpm … ads`, `ads-entrypoint ads`, `--`, `…`, or on its own. */
const adsArgv = (tokens: string[]): string[] | null => {
  const i = tokens.indexOf('ads');
  return i === -1 ? null : tokens.slice(i + 1);
};

const commands = liveStepCommands();
const label = (c: LiveCommand): string => `${c.where}: ${c.text}`;

describe('the live steps’ commands', () => {
  it('finds the commands of every milestone’s live steps', () => {
    const files = new Set(commands.map((c) => c.where.split(':')[0]));
    for (const m of ['M01a', 'M02', 'M03', 'M04', 'M05a', 'M05b', 'M06a', 'M06b', 'M07', 'M08', 'M09b', 'M10a']) {
      expect(
        [...files].some((f) => f?.includes(`/${m}-`)),
        m,
      ).toBe(true);
    }
    expect(files.has('docs/memory/NOW.md')).toBe(true);
    expect(commands.filter((c) => adsArgv(c.tokens) !== null).length).toBeGreaterThan(40);
  });

  it('every `ads …` command exists, with the flags, values and product it needs', () => {
    const wrong = commands.flatMap((c) => {
      const argv = adsArgv(c.tokens);
      if (argv === null) return [];
      return checkAds(argv).map((p) => `${label(c)}\n    → ${p}`);
    });
    expect(wrong).toEqual([]);
  });

  it('every `pnpm --filter <package> <script>` names a real package, script and flags', () => {
    // `pnpm` may follow `doppler run … --` or environment settings (`RECORD=1 … pnpm …`).
    const pnpm = commands
      .map((c) => ({ c, tokens: c.tokens.slice(c.tokens.indexOf('pnpm')) }))
      .filter(({ c, tokens }) => c.tokens.includes('pnpm') && tokens.includes('--filter'));
    expect(pnpm.map(({ tokens }) => tokens[tokens.indexOf('--filter') + 2] ?? '')).toEqual(
      expect.arrayContaining(['db:migrate', 'record', 'case:property']),
    );
    const wrong = pnpm.flatMap(({ c, tokens }) => checkPnpmFilter(tokens).map((p) => `${label(c)}\n    → ${p}`));
    expect(wrong).toEqual([]);
  });

  it('every Telegram command typed in the live steps is one the bot knows', () => {
    const typed = commands
      .filter((c) => /^\/[a-z_]+$/.test(c.tokens[0] ?? ''))
      .map((c) => ({ c, name: c.tokens[0]?.slice(1) ?? '' }));
    expect(typed.map((t) => t.name)).toEqual(expect.arrayContaining(['status', 'ceiling', 'pause', 'halt']));
    // BotFather's own commands (T7) are typed to BotFather, not to the agent's bot.
    const botFather = new Set(['newbot', 'mybots', 'setcommands']);
    expect(typed.filter((t) => !botFather.has(t.name) && findCommand(t.name) === null).map((t) => label(t.c))).toEqual(
      [],
    );
  });

  it('the checks themselves catch a wrong command', () => {
    expect(checkAds(['cycle', '--product', 'snappool'])).toEqual(['`cycle` needs --kind']);
    expect(checkAds(['cycle', '--product', 'x', '--kind', 'hourly'])).toEqual([
      '--kind hourly: not one of daily, weekly, manual',
    ]);
    expect(checkAds(['proposals', 'aprove', 'abc'])).toContain('`proposals` has no subcommand or argument "aprove"');
    expect(checkAds(['outcomes', '--product', 'snappool', '--read-only'])).toEqual([
      '`outcomes` has no option --read-only',
    ]);
    expect(checkAds(['outcomes'])).toEqual(['`outcomes` needs --product']);
    expect(checkAds(['seed'])).toEqual([]);
    expect(
      checkAds(
        shellCommands('ads accounts link --product p --platform google --account <client id>')[0]?.slice(1) ?? [],
      ),
    ).toEqual([]);
    expect(checkAds(['proposals', 'approve', '<id>', '--version', '1', '…'])).toEqual([]);
    // After an elision, the flags written are still checked.
    expect(checkAds(['cycle', '…', '--kind', 'hourly'])).toEqual(['--kind hourly: not one of daily, weekly, manual']);
    expect(shellCommands('ads cycle --kind daily 2>&1 | tee out.json')).toEqual([
      ['ads', 'cycle', '--kind', 'daily'],
      ['tee', 'out.json'],
    ]);
    expect(checkPnpmFilter(shellCommands('pnpm --filter @ads/db db:migrat')[0] ?? [])).toEqual([
      '@ads/db has no script "db:migrat"',
    ]);
    expect(checkPnpmFilter(shellCommands('pnpm --filter @ads/connector-meta record --acount act_1')[0] ?? [])).toEqual([
      '@ads/connector-meta record reads no --acount',
    ]);
    // A flag inside another's name (`ager` in `manager`) is not declared.
    expect(checkPnpmFilter(shellCommands('pnpm --filter @ads/connector-google record --ager 1')[0] ?? [])).toEqual([
      '@ads/connector-google record reads no --ager',
    ]);
    // A `#` inside quotes is not a comment.
    expect(withoutComment('ads phase set 1 --note "see #12" --bogus  # set it')).toBe(
      'ads phase set 1 --note "see #12" --bogus  ',
    );
  });
});
