'use server';
// The dashboard's only writes: each form records one operator request (channel `web`, actor `web:<verified email>`)
// and goes to the request's page, which waits for the worker's verdict. Nothing here changes settings, facts or a
// product itself; the worker validates and acts (BLUEPRINT §5.4).
import { type OperatorRequest, jsonSchemaIssues } from '@ads/contracts';
import { getLatestPackManifest, recordWebRequest } from '@ads/db';
import { redirect } from 'next/navigation';
import { factsFromForm, nodeOf } from '../lib/factsForm.ts';
import { fieldsOf, str } from '../lib/forms.ts';
import { db, requireOperator } from '../lib/server.ts';
import { isSection, patchFromForm } from '../lib/settingsForm.ts';
import { getProductView } from '../lib/views.ts';

async function record(request: OperatorRequest): Promise<never> {
  const operator = await requireOperator();
  const id = await recordWebRequest(db(), { request, email: operator.email });
  redirect(`/requests/${id}`);
}

const versionOf = (text: string): number => (/^\d{1,9}$/.test(text) ? Number(text) : -1);

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
}

/** The fact editor: the facts are checked against the pack's published schema first, and refused here with the
 *  schema's reasons; only facts it accepts are recorded (the worker checks them again against the pack). */
export async function saveFacts(_prev: FactsState, form: FormData): Promise<FactsState> {
  await requireOperator();
  const f = fieldsOf(form.entries());
  const product = await getProductView(str(f, 'slug'));
  if (product === null) return { issues: ['unknown product'] };
  const manifest = await getLatestPackManifest(db(), product.packId);
  const jsonSchema = (manifest?.manifest['facts'] as { jsonSchema?: Record<string, unknown> } | undefined)?.jsonSchema;
  if (jsonSchema === undefined) return { issues: [`the ${product.packId} pack has not published its fact schema`] };

  let facts: Record<string, unknown>;
  if (str(f, 'mode') === 'json') {
    try {
      const parsed: unknown = JSON.parse(str(f, 'json'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { issues: ['(root): the facts must be a JSON object'] };
      }
      facts = parsed as Record<string, unknown>;
    } catch (error) {
      return { issues: [`(root): not JSON (${(error as Error).message})`] };
    }
  } else {
    facts = factsFromForm(nodeOf(jsonSchema), f);
  }
  const issues = jsonSchemaIssues(jsonSchema, facts);
  if (issues.length > 0) return { issues };
  return record({ kind: 'facts_put', productId: product.id, offeringKey: str(f, 'offeringKey'), facts });
}
