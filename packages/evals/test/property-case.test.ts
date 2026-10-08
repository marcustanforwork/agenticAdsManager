// The first replay case (M06b "Done when"): the property fixture's analyst run, saved in cases/. Replaying its
// answer against a fresh copy of the fixture must reproduce the case exactly: the same prompt (the input builder
// is deterministic) and the same verdicts (the validation is). A deliberate change to either shows up here; rerun
// `pnpm --filter @ads/evals case:property --answer <file> --write` (or with a model) and review the diff.
import { readFileSync } from 'node:fs';
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import { INJECTION_TERM, type ReplayCase, runPropertyCase } from '../src/index.ts';

const saved = JSON.parse(
  readFileSync(new URL('../cases/property-sg-0001.json', import.meta.url), 'utf8'),
) as ReplayCase;

let t: TestDatabase | undefined;
afterEach(async () => {
  await t?.drop();
  t = undefined;
});

describe('replay case property-sg-0001', () => {
  it('reproduces the saved case from its answer', async () => {
    t = await createTestDatabase();
    // A model's answer (the live step) replays like a recorded one; only `answeredBy` says where it came from.
    const note = saved.answeredBy.source === 'recorded' ? saved.answeredBy.note : '';
    const replayed = await runPropertyCase(t.db, { recorded: { output: saved.analystOutput, note } });
    expect({ ...replayed, answeredBy: saved.answeredBy }).toEqual(saved);
  });

  it('covers what the plan asks of it: every detector type, the injection term as data', () => {
    expect(saved.input.candidates.map((c) => c.type).sort()).toEqual([
      'cost_spike',
      'no_delivery',
      'pacing_risk',
      'wasteful_search_term',
      'wasteful_search_term',
      'zero_outcome_spend',
    ]);
    const data = saved.input.prompt.indexOf('<data>');
    expect(saved.input.prompt.indexOf(INJECTION_TERM)).toBeGreaterThan(data);
    expect(saved.input.withinCap).toBe(true);
    expect(saved.input.phases).toEqual([{ offering: 'sora-at-lakeside', phase: 'teaser' }]);
    if (saved.answeredBy.source === 'recorded') {
      // The hand-written answer reviews every candidate validly; a model's answer is judged by Marcus instead.
      expect(saved.result.dropped).toEqual([]);
      expect(saved.result.unreviewed).toBe(0);
    }
  });

  it('runs with a model too, and records it', async () => {
    t = await createTestDatabase();
    const reply: LanguageModelV4GenerateResult = {
      content: [{ type: 'text', text: JSON.stringify({ findings: [], dismissed: [] }) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 5000, noCache: 5000, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 100, text: 100, reasoning: undefined },
      },
      warnings: [],
    };
    const model = new MockLanguageModelV4({ doGenerate: reply });
    const run = await runPropertyCase(t.db, {
      model: { model, spec: { provider: 'anthropic', modelId: 'claude-opus-5-5' } },
      lookups: false,
    });
    expect(run.answeredBy).toMatchObject({ source: 'model', model: 'anthropic:claude-opus-5-5', attempts: 1 });
    expect(run.result.unreviewed).toBe(6);
    expect(run.input.prompt).toBe(saved.input.prompt);
  });
});
