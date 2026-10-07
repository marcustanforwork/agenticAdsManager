// `ads model ping` (M06a): one small traced call, with a mock model and a recording trace exporter.
import { connect, createProduct } from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { MockLanguageModelV4 } from 'ai/test';
import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type WorkerCliDeps } from '../src/cli.ts';

function quiet(cmd: Command): Command {
  cmd.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  cmd.commands.forEach(quiet);
  return cmd;
}

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
  await createProduct(t.db, { slug: 'snappool', name: 'SnapPool', packId: 'saas-snappool', settings: TEST_SETTINGS });
});
afterAll(async () => t.drop());

const pong = new MockLanguageModelV4({
  doGenerate: {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, word: 'pong' }) }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 50, noCache: 50, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    warnings: [],
  },
});

function run(args: string[], extra: Partial<WorkerCliDeps> = {}, env: NodeJS.ProcessEnv = {}) {
  const printed: string[] = [];
  const deps: WorkerCliDeps = {
    env: { DATABASE_URL: t.url, ...env },
    readStdin: () => Promise.resolve(''),
    print: (line) => printed.push(line),
    connect: (url) => connect(url, { max: 1 }),
    ...extra,
  };
  const done = quiet(buildProgram(deps)).parseAsync(['node', 'ads', ...args]);
  return { done, json: async () => (await done, JSON.parse(printed.join('\n')) as Record<string, unknown>) };
}

describe('ads model ping', () => {
  it('makes one traced call and prints its tokens and cost', async () => {
    // Keeps what it exports: the CLI shuts tracing down before it returns, and InMemorySpanExporter empties on shutdown.
    const spans: ReadableSpan[] = [];
    const exporter: SpanExporter = {
      export: (batch, done) => {
        spans.push(...batch);
        done({ code: 0 });
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const keys = { LANGFUSE_PUBLIC_KEY: `pk-lf-${'1'.repeat(8)}`, LANGFUSE_SECRET_KEY: `sk-lf-${'1'.repeat(8)}` };
    const out = await run(
      ['--product', 'snappool', 'model', 'ping'],
      { model: { model: pong, spec: { provider: 'anthropic', modelId: 'claude-opus-5-5' } }, traceExporter: exporter },
      keys,
    ).json();
    expect(out).toEqual({
      product: 'snappool',
      stage: 'analyst',
      model: 'anthropic:claude-opus-5-5',
      attempts: 1,
      usage: { inputTokens: 50, outputTokens: 10 },
      costMicros: '400', // 50×4 + 10×20 micros at Opus 5.5's prices
      traced: true,
    });
    const tags = spans.map((span) => span.attributes['langfuse.trace.tags']);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0]).toEqual(expect.arrayContaining(['product:snappool', 'stage:analyst']));
  });

  it('needs the model key when it builds the real provider', async () => {
    await expect(
      run(
        ['--product', 'snappool', 'model', 'ping', '--stage', 'brief'],
        {},
        { MODEL_BRIEF: 'anthropic:claude-opus-5-5' },
      ).done,
    ).rejects.toThrow(/needs ANTHROPIC_API_KEY/);
  });
});
