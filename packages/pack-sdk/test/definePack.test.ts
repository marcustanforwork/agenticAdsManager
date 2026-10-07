import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PackDefinitionError, UnknownPackError, createRegistry, definePack } from '../src/index.ts';
import { testPack } from './support.ts';

const issuesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof PackDefinitionError) return e.issues;
    throw e;
  }
  throw new Error('expected a PackDefinitionError');
};

describe('definePack', () => {
  it('accepts a valid pack and freezes it', () => {
    const pack = definePack(testPack());
    expect(pack.manifest.id).toBe('saas-test');
    expect(Object.isFrozen(pack.manifest)).toBe(true);
    expect(() => {
      (pack.manifest as { id: string }).id = 'other';
    }).toThrow();
  });

  it('accepts tighter guard overrides and rejects looser ones (against the core and each platform default)', () => {
    expect(() => definePack(testPack({ guardOverrides: { maxBudgetChangePct: 15, cooldownDays: 10 } }))).not.toThrow();
    // 25% is tighter than the core's 30% but looser than Meta's 20%.
    expect(issuesOf(() => definePack(testPack({ guardOverrides: { maxBudgetChangePct: 25 } })))).toEqual([
      expect.stringMatching(/^guardOverrides\.maxBudgetChangePct: looser than the core or meta default/),
    ]);
    expect(issuesOf(() => definePack(testPack({ guardOverrides: { cooldownDays: 3 } })))[0]).toMatch(
      /^guardOverrides\.cooldownDays: looser/,
    );
    expect(issuesOf(() => definePack(testPack({ guardOverrides: { budgetNeutralByDefault: false } })))[0]).toMatch(
      /^guardOverrides\.budgetNeutralByDefault: looser/,
    );
  });

  it('rejects unknown finding types and bad thresholds', () => {
    const t = { minImpressions: 1, minClicks: 1, minSpendMicros: '1', minDays: 1 };
    expect(issuesOf(() => definePack(testPack({ thresholds: { made_up: t } as never })))).toEqual([
      'thresholds.made_up: unknown finding type',
    ]);
    expect(issuesOf(() => definePack(testPack({ thresholds: { cost_spike: { ...t, minClicks: -1 } } })))).toEqual([
      expect.stringMatching(/^thresholds\.cost_spike\.minClicks:/),
    ]);
  });

  it('rejects bad defaults, phases, facts and policy, naming each problem', () => {
    const issues = issuesOf(() =>
      definePack(
        testPack({
          id: 'Bad Id',
          version: '1.0',
          defaults: {
            outcomes: { stages: [{ id: 'a', label: 'A', tier: 'soft' }], primaryKpiStage: 'nope', feedback: [] },
            copy: { tier: 'fragments', requiredStrings: [], bannedPhrases: [] },
          },
          phases: [
            { id: 'p', label: 'P', intent: 'x', budgetPosture: 'steady' },
            { id: 'p', label: 'P2', intent: 'y', budgetPosture: 'push' },
          ],
          facts: { schema: z.object({ a: z.string() }), requiredForCopy: ['b'] },
          disabledActions: ['delete_everything' as never],
          platformPolicy: { meta: { specialAdCategories: [''] } },
          analystContext: '  ',
        }),
      ),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        'id: must look like saas-product',
        'version: must be semver',
        'defaults.outcomes.primaryKpiStage: must be one of the stage ids',
        'phases: ids must be unique',
        'facts.requiredForCopy: "b" is not a fact in the schema',
        'analystContext: must be non-empty text',
        expect.stringMatching(/^disabledActions\.0:/),
        expect.stringMatching(/^platformPolicy\.meta\.specialAdCategories\.0:/),
      ]),
    );
  });

  it('rejects a fact schema JSON Schema cannot express, or one that is not an object', () => {
    const dated = z.object({ when: z.date() });
    expect(issuesOf(() => definePack(testPack({ facts: { schema: dated, requiredForCopy: [] } })))[0]).toMatch(
      /^facts\.schema: can't be expressed as JSON Schema/,
    );
    expect(issuesOf(() => definePack(testPack({ facts: { schema: z.string(), requiredForCopy: [] } })))).toEqual([
      'facts.schema: must be a zod object schema',
    ]);
  });

  it('rejects a runtime without its functions', () => {
    expect(issuesOf(() => definePack({ ...testPack(), runtime: {} as never }))).toEqual([
      'runtime.outcomeAdapter: must be a function',
      'runtime.detectPhase: must be a function',
    ]);
  });
});

describe('the registry', () => {
  it('finds packs by id and refuses unknown ids and duplicates', () => {
    const registry = createRegistry([testPack(), testPack({ id: 'saas-other' })]);
    expect(registry.list().map((p) => p.manifest.id)).toEqual(['saas-other', 'saas-test']);
    expect(registry.get('saas-test').manifest.id).toBe('saas-test');
    expect(registry.has('saas-none')).toBe(false);
    expect(() => registry.get('saas-none')).toThrow(UnknownPackError);
    expect(() => createRegistry([testPack(), testPack()])).toThrow('two packs have the id "saas-test"');
  });

  it('checks every pack it is given', () => {
    expect(() => createRegistry([testPack({ version: 'x' })])).toThrow(PackDefinitionError);
  });
});
