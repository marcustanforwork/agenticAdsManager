// Settings screens → settings_patch (M10a). Each screen sends one section as a patch; the worker merges it onto
// the current version (objects key by key, lists replaced) and validates the result, so this file only reads the
// form. It never decides whether a value is allowed: tighten-only guards, KPI stage ids and the rest are the
// worker's to judge, and the page shows its verdict.
import { ActionType } from '@ads/contracts';
import { type Fields, all, checked, lines, moneyToMicros, num, str } from './forms.ts';

export const SECTIONS = ['spend', 'trust', 'outcomes', 'copy', 'testTraffic', 'guards'] as const;
export type Section = (typeof SECTIONS)[number];
export const isSection = (s: string): s is Section => (SECTIONS as readonly string[]).includes(s);

export const TRUST_FIELDS = [
  ['minClicksToJudgeTracking', 'Fewest clicks before tracking is judged'],
  ['maxOutcomeStalenessHours', 'Outcomes older than this are stale (hours)'],
  ['maxAttributionGapPct', 'Largest attribution gap (%)'],
  ['minOutcomesForGap', 'Fewest outcomes before the gap is judged'],
  ['minIdCapturePct', 'Warn when click ids are captured on fewer than (%)'],
] as const;

/** Guard override fields; `money` fields are amounts in the product's currency. */
export const GUARD_FIELDS = [
  ['maxBudgetChangePct', 'Largest budget change (%)', 'number'],
  ['minBudgetDeltaMicros', 'Smallest budget change (amount)', 'money'],
  ['minBudgetDeltaPct', 'Smallest budget change (%)', 'number'],
  ['cooldownDays', 'Days between changes to one entity', 'number'],
  ['maxAppliedPerDay', 'Most changes applied a day', 'number'],
] as const;

export const ACTIONS: readonly string[] = ActionType.options;

/** Row indices present in the form for `prefix.<i>.<field>` names, in order. */
function rowIndices(f: Fields, prefix: string): number[] {
  const found = new Set<number>();
  const re = new RegExp(`^${prefix}\\.(\\d+)\\.`);
  for (const name of f.keys()) {
    const m = re.exec(name);
    if (m?.[1] !== undefined) found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

function stagesOf(f: Fields): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const i of rowIndices(f, 'stage')) {
    const at = (field: string) => str(f, `stage.${i}.${field}`);
    if (checked(f, `stage.${i}.remove`)) continue;
    if (at('id') === '' && at('label') === '' && at('value') === '') continue; // the empty "add a stage" row
    const value = at('value');
    out.push({
      id: at('id'),
      label: at('label'),
      tier: at('tier'),
      ...(value === '' ? {} : { valueMicros: moneyToMicros(value) }),
    });
  }
  return out;
}

function feedbackOf(f: Fields): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const i of rowIndices(f, 'feedback')) {
    const at = (field: string) => str(f, `feedback.${i}.${field}`);
    if (checked(f, `feedback.${i}.remove`)) continue;
    if (at('stage') === '' && at('destinationId') === '' && at('eventName') === '') continue; // the empty row
    const eventName = at('eventName');
    out.push({
      stage: at('stage'),
      platform: at('platform'),
      destinationId: at('destinationId') === '' ? null : at('destinationId'),
      ...(eventName === '' ? {} : { eventName }),
    });
  }
  return out;
}

/** The patch one settings screen sends. */
export function patchFromForm(section: Section, f: Fields): Record<string, unknown> {
  switch (section) {
    case 'spend': {
      const ceiling = (name: string) => (str(f, name) === '' ? null : moneyToMicros(str(f, name)));
      return {
        spend: {
          dailyCeilingMicros: ceiling('dailyCeiling'),
          monthlyCeilingMicros: ceiling('monthlyCeiling'),
          autoPauseOnMonthlyBreach: checked(f, 'autoPauseOnMonthlyBreach'),
        },
        notifications: { digest: str(f, 'digest') },
      };
    }
    case 'trust':
      return { trust: Object.fromEntries(TRUST_FIELDS.map(([key]) => [key, num(str(f, key))])) };
    case 'outcomes':
      return {
        outcomes: { stages: stagesOf(f), primaryKpiStage: str(f, 'primaryKpiStage'), feedback: feedbackOf(f) },
      };
    case 'copy':
      return {
        copy: {
          tier: str(f, 'tier'),
          requiredStrings: lines(str(f, 'requiredStrings')),
          bannedPhrases: lines(str(f, 'bannedPhrases')),
        },
      };
    case 'testTraffic':
      return { testTraffic: { emailDomains: lines(str(f, 'emailDomains').toLowerCase()) } };
    case 'guards': {
      // A blank field leaves that override as it is: overrides merge key by key, so one can be tightened or added
      // here, never removed (removing one loosens a guard; see the milestone file's leave-behind notes).
      const overrides: Record<string, unknown> = {};
      for (const [key, , kind] of GUARD_FIELDS) {
        const text = str(f, key);
        if (text !== '') overrides[key] = kind === 'money' ? moneyToMicros(text) : num(text);
      }
      const neutral = str(f, 'budgetNeutralByDefault');
      if (neutral !== '') overrides['budgetNeutralByDefault'] = neutral === 'true';
      return { guardOverrides: overrides, disabledActions: all(f, 'disabledActions') };
    }
  }
}
