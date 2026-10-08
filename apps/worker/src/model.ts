// `ads model ping`: one small structured call through core/model, traced to Langfuse like any other call, to check
// the model key, the Langfuse keys and the price setting (M06a's live step "Langfuse receives a test trace").
// It prints the model, the tokens and the cost; never a key.
import {
  MODEL_STAGES,
  type ModelDeps,
  type ModelStage,
  type ModelTracingOptions,
  createModelTracing,
  generateStructured,
  modelSpecFor,
  specText,
} from '@ads/core';
import { type Db, NotFoundError, findProductBySlug } from '@ads/db';
import { Command, Option } from 'commander';
import { z } from 'zod';

export interface ModelCliDeps {
  env: Readonly<Record<string, string | undefined>>;
  print: (line: string) => void;
  /** Tests supply the model and a trace exporter instead of real providers. */
  model?: ModelDeps['model'];
  traceExporter?: ModelTracingOptions['exporter'];
}

const Pong = z.object({ ok: z.boolean(), word: z.string().max(20) });

export interface PingReport {
  product: string;
  stage: ModelStage;
  model: string;
  attempts: number;
  usage: { inputTokens: number; outputTokens: number };
  /** US dollars, in micros (a decimal string). */
  costMicros: string;
  /** Whether Langfuse keys were set, so a trace was sent. */
  traced: boolean;
}

export function modelCommand(
  withDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>,
  requireProduct: () => string,
  deps: ModelCliDeps,
): Command {
  const model = new Command('model').description('the AI models the agent uses (MODEL_<STAGE>=provider:model)');

  model
    .command('ping')
    .description(
      "send one small traced call to the stage's model and print its tokens and cost (USD micros). Needs the " +
        "model's key (e.g. ANTHROPIC_API_KEY); traced to Langfuse when LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY " +
        'are set',
    )
    .addOption(new Option('--stage <stage>', "which stage's model").choices([...MODEL_STAGES]).default('analyst'))
    .action(async (opts: { stage: ModelStage }) => {
      const slug = requireProduct();
      const tracing = createModelTracing(
        deps.env,
        deps.traceExporter === undefined ? {} : { exporter: deps.traceExporter },
      );
      try {
        await withDb(async (db) => {
          const product = await findProductBySlug(db, slug);
          if (!product) throw new NotFoundError('product', slug);
          const result = await generateStructured(
            { env: deps.env, db, tracing, ...(deps.model === undefined ? {} : { model: deps.model }) },
            {
              context: { product: { id: product.id, slug }, cycleId: null, stage: opts.stage },
              schema: Pong,
              name: 'ping',
              instructions: 'You are checking that a connection works. Answer in the JSON format requested.',
              prompt: 'Set ok to true and word to "pong".',
              maxOutputTokens: 2_000,
            },
          );
          const report: PingReport = {
            product: slug,
            stage: opts.stage,
            model: deps.model === undefined ? specText(modelSpecFor(opts.stage, deps.env)) : result.model,
            attempts: result.attempts,
            usage: result.usage,
            costMicros: result.costMicros.toString(),
            traced: tracing !== null,
          };
          deps.print(JSON.stringify(report, null, 2));
        });
      } finally {
        // A CLI exits right after: send the buffered spans first.
        await tracing?.shutdown();
      }
    });

  return model;
}
