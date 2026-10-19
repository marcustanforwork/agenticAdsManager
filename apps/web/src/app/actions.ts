'use server';
// The dashboard's only writes: each form records one operator request (channel `web`, actor `web:<verified email>`)
// and goes to the request's page, which waits for the worker's verdict. Nothing here changes settings, facts or a
// product itself; the worker validates and acts (BLUEPRINT §5.4).
import { type OperatorRequest, jsonSchemaIssues } from '@ads/contracts';
import { getLatestPackManifest, recordWebRequest } from '@ads/db';
import { redirect } from 'next/navigation';
import { factsFromForm, nodeOf } from '../lib/factsForm.ts';
import { fieldsOf, str, versionOf } from '../lib/forms.ts';
import { db, requireOperator } from '../lib/server.ts';
import { FormError, briefFeedbackRequest, docRequest, proposalRequest, undoRequest } from '../lib/reviewForms.ts';
import { isSection, patchFromForm } from '../lib/settingsForm.ts';
import { getProductView } from '../lib/views.ts';

async function record(request: OperatorRequest): Promise<never> {
  const operator = await requireOperator();
  const id = await recordWebRequest(db(), { request, email: operator.email });
  redirect(`/requests/${id}`);
}

/** One settings screen → a settings_patch based on the version the screen showed. */
export async function submitSettings(form: FormData): Promise<void> {
  await requireOperator();
  const f = fieldsOf(form.entries());
  const section = str(f, 'section');
  if (!isSection(section)) throw new Error(`not a settings section: ${section}`);
  await record({
    kind: 'settings_patch',
    productId: str(f, 'productId'),
    baseVersion: versionOf(str(f, 'baseVersion')),
    patch: patchFromForm(section, f),
  });
}

/** Product status: halt and resume keep their own requests (a halt still lets Marcus's pauses run). */
export async function submitStatus(form: FormData): Promise<void> {
  await requireOperator();
  const f = fieldsOf(form.entries());
  const productId = str(f, 'productId');
  const to = str(f, 'to');
  if (to === 'halted') await record({ kind: 'halt', productId });
  if (to === 'resume') await record({ kind: 'resume_agent', productId });
  if (to === 'active' || to === 'dormant') await record({ kind: 'set_product_status', productId, status: to });
  throw new Error(`not a product status: ${to}`);
}

export interface FactsState {
  issues: string[];
  /** What was submitted, so the editor shows it again after a refusal (React resets a form after its action). */
  submitted?: { facts: Record<string, unknown> | null; json: string | null };
  /** Counts refusals, so the editor's fields are rebuilt from `submitted` each time. */
  attempt: number;
}

/** The fact editor: the facts are checked against the pack's published schema first, and refused here with the
 *  schema's reasons; only facts it accepts are recorded (the worker checks them again against the pack). */
export async function saveFacts(prev: FactsState, form: FormData): Promise<FactsState> {
  await requireOperator();
  const f = fieldsOf(form.entries());
  const json = str(f, 'mode') === 'json' ? str(f, 'json') : null;
  const refuse = (issues: string[], facts: Record<string, unknown> | null): FactsState => ({
    issues,
    submitted: { facts, json },
    attempt: prev.attempt + 1,
  });
  const product = await getProductView(str(f, 'slug'));
  if (product === null) return refuse(['unknown product'], null);
  const manifest = await getLatestPackManifest(db(), product.packId);
  const jsonSchema = (manifest?.manifest['facts'] as { jsonSchema?: Record<string, unknown> } | undefined)?.jsonSchema;
  if (jsonSchema === undefined) return refuse([`the ${product.packId} pack has not published its fact schema`], null);

  let facts: Record<string, unknown>;
  if (json !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      return refuse([`(root): not JSON (${(error as Error).message})`], null);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return refuse(['(root): the facts must be a JSON object'], null);
    }
    facts = parsed as Record<string, unknown>;
  } else {
    facts = factsFromForm(nodeOf(jsonSchema), f);
  }
  const issues = jsonSchemaIssues(jsonSchema, facts);
  if (issues.length > 0) return refuse(issues, facts);
  return record({ kind: 'facts_put', productId: product.id, offeringKey: str(f, 'offeringKey'), facts });
}

// ── The review screens (M10b) ─────────────────────────────────────────────────────────────────

const SCREENS = ['proposals', 'changes', 'briefs', 'docs'] as const;

/** Records the request a review form asks for. A form the contract rejects goes back to its screen with the reason
 *  (the screen is named by the form; the product's slug is checked to exist, so the redirect stays on this site). */
async function recordReview(
  form: FormData,
  build: (f: ReturnType<typeof fieldsOf>) => OperatorRequest,
): Promise<never> {
  await requireOperator();
  const f = fieldsOf(form.entries());
  let request: OperatorRequest;
  try {
    request = build(f);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    const product = await getProductView(str(f, 'slug'));
    const screen = SCREENS.find((s) => s === str(f, 'screen'));
    if (product === null || screen === undefined) throw error;
    redirect(`/products/${product.slug}/${screen}?error=${encodeURIComponent(error.message)}`);
  }
  return record(request);
}

/** A proposal: approve, reject with a reason, or edit and approve. */
export async function decideProposal(form: FormData): Promise<void> {
  await recordReview(form, proposalRequest);
}

/** "Request undo" on a change in the change log. */
export async function requestUndo(form: FormData): Promise<void> {
  await recordReview(form, undoRequest);
}

/** A brief's feedback buttons. */
export async function sendBriefFeedback(form: FormData): Promise<void> {
  await recordReview(form, briefFeedbackRequest);
}

/** STRATEGY, PLAYBOOK or LEARNINGS: the next version of the document. */
export async function saveDoc(form: FormData): Promise<void> {
  await recordReview(form, docRequest);
}
