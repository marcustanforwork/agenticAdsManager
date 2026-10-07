// Which model each AI stage uses (BLUEPRINT §5.17): `MODEL_<STAGE>=provider:model` in the environment, so a model
// is swapped without a code change (G6). The providers are built here and nowhere else: every AI call in the system
// goes through core/model (invariant 3).
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const MODEL_STAGES = ['analyst', 'drafter', 'brief', 'copy'] as const;
export type ModelStage = (typeof MODEL_STAGES)[number];

export const MODEL_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export interface ModelSpec {
  provider: ModelProvider;
  modelId: string;
}

/** The strongest available model for every stage (D-041): analysis is the hard part, and at this volume the cost is a
 *  few dollars a month. DRAFTER and BRIEF may move to a cheaper model once replay evals show no loss (M16a). */
export const DEFAULT_MODELS: Readonly<Record<ModelStage, string>> = {
  analyst: 'anthropic:claude-fable-5-1',
  drafter: 'anthropic:claude-fable-5-1',
  brief: 'anthropic:claude-fable-5-1',
  copy: 'anthropic:claude-fable-5-1',
};

export const modelEnvName = (stage: ModelStage): string => `MODEL_${stage.toUpperCase()}`;

export class ModelConfigError extends Error {
  override name = 'ModelConfigError';
}

/** Parses `provider:model`. The model id may itself contain colons (a local model's tag, e.g. `llama3:70b`). */
export function parseModelSpec(text: string): ModelSpec {
  const at = text.indexOf(':');
  const provider = at > 0 ? text.slice(0, at).trim() : '';
  const modelId = at > 0 ? text.slice(at + 1).trim() : '';
  if (!(MODEL_PROVIDERS as readonly string[]).includes(provider) || modelId === '') {
    throw new ModelConfigError(
      `"${text}" is not a model setting: write provider:model, with provider one of ${MODEL_PROVIDERS.join(', ')}`,
    );
  }
  return { provider: provider as ModelProvider, modelId };
}

export const specText = (spec: ModelSpec): string => `${spec.provider}:${spec.modelId}`;

/** The stage's model setting: its env variable, else the default. */
export function modelSpecFor(stage: ModelStage, env: Readonly<Record<string, string | undefined>>): ModelSpec {
  const set = env[modelEnvName(stage)]?.trim();
  return parseModelSpec(set === undefined || set === '' ? DEFAULT_MODELS[stage] : set);
}

function required(env: Readonly<Record<string, string | undefined>>, name: string, spec: ModelSpec): string {
  const value = env[name]?.trim();
  if (value === undefined || value === '') throw new ModelConfigError(`${specText(spec)} needs ${name} to be set`);
  return value;
}

/** Builds the language model for a spec. Keys come from the environment (Doppler), never from the repo. A local
 *  OpenAI-compatible endpoint needs `MODEL_OPENAI_COMPATIBLE_BASE_URL` (its key, if any, in
 *  `MODEL_OPENAI_COMPATIBLE_API_KEY`). */
export function createLanguageModel(spec: ModelSpec, env: Readonly<Record<string, string | undefined>>): LanguageModel {
  switch (spec.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: required(env, 'ANTHROPIC_API_KEY', spec) })(spec.modelId);
    case 'openai':
      return createOpenAI({ apiKey: required(env, 'OPENAI_API_KEY', spec) })(spec.modelId);
    case 'openai-compatible': {
      const apiKey = env.MODEL_OPENAI_COMPATIBLE_API_KEY?.trim();
      return createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: required(env, 'MODEL_OPENAI_COMPATIBLE_BASE_URL', spec),
        ...(apiKey ? { apiKey } : {}),
        supportsStructuredOutputs: true,
      })(spec.modelId);
    }
  }
}
