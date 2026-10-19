// The commands in Marcus's live steps, read from the docs he follows: the "Live steps for Marcus" sections of
// NOW.md and of every milestone file, and the runbook. Each inline code span and code-block line is split into shell commands, so a
// step like `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads seed` yields the `pnpm` command
// and, inside it, the `ads` one.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface LiveCommand {
  /** Where it was written: `docs/milestones/M02-meta-read.md` and the line. */
  where: string;
  /** The whole code span, as written. */
  text: string;
  /** One shell command of it, as tokens (quotes removed, redirections dropped). */
  tokens: string[];
}

/** The text of the section that starts with `heading` (any level), up to the next heading of the same or a higher
 *  level; with its line numbers. */
function section(markdown: string, heading: RegExp): { line: number; text: string }[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return [];
  const level = /^#+/.exec(lines[start] ?? '')?.[0].length ?? 2;
  const out: { line: number; text: string }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i] ?? '');
    if (m !== null && (m[1]?.length ?? 0) <= level) break;
    out.push({ line: i + 1, text: lines[i] ?? '' });
  }
  return out;
}

/** A line without its trailing `# comment`: a `#` after a space, outside quotes. */
export function withoutComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** The code in a section: inline spans, and each line of a fenced block. */
function codeOf(lines: { line: number; text: string }[]): { line: number; code: string }[] {
  const out: { line: number; code: string }[] = [];
  let fenced = false;
  for (const { line, text } of lines) {
    if (/^\s*```/.test(text)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      const code = withoutComment(text).trim();
      if (code !== '') out.push({ line, code });
      continue;
    }
    for (const m of text.matchAll(/`([^`]+)`/g)) out.push({ line, code: m[1] ?? '' });
  }
  return out;
}

const OPERATORS = new Set(['&&', '||', ';', '|']);
const REDIRECTS = new Set(['<', '>', '>>', '2>']);
/** Redirections that name no file. */
const BARE_REDIRECTS = new Set(['2>&1']);

/** Splits shell text into commands of tokens: quotes kept together and removed, `&&` `;` `|` end a command,
 *  redirections and their file are dropped. Good enough for the docs, not a shell. */
export function shellCommands(text: string): string[][] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of text) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started || current !== '') tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
  }
  if (started || current !== '') tokens.push(current);
  // A placeholder with spaces (`<client id>`) is one value.
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i] ?? '';
    if (t !== '<' && /<[^>]*$/.test(t)) {
      tokens.splice(i, 2, `${t} ${tokens[i + 1] ?? ''}`);
      i--;
    }
  }

  const commands: string[][] = [[]];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    if (OPERATORS.has(t)) {
      commands.push([]);
      continue;
    }
    if (REDIRECTS.has(t)) {
      i++; // and its file
      continue;
    }
    if (BARE_REDIRECTS.has(t)) continue;
    commands.at(-1)?.push(t);
  }
  return commands.filter((c) => c.length > 0);
}

const REPO = join(import.meta.dirname, '..', '..', '..', '..');

/** Every command in the live steps of NOW.md and the milestone files, and in the runbook. */
export function liveStepCommands(): LiveCommand[] {
  const files = [
    'docs/memory/NOW.md',
    ...readdirSync(join(REPO, 'docs/milestones'))
      .filter((f) => /^[MF]\d.*\.md$/.test(f))
      .sort()
      .map((f) => `docs/milestones/${f}`),
  ];
  const out: LiveCommand[] = [];
  for (const file of files) {
    const markdown = readFileSync(join(REPO, file), 'utf8');
    for (const { line, code } of codeOf(section(markdown, /^#+ Live steps for Marcus/))) {
      for (const tokens of shellCommands(code)) out.push({ where: `${file}:${line}`, text: code, tokens });
    }
  }
  // The runbook is all steps: every command in it counts.
  const runbook = readFileSync(join(REPO, 'docs/runbook.md'), 'utf8')
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }));
  for (const { line, code } of codeOf(runbook)) {
    for (const tokens of shellCommands(code)) out.push({ where: `docs/runbook.md:${line}`, text: code, tokens });
  }
  return out;
}
