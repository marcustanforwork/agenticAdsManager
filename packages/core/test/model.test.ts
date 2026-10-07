// The model layer (M06a Build 1), with a mock model: the schema-failure retry, the trace tags, the cost recorded on
// the cycle, and no personal data in what is sent or traced.
import { createProduct, getCycle, startManual } from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EMAIL_PLACEHOLDER,
  ModelConfigError,
  SCHEMA_RETRY_NOTE,
  StructuredOutputError,
  costOfUsage,
  createModelTracing,
  generateStructured,
  maskPersonalData,
  modelSpecFor,
  parseModelSpec,
  priceFor,
  redactPersonalData,
  type ModelSpec,
} from '../src/index.ts';

const OPUS: ModelSpec = { provider: 'anthropic', modelId: 'claude-opus-5-5' };
const Answer = z.object({ verdict: z.enum(['ok', 'not_ok']), note: z.string() });

/** A model reply with the given text and token counts. */
function reply(text: string, input = 1000, output = 200): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: output, text: output, reasoning: undefined },
    },
    warnings: [],
  };
}

const VALID = JSON.stringify({ verdict: 'ok', note: 'fine' });

/** The text of everything sent to the model in one call. */
const sentText = (call: LanguageModelV4CallOptions | undefined): string => JSON.stringify(call?.prompt ?? []);

describe('model settings', () => {
  it('parses provider:model, keeping colons in the model id', () => {
    expect(parseModelSpec('anthropic:claude-opus-5-5')).toEqual(OPUS);
    expect(parseModelSpec('openai-compatible:llama3:70b')).toEqual({
      provider: 'openai-compatible',
      modelId: 'llama3:70b',
    });
  });

  it.each(['claude-opus-5-5', 'mistral:large', 'anthropic:', ':x', ''])('refuses %j', (text) => {
    expect(() => parseModelSpec(text)).toThrow(ModelConfigError);
  });

  it('reads MODEL_<STAGE>, else the default (the strongest model, D-041)', () => {
    expect(modelSpecFor('analyst', { MODEL_ANALYST: 'openai:gpt-x' })).toEqual({
      provider: 'openai',
      modelId: 'gpt-x',
    });
    expect(modelSpecFor('brief', {})).toEqual({ provider: 'anthropic', modelId: 'claude-fable-5-1' });
  });
});

describe('prices and cost', () => {
  it('prices listed models; MODEL_PRICES overrides and adds; local models are free; others are refused', () => {
    expect(priceFor(OPUS, {}).input).toBe(4_000_000n);
    const env = { MODEL_PRICES: JSON.stringify({ 'openai:gpt-x': { input: '2.5', output: '10' } }) };
    expect(priceFor({ provider: 'openai', modelId: 'gpt-x' }, env)).toEqual({
      input: 2_500_000n,
      output: 10_000_000n,
      cacheRead: 2_500_000n,
      cacheWrite: 2_500_000n,
    });
    expect(priceFor({ provider: 'openai-compatible', modelId: 'llama3' }, {}).output).toBe(0n);
    expect(() => priceFor({ provider: 'openai', modelId: 'gpt-x' }, {})).toThrow(/no known price/);
    expect(() => priceFor(OPUS, { MODEL_PRICES: '{"anthropic:claude-opus-5-5": {"input": 4}}' })).toThrow(
      /MODEL_PRICES is not valid/,
    );
  });

  it('computes the cost in USD micros, by hand', () => {
    const price = priceFor(OPUS, {}); // $4 in, $20 out, $0.20 cache reads, $5 cache writes per million tokens
    const usage = (noCache: number, cacheRead: number, cacheWrite: number, output: number) => ({
      inputTokens: noCache + cacheRead + cacheWrite,
      inputTokenDetails: { noCacheTokens: noCache, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite },
      outputTokens: output,
      outputTokenDetails: { textTokens: output, reasoningTokens: undefined },
      totalTokens: noCache + cacheRead + cacheWrite + output,
    });
    expect(costOfUsage(usage(1000, 0, 0, 500), price)).toBe(14_000n); // 1000×4 + 500×20
    expect(costOfUsage(usage(800, 200, 100, 500), price)).toBe(13_740n); // 3200 + 40 + 500 + 10000
    expect(costOfUsage(usage(0, 1, 0, 0), price)).toBe(1n); // 0.2 micros, rounded up
    expect(costOfUsage(undefined, price)).toBe(0n);
  });
});

describe('personal data', () => {
  it('redacts email addresses and international phone numbers, and leaves numbers alone', () => {
    const r = redactPersonalData('search term "jane.doe+ads@example.com.sg" by +65 9123 4567; 12345678 clicks, +20%');
    expect(r.text).toBe(`search term "${EMAIL_PLACEHOLDER}" by [phone removed]; 12345678 clicks, +20%`);
    expect(r.redactions).toBe(2);
  });

  it('masks every string in a traced value', () => {
    expect(maskPersonalData({ a: ['x a@b.co'], b: 3, c: null })).toEqual({
      a: [`x ${EMAIL_PLACEHOLDER}`],
      b: 3,
      c: null,
    });
  });
});

describe('generateStructured', () => {
  let t: TestDatabase;
  let productId: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    productId = (
      await createProduct(t.db, {
        slug: 'snappool',
        name: 'SnapPool',
        packId: 'saas-snappool',
        settings: TEST_SETTINGS,
      })
    ).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const context = (cycleId: string | null) =>
    ({ product: { id: productId, slug: 'snappool' }, cycleId, stage: 'analyst' }) as const;

  it('returns the parsed output and its cost on the first attempt', async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply(VALID, 1000, 200) });
    const result = await generateStructured(
      { env: {}, model: { model, spec: OPUS } },
      { context: context(null), schema: Answer, instructions: 'Judge it.', prompt: 'DATA: {}' },
    );
    expect(result.output).toEqual({ verdict: 'ok', note: 'fine' });
    expect(result.attempts).toBe(1);
    expect(result.costMicros).toBe(8_000n); // 1000×4 + 200×20
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('retries once when the output fails the schema, and counts both attempts', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [reply(JSON.stringify({ verdict: 'maybe' }), 500, 100), reply(VALID, 600, 100)],
    });
    const result = await generateStructured(
      { env: {}, model: { model, spec: OPUS } },
      { context: context(null), schema: Answer, instructions: 'Judge it.', prompt: 'DATA: {}' },
    );
    expect(result.attempts).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 1100, outputTokens: 200 });
    expect(result.costMicros).toBe(4_000n + 4_400n); // (500×4 + 100×20) + (600×4 + 100×20)
    expect(sentText(model.doGenerateCalls[0])).not.toContain(SCHEMA_RETRY_NOTE);
    expect(sentText(model.doGenerateCalls[1])).toContain(SCHEMA_RETRY_NOTE);
  });

  it('gives up after the retry, and still records the cost on the cycle', async () => {
    const cycle = await startManual(t.db, { productId, cycleDate: '2026-10-07' });
    const model = new MockLanguageModelV4({
      doGenerate: [reply('not json', 500, 100), reply('{"verdict": 1}', 500, 100)],
    });
    const call = generateStructured(
      { env: {}, db: t.db, model: { model, spec: OPUS } },
      { context: context(cycle.id), schema: Answer, instructions: 'Judge it.', prompt: 'DATA: {}' },
    );
    await expect(call).rejects.toBeInstanceOf(StructuredOutputError);
    await expect(call).rejects.toMatchObject({ attempts: 2, costMicros: 8_000n });
    expect((await getCycle(t.db, cycle.id)).modelCostMicros).toBe(8_000n);
  });

  it('adds each call to the cycle total (cost recorded per cycle)', async () => {
    const cycle = await startManual(t.db, { productId, cycleDate: '2026-10-08' });
    for (let i = 0; i < 2; i += 1) {
      const model = new MockLanguageModelV4({ doGenerate: reply(VALID, 1000, 200) });
      await generateStructured(
        { env: {}, db: t.db, model: { model, spec: OPUS } },
        { context: context(cycle.id), schema: Answer, instructions: 'Judge it.', prompt: 'DATA: {}' },
      );
    }
    expect((await getCycle(t.db, cycle.id)).modelCostMicros).toBe(16_000n);
  });

  it('refuses an unpriced model before calling it', async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply(VALID) });
    await expect(
      generateStructured(
        { env: {}, model: { model, spec: { provider: 'openai', modelId: 'gpt-unpriced' } } },
        { context: context(null), schema: Answer, instructions: 'Judge it.', prompt: 'DATA: {}' },
      ),
    ).rejects.toBeInstanceOf(ModelConfigError);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('builds the provider from the environment, and needs its key', async () => {
    await expect(
      generateStructured(
        { env: { MODEL_ANALYST: 'anthropic:claude-opus-5-5' } },
        { context: context(null), schema: Answer, instructions: 'Judge it.', prompt: 'DATA: {}' },
      ),
    ).rejects.toThrow(/needs ANTHROPIC_API_KEY/);
  });

  it('traces with product, cycle and stage, and sends or traces no personal data', async () => {
    const exporter = new InMemorySpanExporter();
    // Made-up keys, built at run time (GOTCHAS: never write a fake secret as a literal).
    const keys = { LANGFUSE_PUBLIC_KEY: `pk-lf-${'0'.repeat(8)}`, LANGFUSE_SECRET_KEY: `sk-lf-${'0'.repeat(8)}` };
    const tracing = createModelTracing(keys, { exporter });
    expect(tracing).not.toBeNull();
    const cycle = await startManual(t.db, { productId, cycleDate: '2026-10-09' });
    const model = new MockLanguageModelV4({ doGenerate: reply(VALID) });
    const result = await generateStructured(
      { env: {}, db: t.db, tracing, model: { model, spec: OPUS } },
      {
        context: context(cycle.id),
        schema: Answer,
        instructions: 'Judge it.',
        prompt: 'DATA: {"searchTerms": ["jane.doe@example.com", "+65 9123 4567"]}',
      },
    );
    await tracing?.flush();
    expect(result.redactions).toBe(2);
    expect(sentText(model.doGenerateCalls[0])).not.toContain('jane.doe@example.com');
    expect(sentText(model.doGenerateCalls[0])).not.toContain('9123');

    const spans: ReadableSpan[] = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.attributes['langfuse.trace.tags']).toEqual(
        expect.arrayContaining(['product:snappool', 'stage:analyst', `cycle:${cycle.id}`]),
      );
      expect(span.attributes['session.id']).toBe(cycle.id);
    }
    const traced = JSON.stringify(spans.map((s) => s.attributes));
    expect(traced).not.toContain('jane.doe@example.com');
    expect(traced).not.toContain('9123 4567');
    await tracing?.shutdown();
  });

  it('runs untraced without Langfuse keys', () => {
    expect(createModelTracing({})).toBeNull();
    expect(createModelTracing({ LANGFUSE_PUBLIC_KEY: 'x' })).toBeNull();
  });
});
