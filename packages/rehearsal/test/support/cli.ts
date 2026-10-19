// The `ads` CLI, run in-process as Marcus runs it in the live steps (`doppler run --config dev -- pnpm --silent
// --filter @ads/app-worker ads …`): the same program and commands, with the network, the AI and the clock faked.
import { type WorkerCliDeps, buildProgram } from '@ads/app-worker/cli.ts';
import { connect } from '@ads/db';
import type { Command } from 'commander';
import type { FakeModel } from './model.ts';

export interface CliRun {
  printed: string[];
  exitCode: number;
  /** What it printed, parsed as one JSON document. */
  json<T = Record<string, unknown>>(): T;
}

export interface CliContext {
  env: Record<string, string>;
  fetch: typeof fetch;
  tokenFetch: typeof fetch;
  now: () => Date;
  model: FakeModel['model'];
}

function quiet(cmd: Command): Command {
  cmd.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  cmd.commands.forEach(quiet);
  return cmd;
}

/** Runs `ads <args…>`; `stdin` is what's piped in (`ads credentials put … < key.json`). */
export async function ads(ctx: CliContext, args: string[], stdin = ''): Promise<CliRun> {
  const printed: string[] = [];
  const deps: WorkerCliDeps = {
    env: ctx.env,
    readStdin: () => Promise.resolve(stdin),
    print: (line) => printed.push(line),
    connect: (url) => connect(url, { max: 2 }),
    fetch: ctx.fetch,
    tokenFetch: ctx.tokenFetch,
    now: ctx.now,
    model: ctx.model,
  };
  process.exitCode = undefined;
  try {
    await quiet(buildProgram(deps)).parseAsync(['node', 'ads', ...args]);
  } catch (error) {
    throw new Error(`ads ${args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
  process.exitCode = undefined;
  return {
    printed,
    exitCode,
    json: <T>() => JSON.parse(printed.join('\n')) as T,
  };
}
