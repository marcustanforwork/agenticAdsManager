// The AI, faked: one mock model for the three stages that call it, told apart by their instructions, as a real
// model would be. The analyst confirms every detector candidate (and proposes the search term itself as the
// negative); the drafter writes one plain sentence pair per proposal; the brief's prose quotes no number, so the
// number check keeps it. What each stage was asked is kept, to check the layout (platform text inside the DATA).
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import type { AnalystOutput } from '@ads/contracts';
import { BRIEF_INSTRUCTIONS, DRAFTER_INSTRUCTIONS, type ModelSpec, parseRefText } from '@ads/core';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

export const MODEL_SPEC: ModelSpec = { provider: 'anthropic', modelId: 'claude-opus-5-5' };

export const BRIEF_HEADLINE = 'A quiet week to watch, not to act on.';
export const RATIONALE = 'It spent with nothing to show for it.';

function reply(output: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 4000, noCache: 4000, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 300, text: 300, reasoning: undefined },
    },
    warnings: [],
  };
}

const systemOf = (options: LanguageModelV4CallOptions): string =>
  options.prompt
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');

const userOf = (options: LanguageModelV4CallOptions): string =>
  options.prompt
    .filter((m) => m.role === 'user')
    .flatMap((m) => m.content)
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n');

interface AnalystCandidate {
  id: string;
  type: string;
  target: string;
  negativeText?: string;
}

function analystAnswer(prompt: string): AnalystOutput {
  const data = /<data>\n([\s\S]*?)\n<\/data>/.exec(prompt)?.[1];
  if (data === undefined) throw new Error('the analyst prompt has no DATA block');
  const { candidates } = JSON.parse(data) as { candidates: AnalystCandidate[] };
  const findings: AnalystOutput['findings'] = [];
  for (const c of candidates) {
    const target = parseRefText(c.target);
    if (target === null) continue;
    findings.push({
      type: c.type as AnalystOutput['findings'][number]['type'],
      target,
      fromCandidateId: c.id,
      summary: 'Confirmed: the rule holds and nothing in the data explains it.',
      whyNow: 'It is still spending.',
      evidenceRefs: [c.target],
      ...(c.negativeText === undefined ? {} : { params: { negativeText: c.negativeText, negativeMatchType: 'EXACT' } }),
      confidence: 'medium',
    });
  }
  return { findings, dismissed: [] };
}

function drafterAnswer(prompt: string): unknown {
  const json = /```json\n([\s\S]*?)\n```/.exec(prompt)?.[1] ?? '{"proposals":[]}';
  const { proposals } = JSON.parse(json) as { proposals: { key: string }[] };
  return {
    items: proposals.map((p) => ({ key: p.key, rationale: RATIONALE, expectedEffect: 'Less wasted spend.' })),
  };
}

export interface FakeModel {
  model: { model: LanguageModel; spec: ModelSpec };
  /** The user prompt of each call, by stage. */
  calls: { stage: 'analyst' | 'drafter' | 'brief'; prompt: string }[];
}

export function fakeModel(): FakeModel {
  const calls: FakeModel['calls'] = [];
  const model = new MockLanguageModelV4({
    doGenerate: (options) => {
      const system = systemOf(options);
      const prompt = userOf(options);
      if (system.includes(DRAFTER_INSTRUCTIONS.slice(0, 60))) {
        calls.push({ stage: 'drafter', prompt });
        return Promise.resolve(reply(drafterAnswer(prompt)));
      }
      if (system.includes(BRIEF_INSTRUCTIONS.slice(0, 60))) {
        calls.push({ stage: 'brief', prompt });
        return Promise.resolve(
          reply({ headline: BRIEF_HEADLINE, paragraphs: ['Spend was steady and the checks are mostly fine.'] }),
        );
      }
      calls.push({ stage: 'analyst', prompt });
      return Promise.resolve(reply(analystAnswer(prompt)));
    },
  });
  return { model: { model, spec: MODEL_SPEC }, calls };
}
