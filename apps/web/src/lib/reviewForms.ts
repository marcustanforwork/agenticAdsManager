// The review screens' forms → the operator request each records (M10b). Pure, so the tests prove each button asks
// for exactly the right thing; actions.ts records the result. The worker decides: a stale version, an expired
// proposal or a change already undone is refused there, with the reason.
import { OperatorRequest } from '@ads/contracts';
import { type Fields, checked, moneyToMicros, str, versionOf } from './forms.ts';

/** A form the contract rejects: its message is shown to Marcus, in plain words. */
export class FormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormError';
  }
}

function parsed(request: unknown, what: string): OperatorRequest {
  const result = OperatorRequest.safeParse(request);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(form)'}: ${i.message}`).join('; ');
    throw new FormError(`${what}: ${issues}`);
  }
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
      return parsed({ kind: 'approve', proposalId, version, actionHash: str(f, 'actionHash') }, 'Approve');
    case 'reject': {
      const reason = str(f, 'reason');
      if (reason.length < 3) throw new FormError('Reject: say why, in a few words (at least 3 characters).');
      return parsed({ kind: 'reject', proposalId, version, reason }, 'Reject');
    }
    case 'edit_budget': {
      const micros = moneyToMicros(str(f, 'budget'));
      if (!/^\d+$/.test(micros) || micros === '0') {
        throw new FormError('Edit: the new daily budget must be an amount above zero, such as 45 or 12.50.');
      }
      return parsed(
        { kind: 'edit_approve', proposalId, version, edit: { field: 'budget', newDailyBudgetMicros: micros } },
        'Edit',
      );
    }
    case 'edit_text':
      return parsed(
        { kind: 'edit_approve', proposalId, version, edit: { field: 'negative_text', text: str(f, 'text') } },
        'Edit',
      );
    case 'edit_match':
      return parsed(
        { kind: 'edit_approve', proposalId, version, edit: { field: 'match_type', matchType: str(f, 'matchType') } },
        'Edit',
      );
    default:
      throw new FormError(`not a proposal action: ${verb}`);
  }
}

/** "Request undo" on a change: the worker answers with the change's stored undo (Phase 1: made by hand). */
export function undoRequest(f: Fields): OperatorRequest {
  return parsed({ kind: 'undo', revisionId: str(f, 'revisionId') }, 'Undo');
}

/** A brief's 👍 useful / 💡 new to me (the Phase 0 gate's measure): both answers, as the form shows them. */
export function briefFeedbackRequest(f: Fields): OperatorRequest {
  return parsed(
    {
      kind: 'brief_feedback',
      briefId: str(f, 'briefId'),
      useful: checked(f, 'useful'),
      newInfo: checked(f, 'newInfo'),
    },
    'Feedback',
  );
}

/** A product document, saved as the next version of the one the editor showed. Browsers send a textarea's line
 *  breaks as CRLF; the document is stored with plain LF. The text is kept as typed (not trimmed). */
export function docRequest(f: Fields): OperatorRequest {
  const markdown = (f.get('markdown')?.[0] ?? '').replaceAll('\r\n', '\n');
  return parsed(
    {
      kind: 'product_doc_put',
      productId: str(f, 'productId'),
      doc: str(f, 'doc'),
      baseVersion: versionOf(str(f, 'baseVersion')),
      markdown,
    },
    'Save',
  );
}
