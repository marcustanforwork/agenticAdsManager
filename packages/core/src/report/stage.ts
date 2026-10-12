// The `reported` stage (BLUEPRINT §5.14, M07; D-081): a daily cycle builds the digest and, when the send rule says
// so, queues it; a weekly or manual cycle writes the brief to `briefs` and queues it; a failed trust check gives
// the diagnostic brief instead (template only). The worker's bot sends what is queued. Idempotent: a resumed stage
// finds the cycle's digest or brief already queued and does nothing more.
import {
  type Db,
  type Product,
  enqueueNotification,
  findCycleBrief,
  findCycleNotification,
  getCycle,
  insertBrief,
} from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { type ModelDeps, generateStructured } from '../model/generate.ts';
import type { ModelTracing } from '../model/tracing.ts';
import {
  BRIEF_INSTRUCTIONS,
  BRIEF_INSTRUCTIONS_VERSION,
  type BriefNumbers,
  BriefProse,
  briefPrompt,
  buildBriefNumbers,
  renderBrief,
  renderDiagnosticBrief,
  templateProse,
} from './brief.ts';
import { buildDigest, renderDigest, shouldSendDigest } from './digest.ts';
import { allowedValues, checkNumbers } from './numberCheck.ts';

export interface ReportDeps {
  db: Db;
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  packs?: PackRegistry;
  tracing?: ModelTracing | null;
  model?: ModelDeps['model'];
}

export interface ReportSummary {
  kind: 'digest' | 'weekly' | 'diagnostic';
  /** queued: in the outbox for the bot; not_sent: the send rule said no; already_done: a rerun found it queued. */
  status: 'queued' | 'not_sent' | 'already_done';
  detail?: string;
  briefId?: string;
  /** The brief's prose: `model`, or `template` (the number check failed, or the model call did). */
  writer?: 'model' | 'template';
  /** Numbers in the model's prose that matched nothing in the table (the reason for the fallback). */
  unmatched?: string[];
  costMicros?: string;
}

export const DIGEST_NOTIFICATION = 'digest';
export const BRIEF_NOTIFICATION = 'brief';

export async function reportStage(deps: ReportDeps, product: Product, cycleId: string): Promise<ReportSummary> {
  const cycle = await getCycle(deps.db, cycleId);
  if (cycle.kind === 'daily') return digest(deps, product, cycle);
  return brief(deps, product, cycle);
}

async function digest(
  deps: ReportDeps,
  product: Product,
  cycle: { id: string; trustResult: string | null },
): Promise<ReportSummary> {
  if ((await findCycleNotification(deps.db, { kind: DIGEST_NOTIFICATION, cycleId: cycle.id })) !== null) {
    return { kind: 'digest', status: 'already_done' };
  }
  const data = await buildDigest(deps.db, { product, now: deps.now(), cycle });
  const setting = product.settings.notifications.digest;
  if (!shouldSendDigest(setting, data)) {
    return {
      kind: 'digest',
      status: 'not_sent',
      detail: setting === 'off' ? 'notifications.digest is off' : 'no spend yesterday (notifications.digest is auto)',
    };
  }
  await enqueueNotification(deps.db, {
    productId: product.id,
    kind: DIGEST_NOTIFICATION,
    payload: { cycleId: cycle.id, day: data.day, text: renderDigest(data) },
  });
  return { kind: 'digest', status: 'queued' };
}

interface Prose {
  prose: BriefProse;
  writer: 'model' | 'template';
  detail?: string;
  unmatched?: string[];
  model?: string;
  costMicros?: bigint;
}

/** The AI's prose if every number in it is in the table; otherwise (or if the call fails) the template's. */
async function writeProse(deps: ReportDeps, product: Product, cycleId: string, numbers: BriefNumbers): Promise<Prose> {
  const pack = deps.packs?.has(product.packId) === true ? deps.packs.get(product.packId) : null;
  let answer;
  try {
    answer = await generateStructured(
      {
        env: deps.env,
        db: deps.db,
        ...(deps.tracing === undefined ? {} : { tracing: deps.tracing }),
        ...(deps.model === undefined ? {} : { model: deps.model }),
      },
      {
        context: { product: { id: product.id, slug: product.slug }, cycleId, stage: 'brief' },
        schema: BriefProse,
        name: 'brief',
        instructions: BRIEF_INSTRUCTIONS,
        prompt: briefPrompt(numbers, { analystContext: pack?.manifest.analystContext ?? null }),
        maxOutputTokens: 4_000,
      },
    );
  } catch (error) {
    return {
      prose: templateProse(numbers),
      writer: 'template',
      detail: `the model call failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    };
  }
  const allowed = allowedValues(numbers);
  const unmatched = [answer.output.headline, ...answer.output.paragraphs].flatMap(
    (text) => checkNumbers(text, allowed).unmatched,
  );
  if (unmatched.length > 0) {
    return {
      prose: templateProse(numbers),
      writer: 'template',
      detail: 'a number in the model’s text is not in the numbers table',
      unmatched,
      model: answer.model,
      costMicros: answer.costMicros,
    };
  }
  return { prose: answer.output, writer: 'model', model: answer.model, costMicros: answer.costMicros };
}

async function brief(
  deps: ReportDeps,
  product: Product,
  cycle: { id: string; trustResult: string | null },
): Promise<ReportSummary> {
  const existing = await findCycleBrief(deps.db, cycle.id);
  if (existing !== null) {
    // Interrupted between the brief and its notification is impossible (one transaction), but a brief written by
    // an older run without one is queued now rather than lost.
    if ((await findCycleNotification(deps.db, { kind: BRIEF_NOTIFICATION, cycleId: cycle.id })) === null) {
      await enqueueNotification(deps.db, {
        productId: product.id,
        kind: BRIEF_NOTIFICATION,
        payload: { cycleId: cycle.id, briefId: existing.id },
      });
    }
    return { kind: existing.kind, status: 'already_done', briefId: existing.id };
  }
  const numbers = await buildBriefNumbers(deps.db, { product, cycleId: cycle.id, now: deps.now() });
  const diagnostic = cycle.trustResult === 'fail';
  const written = diagnostic ? null : await writeProse(deps, product, cycle.id, numbers);
  const markdown = written === null ? renderDiagnosticBrief(numbers) : renderBrief(numbers, written.prose);
  const kind = diagnostic ? 'diagnostic' : 'weekly';
  const row = await deps.db.transaction(async (tx) => {
    const inserted = await insertBrief(tx, {
      productId: product.id,
      cycleId: cycle.id,
      kind,
      numbers: {
        ...numbers,
        writer:
          written === null
            ? { source: 'template', reason: 'diagnostic' }
            : {
                source: written.writer,
                instructions: BRIEF_INSTRUCTIONS_VERSION,
                ...(written.model === undefined ? {} : { model: written.model }),
                ...(written.detail === undefined ? {} : { reason: written.detail }),
                ...(written.unmatched === undefined ? {} : { unmatched: written.unmatched }),
              },
      },
      markdown,
      usedTemplateFallback: written?.writer === 'template',
    });
    await enqueueNotification(tx, {
      productId: product.id,
      kind: BRIEF_NOTIFICATION,
      payload: { cycleId: cycle.id, briefId: inserted.id },
    });
    return inserted;
  });
  return {
    kind,
    status: 'queued',
    briefId: row.id,
    ...(written === null ? {} : { writer: written.writer }),
    ...(written?.detail === undefined ? {} : { detail: written.detail }),
    ...(written?.unmatched === undefined ? {} : { unmatched: written.unmatched }),
    ...(written?.costMicros === undefined ? {} : { costMicros: written.costMicros.toString() }),
  };
}
