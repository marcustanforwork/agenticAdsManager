// The review screens' forms → the operator request each records (M10b). Pure, so the tests prove each button asks
// for exactly the right thing; actions.ts records the result. The worker decides: a stale version, an expired
// proposal or a change already undone is refused there, with the reason.
import { OperatorRequest } from '@ads/contracts';
import { type Fields, checked, moneyToMicros, str, versionOf } from './forms.ts';

/** Why a review form went back unsent, by code (F1). Only the code travels in the screen's `?error=`; the screen
 *  looks the words up here, so a crafted link can't put its own text on the page. */
export const FORM_ERRORS = {
  invalid: 'The form was incomplete or out of date. Reload the page and try again.',
  reject_reason: 'Reject: say why, in a few words (at least 3 characters).',
  budget: 'Edit: the new daily budget must be an amount above zero, such as 45 or 12.50.',
  negative_text: 'Edit: the negative keyword needs its words (at most 80 characters).',
  match_type: 'Edit: the match type must be exact or phrase.',
  feedback_unchanged: 'Feedback: nothing changed. Tick or untick an answer, then save.',
} as const;
export type FormErrorCode = keyof typeof FORM_ERRORS;

/** The words for a `?error=` code; any other value (unknown, or crafted) gets the generic line. */
export function formErrorText(code: string): string {
  return Object.hasOwn(FORM_ERRORS, code) ? FORM_ERRORS[code as FormErrorCode] : FORM_ERRORS.invalid;
}

/** A form the contract rejects: its code goes back to the screen, which shows the words for it. */
export class FormError extends Error {
  readonly code: FormErrorCode;
  constructor(code: FormErrorCode) {
    super(FORM_ERRORS[code]);
    this.name = 'FormError';
    this.code = code;
  }
}

/** The request if the contract accepts it; otherwise the form goes back with `code` (`invalid` unless the form has
 *  a more precise one). */
function parsed(request: unknown, code: FormErrorCode = 'invalid'): OperatorRequest {
  const result = OperatorRequest.safeParse(request);
  if (!result.success) throw new FormError(code);
  return result.data;
}

/** A proposal card's buttons: approve, reject (with a reason), or edit one field and approve. Each names the
 *  version the screen showed, so a decision on an older version is refused. */
export function proposalRequest(f: Fields): OperatorRequest {
  const proposalId = str(f, 'proposalId');
  const version = versionOf(str(f, 'version'));
  const verb = str(f, 'verb');
  switch (verb) {
    case 'approve':
      return parsed({ kind: 'approve', proposalId, version, actionHash: str(f, 'actionHash') });
    case 'reject': {
      const reason = str(f, 'reason');
      if (reason.length < 3) throw new FormError('reject_reason');
      return parsed({ kind: 'reject', proposalId, version, reason });
    }
    case 'edit_budget': {
      const micros = moneyToMicros(str(f, 'budget'));
      if (!/^\d+$/.test(micros) || micros === '0') {
        throw new FormError('budget');
      }
      return parsed({
        kind: 'edit_approve',
        proposalId,
        version,
        edit: { field: 'budget', newDailyBudgetMicros: micros },
      });
    }
    case 'edit_text':
      return parsed(
        { kind: 'edit_approve', proposalId, version, edit: { field: 'negative_text', text: str(f, 'text') } },
        'negative_text',
      );
    case 'edit_match':
      return parsed(
        { kind: 'edit_approve', proposalId, version, edit: { field: 'match_type', matchType: str(f, 'matchType') } },
        'match_type',
      );
    default:
      throw new FormError('invalid');
  }
}

/** "Request undo" on a change: the worker answers with the change's stored undo (Phase 1: made by hand). */
export function undoRequest(f: Fields): OperatorRequest {
  return parsed({ kind: 'undo', revisionId: str(f, 'revisionId') });
}

/** A brief's 👍 useful / 💡 new to me (the Phase 0 gate's measure). Only the answers changed on the page are sent
 *  (F1): the form carries what it showed (`usefulShown`, `newInfoShown`: `on` when ticked), so an answer given on
 *  Telegram after the page loaded is never overwritten by a box left as it was. */
export function briefFeedbackRequest(f: Fields): OperatorRequest {
  const changed = (name: 'useful' | 'newInfo') =>
    checked(f, name) === (str(f, `${name}Shown`) === 'on') ? {} : { [name]: checked(f, name) };
  const answers = { ...changed('useful'), ...changed('newInfo') };
  if (Object.keys(answers).length === 0) {
    throw new FormError('feedback_unchanged');
  }
  return parsed({ kind: 'brief_feedback', briefId: str(f, 'briefId'), ...answers });
}

/** A product document, saved as the next version of the one the editor showed. Browsers send a textarea's line
 *  breaks as CRLF; the document is stored with plain LF. The text is kept as typed (not trimmed). */
export function docRequest(f: Fields): OperatorRequest {
  const markdown = (f.get('markdown')?.[0] ?? '').replaceAll('\r\n', '\n');
  return parsed({
    kind: 'product_doc_put',
    productId: str(f, 'productId'),
    doc: str(f, 'doc'),
    baseVersion: versionOf(str(f, 'baseVersion')),
    markdown,
  });
}
