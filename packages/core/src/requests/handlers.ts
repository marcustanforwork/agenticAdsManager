// One handler per operator-request kind. Each runs inside the processor's transaction (a savepoint), and
// throws RefusedError / StaleVersionError / NotFoundError / a settings error to refuse.
// To add a kind: write its handler here, add it to HANDLERS, remove it from NOT_AVAILABLE_UNTIL, and test it
// in test/requests.test.ts (the milestone file's "Leave behind" has the checklist).
import type { OperatorRequest } from '@ads/contracts';
import {
  StaleVersionError,
  getProduct,
  schema,
  setBriefFeedback,
  updateSettings,
  type OperatorRequestRow,
  type ProductStatus,
  type Tx,
} from '@ads/db';
import { and, eq } from 'drizzle-orm';
import { applySettingsPatch } from './settingsPatch.ts';

const { products } = schema;

type Kind = OperatorRequest['kind'];
type RequestOf<K extends Kind> = Extract<OperatorRequest, { kind: K }>;
export type RequestHandler<R extends OperatorRequest> = (
  tx: Tx,
  request: R,
  row: OperatorRequestRow,
) => Promise<Record<string, unknown>>;

/** Which milestone adds the kinds this processor doesn't handle yet. */
export const NOT_AVAILABLE_UNTIL: Partial<Record<Kind, string>> = {
  approve: 'M09a',
  reject: 'M09a',
  edit_approve: 'M09a',
  pause: 'M09b',
  pause_all: 'M09b',
  undo: 'M09b',
  budget: 'M14',
  facts_put: 'M05a',
  product_doc_put: 'M05b',
  resolve_attention: 'M11b',
};

/** Moves products from one status to another: one product, or every product (productId null). Products in
 *  any other status are left alone (a dormant product stays dormant). */
async function moveStatus(tx: Tx, productId: string | null, from: ProductStatus, to: ProductStatus) {
  if (productId !== null) await getProduct(tx, productId); // unknown product → refused
  const changed = await tx
    .update(products)
    .set({ status: to })
    .where(and(eq(products.status, from), productId === null ? undefined : eq(products.id, productId)))
    .returning({ slug: products.slug });
  return changed.map((p) => p.slug).sort();
}

const halt: RequestHandler<RequestOf<'halt'>> = async (tx, request) => {
  // Halt stops the agent only: cycles and agent proposals wait. Marcus's own pauses still run (§6 step 3).
  const halted = await moveStatus(tx, request.productId, 'active', 'halted');
  return { halted };
};

const resumeAgent: RequestHandler<RequestOf<'resume_agent'>> = async (tx, request) => {
  const resumed = await moveStatus(tx, request.productId, 'halted', 'active');
  return { resumed };
};

const settingsPatch: RequestHandler<RequestOf<'settings_patch'>> = async (tx, request, row) => {
  const product = await getProduct(tx, request.productId);
  // Checked here as well as in updateSettings, so a stale base is refused before the patch is judged.
  if (product.settingsVersion !== request.baseVersion) {
    throw new StaleVersionError('settings', request.baseVersion, product.settingsVersion);
  }
  const settings = applySettingsPatch(product.settings, request.patch);
  const version = await updateSettings(tx, {
    productId: request.productId,
    baseVersion: request.baseVersion,
    settings,
    requestId: row.id,
  });
  return { version };
};

const briefFeedback: RequestHandler<RequestOf<'brief_feedback'>> = async (tx, request) => {
  await setBriefFeedback(tx, request);
  return { briefId: request.briefId, useful: request.useful, newInfo: request.newInfo };
};

export const HANDLERS: { [K in Kind]?: RequestHandler<RequestOf<K>> } = {
  halt,
  resume_agent: resumeAgent,
  settings_patch: settingsPatch,
  brief_feedback: briefFeedback,
};
