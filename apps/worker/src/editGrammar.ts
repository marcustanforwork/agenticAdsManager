// The edit grammar for a pending proposal (BLUEPRINT M09a), typed after pressing Edit on a Telegram card or given to
// `ads proposals edit`. Tiny on purpose:
//   budget 45          → the new daily budget, in the account's currency (up to 2 decimals)
//   keyword "free photos"  (quotes optional) → the negative keyword's text
//   match exact | match phrase → the negative keyword's match type
// It only turns text into an `EditSpec`; whether the edit fits the proposal is the processor's call (`applyEdit`).
import { EditSpec, decimalToMicros, microsToJson } from '@ads/contracts';

export type ParsedEdit = { ok: true; edit: EditSpec } | { ok: false; reason: string };

export const EDIT_HELP = 'budget 45 · keyword "free photos" · match exact (or match phrase)';

const fail = (reason: string): ParsedEdit => ({ ok: false, reason: `${reason}. Try: ${EDIT_HELP}` });

/** Largest daily budget an edit may name, in currency units: a typo guard, far above any real budget. */
const MAX_BUDGET_UNITS = 1_000_000;

export function parseEdit(input: string): ParsedEdit {
  const text = input.trim();
  const m = /^(\w+)\s+([\s\S]+)$/.exec(text);
  if (m === null) return fail('I did not understand that');
  const verb = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').trim();
  switch (verb) {
    case 'budget': {
      const amount = arg.replace(/^S?\$/i, '').replaceAll(',', '');
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount)) return fail('The budget must be an amount like 45 or 45.50');
      const micros = decimalToMicros(amount);
      if (micros <= 0n) return fail('The budget must be more than 0');
      if (micros > BigInt(MAX_BUDGET_UNITS) * 1_000_000n) return fail('That budget is too large');
      return checked({ field: 'budget', newDailyBudgetMicros: microsToJson(micros) });
    }
    case 'keyword': {
      const quoted = /^["“”'](.*)["“”']$/s.exec(arg);
      const keyword = (quoted === null ? arg : (quoted[1] ?? '')).trim().replaceAll(/\s+/g, ' ');
      if (keyword === '') return fail('The keyword is empty');
      if (keyword.length > 80) return fail('The keyword can have at most 80 characters');
      return checked({ field: 'negative_text', text: keyword });
    }
    case 'match': {
      const type = arg.toUpperCase();
      if (type !== 'EXACT' && type !== 'PHRASE') return fail('The match type is exact or phrase');
      return checked({ field: 'match_type', matchType: type });
    }
    default:
      return fail(`"${verb}" is not an edit`);
  }
}

/** Every edit passes the contract's own schema before it leaves the parser. */
function checked(edit: EditSpec): ParsedEdit {
  const parsed = EditSpec.safeParse(edit);
  return parsed.success ? { ok: true, edit: parsed.data } : fail('That edit is not valid');
}
