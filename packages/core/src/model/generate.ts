// One structured model call (BLUEPRINT §5.17): `generateText` with `Output.object`, retried once when the answer
// doesn't match the schema; traced to Langfuse with product, cycle and stage; its cost added to the cycle; personal
// data redacted from the prompt first. What comes back is only what the schema allows: the callers validate the
// meaning (targets exist, types fit) and compute every number themselves (invariant 4).
import { type DbOrTx, addModelCost } from '@ads/db';
import { propagateAttributes } from '@langfuse/tracing';
import {
  type LanguageModel,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  Output,
  type ToolSet,
  generateText,
  isStepCount,
} from 'ai';
import type { z } from 'zod';
import { type ModelSpec, type ModelStage, createLanguageModel, modelSpecFor, specText } from './models.ts';
import { type ModelPrice, costOfUsage, priceFor } from './prices.ts';
import { redactPersonalData } from './redact.ts';
import type { ModelTracing } from './tracing.ts';

export interface ModelCallContext {
  product: { id: string; slug: string };
  /** The cycle the call belongs to; its cost is added there. Null for a call outside a cycle (`ads model ping`). */
  cycleId: string | null;
  stage: ModelStage;
}

export interface ModelDeps {
  env: Readonly<Record<string, string | undefined>>;
  /** Needed to record the cost on the cycle. */
  db?: DbOrTx;
  tracing?: ModelTracing | null;
  /** Tests (and evals) supply the model and its spec instead of building one from the environment. */
  model?: { model: LanguageModel; spec: ModelSpec };
}

export interface StructuredCall<T> {
  context: ModelCallContext;
  schema: z.ZodType<T>;
  /** Static, versioned instructions (the system prompt). */
  instructions: string;
  /** The trusted context and the DATA block. */
  prompt: string;
  /** Names the call in traces (default: the stage). */
  name?: string;
  maxOutputTokens?: number;
  /** Read-only tools the model may call before it answers (the analyst's look-ups, M06b). */
  tools?: CallTools;
}

export interface CallTools {
  set: ToolSet;
  /** Model calls allowed per attempt, the structured answer included. */
  maxSteps: number;
  /** True once no more tool calls should be offered (a budget is used up): the next step must answer. */
  exhausted?: () => boolean;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResult<T> {
  output: T;
  model: string;
  /** 1, or 2 when the first answer failed the schema. */
  attempts: number;
  usage: CallUsage;
  /** USD micros, summed over the attempts. */
  costMicros: bigint;
  /** Personal-data values replaced in the instructions and prompt. */
  redactions: number;
}

/** Both attempts failed the schema. The cost was still spent, and is recorded. */
export class StructuredOutputError extends Error {
  override name = 'StructuredOutputError';
  readonly model: string;
  readonly attempts: number;
  readonly costMicros: bigint;
  constructor(model: string, attempts: number, costMicros: bigint, options: { cause: unknown }) {
    super(`${model} returned output that does not match the schema ${attempts} times`, options);
    this.model = model;
    this.attempts = attempts;
    this.costMicros = costMicros;
  }
}

/** Sent with the retry: the schema itself goes with every request, so the note only says what went wrong. */
export const SCHEMA_RETRY_NOTE =
  'Your previous answer could not be used because it did not match the required JSON schema. ' +
  'Answer again with JSON that matches the schema exactly.';

const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

const count = (n: number | undefined): number => (n === undefined || !Number.isFinite(n) ? 0 : n);

export async function generateStructured<T>(deps: ModelDeps, call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const { context } = call;
  const spec = deps.model?.spec ?? modelSpecFor(context.stage, deps.env);
  // Price first: a model without a known price is refused before anything is spent.
  const price = priceFor(spec, deps.env);
  const model = deps.model?.model ?? createLanguageModel(spec, deps.env);
  const instructions = redactPersonalData(call.instructions);
  const prompt = redactPersonalData(call.prompt);

  const usage: CallUsage = { inputTokens: 0, outputTokens: 0 };
  let costMicros = 0n;
  const spend = (u: LanguageModelUsage | undefined, p: ModelPrice): void => {
    usage.inputTokens += count(u?.inputTokens);
    usage.outputTokens += count(u?.outputTokens);
    costMicros += costOfUsage(u, p);
  };

  const attempt = (text: string) =>
    generateText({
      model,
      instructions: instructions.text,
      prompt: text,
      output: Output.object({ schema: call.schema }),
      maxOutputTokens: call.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(call.tools === undefined
        ? {}
        : {
            tools: call.tools.set,
            stopWhen: isStepCount(call.tools.maxSteps),
            // Once the budget is used up, or one step is left, the model must answer. The tools stay defined
            // (a request with tool calls in its history must carry them); `toolChoice: 'none'` stops new calls.
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              call.tools?.exhausted?.() === true || stepNumber >= (call.tools?.maxSteps ?? 1) - 1
                ? { toolChoice: 'none' as const }
                : undefined,
          }),
      // Every step is paid for as it ends, so a failure after some steps still records what they cost.
      onStepEnd: (step: { usage: LanguageModelUsage }) => spend(step.usage, price),
      telemetry:
        deps.tracing == null
          ? { isEnabled: false }
          : { functionId: call.name ?? context.stage, integrations: deps.tracing.integration },
    });

  const run = async (): Promise<StructuredResult<T>> => {
    let lastError: unknown;
    for (let n = 1; n <= 2; n += 1) {
      try {
        const result = await attempt(n === 1 ? prompt.text : `${prompt.text}\n\n${SCHEMA_RETRY_NOTE}`);
        return {
          output: result.output,
          model: specText(spec),
          attempts: n,
          usage,
          costMicros,
          redactions: instructions.redactions + prompt.redactions,
        };
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) throw error; // its steps are already paid for
        lastError = error;
      }
    }
    throw new StructuredOutputError(specText(spec), 2, costMicros, { cause: lastError });
  };

  let failed = false;
  try {
    if (deps.tracing == null) return await run();
    return await propagateAttributes(
      {
        traceName: `${context.stage}:${context.product.slug}`,
        tags: [
          `product:${context.product.slug}`,
          `stage:${context.stage}`,
          ...(context.cycleId === null ? [] : [`cycle:${context.cycleId}`]),
        ],
        ...(context.cycleId === null ? {} : { sessionId: context.cycleId }),
        metadata: {
          productId: context.product.id,
          stage: context.stage,
          model: specText(spec),
          ...(context.cycleId === null ? {} : { cycleId: context.cycleId }),
        },
      },
      run,
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // Spent is spent: the cost is recorded whether the call succeeded or not. If recording fails after a failed
    // call, the call's own error is the one the caller sees.
    if (deps.db !== undefined && context.cycleId !== null && costMicros > 0n) {
      await addModelCost(deps.db, context.cycleId, costMicros).catch((error: unknown) => {
        if (!failed) throw error;
      });
    }
  }
}
