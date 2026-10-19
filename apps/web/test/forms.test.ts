// The settings screens and the fact editor read forms into requests (M10a). They only read: whether a value is
// allowed is the worker's call (core/test/webRequests.test.ts) and, for facts, the pack's schema's.
import { jsonSchemaIssues } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { factsFromForm, nodeOf } from '../src/lib/factsForm.ts';
import { fieldsOf, microsToInput, moneyToMicros } from '../src/lib/forms.ts';
import { changedPaths } from '../src/lib/history.ts';
import { patchFromForm } from '../src/lib/settingsForm.ts';

const form = (pairs: [string, string][]) => fieldsOf(pairs);

describe('money in forms', () => {
  it('reads amounts exactly, with S$ and thousands commas; anything else stays as typed', () => {
    expect(moneyToMicros('25')).toBe('25000000');
    expect(moneyToMicros('S$1,250.50')).toBe('1250500000');
    expect(moneyToMicros('0.000001')).toBe('1');
    for (const bad of ['abc', '1.0000001', '1e3', '.5']) expect(moneyToMicros(bad)).toBe(bad);
  });

  it('shows micros as an exact amount, round-tripping', () => {
    expect(microsToInput('25000000')).toBe('25');
    expect(microsToInput('12500000')).toBe('12.5');
    expect(microsToInput('1')).toBe('0.000001');
    expect(microsToInput(null)).toBe('');
    for (const m of ['0', '7', '19900000', '123456789012']) expect(moneyToMicros(microsToInput(m))).toBe(m);
  });
});

describe('settings screens → settings_patch', () => {
  it('spending: blank ceilings unset them; amounts become micros', () => {
    const patch = patchFromForm(
      'spend',
      form([
        ['dailyCeiling', '25'],
        ['monthlyCeiling', ''],
        ['digest', 'off'],
      ]),
    );
    expect(patch).toEqual({
      spend: { dailyCeilingMicros: '25000000', monthlyCeilingMicros: null, autoPauseOnMonthlyBreach: false },
      notifications: { digest: 'off' },
    });
  });

  it('trust: numbers as numbers; text that is not a number is sent as typed, for the worker to refuse', () => {
    const patch = patchFromForm(
      'trust',
      form([
        ['minClicksToJudgeTracking', '30'],
        ['maxOutcomeStalenessHours', '48'],
        ['maxAttributionGapPct', '12.5'],
        ['minOutcomesForGap', 'ten'],
        ['minIdCapturePct', '60'],
      ]),
    );
    expect(patch).toEqual({
      trust: {
        minClicksToJudgeTracking: 30,
        maxOutcomeStalenessHours: 48,
        maxAttributionGapPct: 12.5,
        minOutcomesForGap: 'ten',
        minIdCapturePct: 60,
      },
    });
  });

  it('outcomes: rows become lists (removed and empty rows dropped), with the KPI stage', () => {
    const patch = patchFromForm(
      'outcomes',
      form([
        ['stage.0.id', 'signup'],
        ['stage.0.label', 'Signup'],
        ['stage.0.tier', 'success'],
        ['stage.0.value', ''],
        ['stage.1.id', 'paid'],
        ['stage.1.label', 'Paid'],
        ['stage.1.tier', 'hard'],
        ['stage.1.value', '19.90'],
        ['stage.2.id', 'old'],
        ['stage.2.label', 'Old'],
        ['stage.2.tier', 'soft'],
        ['stage.2.remove', 'on'],
        ['stage.3.id', ''],
        ['stage.3.label', ''],
        ['stage.3.tier', 'success'],
        ['stage.3.value', ''],
        ['primaryKpiStage', 'signup'],
        ['feedback.0.stage', 'signup'],
        ['feedback.0.platform', 'meta'],
        ['feedback.0.destinationId', ''],
        ['feedback.0.eventName', 'CompleteRegistration'],
        ['feedback.1.stage', ''],
        ['feedback.1.platform', 'meta'],
        ['feedback.1.destinationId', ''],
        ['feedback.1.eventName', ''],
      ]),
    );
    expect(patch).toEqual({
      outcomes: {
        stages: [
          { id: 'signup', label: 'Signup', tier: 'success' },
          { id: 'paid', label: 'Paid', tier: 'hard', valueMicros: '19900000' },
        ],
        primaryKpiStage: 'signup',
        feedback: [{ stage: 'signup', platform: 'meta', destinationId: null, eventName: 'CompleteRegistration' }],
      },
    });
  });

  it('copy and test traffic: one item per line, blank lines dropped', () => {
    expect(
      patchFromForm(
        'copy',
        form([
          ['tier', 'fragments'],
          ['requiredStrings', 'CEA licence L3008022J\r\n\n  Terms apply  '],
          ['bannedPhrases', ''],
        ]),
      ),
    ).toEqual({
      copy: { tier: 'fragments', requiredStrings: ['CEA licence L3008022J', 'Terms apply'], bannedPhrases: [] },
    });
    expect(patchFromForm('testTraffic', form([['emailDomains', 'Example.com\nexample.org']]))).toEqual({
      testTraffic: { emailDomains: ['example.com', 'example.org'] },
    });
  });

  it('guards: blank fields are left out (never removed); disabled actions are the ticked boxes', () => {
    const patch = patchFromForm(
      'guards',
      form([
        ['maxBudgetChangePct', '15'],
        ['minBudgetDeltaMicros', '10'],
        ['minBudgetDeltaPct', ''],
        ['cooldownDays', ''],
        ['maxAppliedPerDay', '5'],
        ['budgetNeutralByDefault', ''],
        ['disabledActions', 'adjust_budget'],
        ['disabledActions', 'create_entity_paused'],
      ]),
    );
    expect(patch).toEqual({
      guardOverrides: { maxBudgetChangePct: 15, minBudgetDeltaMicros: '10000000', maxAppliedPerDay: 5 },
      disabledActions: ['adjust_budget', 'create_entity_paused'],
    });
    expect(patchFromForm('guards', form([['budgetNeutralByDefault', 'true']]))).toEqual({
      guardOverrides: { budgetNeutralByDefault: true },
      disabledActions: [],
    });
  });
});

describe('settings history', () => {
  it('lists the changed settings, lists compared whole', () => {
    const before = {
      spend: { dailyCeilingMicros: '25000000', monthlyCeilingMicros: null },
      copy: { bannedPhrases: ['a'] },
    };
    const after = {
      spend: { dailyCeilingMicros: '20000000', monthlyCeilingMicros: null },
      copy: { bannedPhrases: ['a', 'b'] },
    };
    expect(changedPaths(before, after)).toEqual([
      { path: 'copy.bannedPhrases', before: ['a'], after: ['a', 'b'] },
      { path: 'spend.dailyCeilingMicros', before: '25000000', after: '20000000' },
    ]);
    expect(changedPaths(after, after)).toEqual([]);
    expect(changedPaths({ a: 1 }, { a: 1, b: 2 })).toEqual([{ path: 'b', before: undefined, after: 2 }]);
  });
});

describe('the fact editor', () => {
  // Shaped like the packs' fact schemas, published the way the worker publishes them (zod → JSON Schema, input).
  const Facts = z.object({
    district: z.string().regex(/^D(0[1-9]|1\d|2[0-8])$/),
    features: z.array(z.string().min(1)).min(1),
    plans: z.array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
        priceMicros: z
          .string()
          .regex(/^-?\d{1,19}$/)
          .nullable(),
        limits: z.object({ guests: z.number().int().min(0).optional() }),
      }),
    ),
    pricing: z.object({ phase: z.enum(['beta', 'standard']), notes: z.string().max(20).optional() }),
    mrt: z
      .array(z.object({ station: z.string().min(1), walkMinutes: z.number().int().max(60).optional() }))
      .max(2)
      .optional(),
    launch: z.object({ teaser: z.string().optional() }).optional(),
  });
  const jsonSchema = z.toJSONSchema(Facts, { io: 'input' }) as Record<string, unknown>;
  const root = nodeOf(jsonSchema);
  const good: [string, string][] = [
    ['f:district', 'D19'],
    ['f:features', 'Shared photo pool\n\nGuest uploads'],
    ['f:plans.0.id', 'free'],
    ['f:plans.0.priceMicros', ''],
    ['f:plans.0.limits.guests', '50'],
    ['f:plans.1.id', 'pro'],
    ['f:plans.1.priceMicros', 'S$19.90'],
    ['f:plans.1.limits.guests', ''],
    ['f:plans.2.id', ''],
    ['f:plans.2.limits.guests', ''],
    ['f:pricing.phase', 'beta'],
    ['f:pricing.notes', ''],
    ['f:mrt.0.station', 'Serangoon'],
    ['f:mrt.0.walkMinutes', '6'],
    ['f:mrt.1.station', 'Old'],
    ['f:mrt.1.__remove', 'on'],
    ['f:launch.teaser', ''],
  ];

  it('reads the generated form back into facts the schema accepts', () => {
    const facts = factsFromForm(root, form(good));
    expect(facts).toEqual({
      district: 'D19',
      features: ['Shared photo pool', 'Guest uploads'],
      plans: [
        { id: 'free', priceMicros: null, limits: { guests: 50 } },
        { id: 'pro', priceMicros: '19900000', limits: {} },
      ],
      pricing: { phase: 'beta' },
      mrt: [{ station: 'Serangoon', walkMinutes: 6 }],
    });
    expect(jsonSchemaIssues(jsonSchema, facts)).toEqual([]);
    expect(Facts.safeParse(facts).success).toBe(true);
  });

  it("rejects anything the pack's schema rejects, naming it", () => {
    /** The good form with some fields changed; null takes a field out (an unticked box isn't sent). */
    const edit = (changes: Record<string, string | null>) =>
      factsFromForm(
        root,
        form([
          ...good.filter(([k]) => !(k in changes)),
          ...Object.entries(changes).filter((e): e is [string, string] => e[1] !== null),
        ]),
      );
    const cases: [Record<string, unknown>, RegExp][] = [
      [edit({ 'f:district': 'D29' }), /^district: /],
      [edit({ 'f:features': '' }), /^features: /],
      [edit({ 'f:plans.0.id': 'Free Plan' }), /^plans\.0\.id: /],
      [edit({ 'f:plans.1.priceMicros': 'nineteen' }), /^plans\.1\.priceMicros: /],
      [edit({ 'f:plans.0.limits.guests': '1.5' }), /^plans\.0\.limits\.guests: /],
      [edit({ 'f:plans.0.limits.guests': 'many' }), /^plans\.0\.limits\.guests: /],
      [edit({ 'f:pricing.phase': '' }), /^pricing\.phase: /],
      [edit({ 'f:pricing.notes': 'x'.repeat(21) }), /^pricing\.notes: /],
      [edit({ 'f:mrt.0.walkMinutes': '61' }), /^mrt\.0\.walkMinutes: /],
      [edit({ 'f:mrt.1.__remove': null, 'f:mrt.2.station': 'Third' }), /^mrt: /],
      [{ ...edit({}), colour: 'blue' }, /^colour: not a fact$/],
      [{ ...edit({}), plans: [{ id: 'x', priceMicros: null, limits: {}, extra: 1 }] }, /^plans\.0\.extra: not a fact$/],
    ];
    for (const [facts, issue] of cases) {
      if (!issue.source.includes('not a fact')) expect(Facts.safeParse(facts).success).toBe(false); // zod strips unknown keys
      const issues = jsonSchemaIssues(jsonSchema, facts);
      expect(
        issues.some((i) => issue.test(i)),
        `${JSON.stringify(facts)} → ${issues.join('; ')}`,
      ).toBe(true);
    }
  });

  it('an empty form gives the required lists and objects empty, so the schema names what is missing', () => {
    const facts = factsFromForm(root, form([]));
    expect(facts).toEqual({ features: [], plans: [], pricing: {} });
    const issues = jsonSchemaIssues(jsonSchema, facts);
    expect(issues.some((i) => i.startsWith('district: '))).toBe(true);
    expect(issues.some((i) => i.startsWith('features: '))).toBe(true);
  });
});
