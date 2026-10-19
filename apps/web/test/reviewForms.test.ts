// The review screens' forms → the operator request each records (M10b).
import { describe, expect, it } from 'vitest';
import { fieldsOf } from '../src/lib/forms.ts';
import {
  FORM_ERRORS,
  FormError,
  briefFeedbackRequest,
  docRequest,
  formErrorText,
  proposalRequest,
  undoRequest,
} from '../src/lib/reviewForms.ts';

const ID = '7f1c2a7e-0d5e-4b8e-9a51-1f8f3a0c9d42';
const form = (entries: Record<string, string | string[]>) =>
  fieldsOf(
    Object.entries(entries).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])) as [
      string,
      string,
    ][],
  );
const card = (verb: string, extra: Record<string, string> = {}) =>
  form({ proposalId: ID, version: '2', verb, slug: 'snappool', screen: 'proposals', ...extra });

describe('proposalRequest', () => {
  it('approves the version and action hash the screen showed', () => {
    expect(proposalRequest(card('approve', { actionHash: 'abc' }))).toEqual({
      kind: 'approve',
      proposalId: ID,
      version: 2,
      actionHash: 'abc',
    });
  });

  it('rejects with a reason, and refuses a rejection without one', () => {
    expect(proposalRequest(card('reject', { reason: ' too early ' }))).toEqual({
      kind: 'reject',
      proposalId: ID,
      version: 2,
      reason: 'too early',
    });
    expect(() => proposalRequest(card('reject', { reason: 'no' }))).toThrow(FormError);
  });

  it('edits a budget (amount → micros), the words or the match type, and approves', () => {
    expect(proposalRequest(card('edit_budget', { budget: 'S$1,250.50' }))).toEqual({
      kind: 'edit_approve',
      proposalId: ID,
      version: 2,
      edit: { field: 'budget', newDailyBudgetMicros: '1250500000' },
    });
    expect(proposalRequest(card('edit_text', { text: 'free pool party' })).kind).toBe('edit_approve');
    expect(proposalRequest(card('edit_match', { matchType: 'EXACT' }))).toMatchObject({
      edit: { field: 'match_type', matchType: 'EXACT' },
    });
    for (const budget of ['', '0', '-5', 'ten', '1.2345678']) {
      expect(() => proposalRequest(card('edit_budget', { budget })), budget).toThrow(FormError);
    }
    expect(() => proposalRequest(card('edit_match', { matchType: 'BROAD' }))).toThrow(FormError);
    expect(() => proposalRequest(card('edit_text', { text: '' }))).toThrow(FormError);
  });

  it('refuses an unknown verb, a missing id and a version that is not a number', () => {
    expect(() => proposalRequest(card('delete'))).toThrow(FormError);
    expect(() => proposalRequest(form({ verb: 'approve', version: '1', actionHash: 'h' }))).toThrow(FormError);
    expect(proposalRequest(card('approve', { actionHash: 'h', version: 'x' }))).toMatchObject({ version: -1 });
  });
});

describe('the other review forms', () => {
  it('undo names the change; a document is the next version with LF line breaks', () => {
    expect(undoRequest(form({ revisionId: 'rev_01ABC' }))).toEqual({ kind: 'undo', revisionId: 'rev_01ABC' });
    expect(
      docRequest(form({ productId: ID, doc: 'playbook', baseVersion: '3', markdown: '# Play\r\n\r\n- one  \r\n' })),
    ).toEqual({
      kind: 'product_doc_put',
      productId: ID,
      doc: 'playbook',
      baseVersion: 3,
      markdown: '# Play\n\n- one  \n',
    });
    expect(() => docRequest(form({ productId: ID, doc: 'secrets', baseVersion: '0', markdown: 'x' }))).toThrow(
      FormError,
    );
  });

  it('brief feedback sends only the answers changed on the page (F1)', () => {
    const shown = (useful: string, newInfo: string, extra: Record<string, string> = {}) =>
      form({ briefId: ID, usefulShown: useful, newInfoShown: newInfo, ...extra });
    // Both unanswered on the page; 💡 ticked → only newInfo, so a 👍 given on Telegram meanwhile stays.
    expect(briefFeedbackRequest(shown('', '', { newInfo: 'on' }))).toEqual({
      kind: 'brief_feedback',
      briefId: ID,
      newInfo: true,
    });
    // 👍 shown ticked and left ticked; 💡 shown ticked and unticked → only newInfo: false.
    expect(briefFeedbackRequest(shown('on', 'on', { useful: 'on' }))).toEqual({
      kind: 'brief_feedback',
      briefId: ID,
      newInfo: false,
    });
    // Both changed → both sent.
    expect(briefFeedbackRequest(shown('', 'on', { useful: 'on' }))).toEqual({
      kind: 'brief_feedback',
      briefId: ID,
      useful: true,
      newInfo: false,
    });
    expect(() => briefFeedbackRequest(shown('on', '', { useful: 'on' }))).toThrow(FormError); // nothing changed
    expect(() => briefFeedbackRequest(form({ briefId: 'not-an-id', useful: 'on' }))).toThrow(FormError);
  });
});

describe('error codes (F1)', () => {
  const codeOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      if (error instanceof FormError) return error.code;
      throw error;
    }
    throw new Error('no FormError');
  };

  it('each refused form goes back with a code, never the contract’s text', () => {
    expect(codeOf(() => proposalRequest(card('reject', { reason: 'no' })))).toBe('reject_reason');
    expect(codeOf(() => proposalRequest(card('edit_budget', { budget: 'ten' })))).toBe('budget');
    expect(codeOf(() => proposalRequest(card('edit_text', { text: '' })))).toBe('negative_text');
    expect(codeOf(() => proposalRequest(card('edit_match', { matchType: 'BROAD' })))).toBe('match_type');
    expect(codeOf(() => proposalRequest(card('delete')))).toBe('invalid');
    expect(codeOf(() => briefFeedbackRequest(form({ briefId: 'not-an-id', useful: 'on' })))).toBe('invalid');
    expect(codeOf(() => docRequest(form({ productId: ID, doc: 'secrets', baseVersion: '0' })))).toBe('invalid');
    expect(codeOf(() => briefFeedbackRequest(form({ briefId: ID })))).toBe('feedback_unchanged');
    for (const code of Object.keys(FORM_ERRORS)) expect(code).toMatch(/^[a-z_]+$/); // safe in a URL as is
  });

  it('a code shows our words; anything else shows the generic line', () => {
    expect(formErrorText('reject_reason')).toBe(FORM_ERRORS.reject_reason);
    for (const crafted of ['Your account is locked: call +65 0000 0000', '', 'toString', '__proto__', 'constructor']) {
      expect(formErrorText(crafted)).toBe(FORM_ERRORS.invalid);
    }
  });
});
