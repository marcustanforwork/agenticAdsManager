// What a model call cost, in USD micros (cycles.model_cost_micros; the providers bill in US dollars). Prices are per
// million tokens, from the providers' list prices (GOTCHAS, "Claude models and prices"). A model without a known
// price is refused when it is chosen, so a cycle's cost is never silently short. Prices change: MODEL_PRICES
// overrides or adds entries without a code change.
import { decimalToMicros } from '@ads/contracts';
import type { LanguageModelUsage } from 'ai';
import { z } from 'zod';
import { ModelConfigError, type ModelSpec, specText } from './models.ts';

/** USD micros per million tokens. A price of $10 per million tokens is 10_000_000n. */
export interface ModelPrice {
  input: bigint;
  output: bigint;
  cacheRead: bigint;
  cacheWrite: bigint;
}

const usd = (dollars: string): bigint => decimalToMicros(dollars);

/** Cache writes cost 1.25 × input (5-minute cache), cache reads as listed. Checked 2026-10-07. */
const anthropic = (input: string, output: string, cacheRead: string): ModelPrice => ({
  input: usd(input),
  output: usd(output),
  cacheRead: usd(cacheRead),
  cacheWrite: (usd(input) * 5n) / 4n,
});

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'anthropic:claude-fable-5-1': anthropic('10', '50', '0.25'),
  'anthropic:claude-opus-5-5': anthropic('4', '20', '0.20'),
  'anthropic:claude-sonnet-5-5': anthropic('2', '10', '0.20'),
  'anthropic:claude-haiku-4-5': anthropic('1', '5', '0.10'),
};

const Dollars = z.string().regex(/^\d{1,6}(\.\d{1,6})?$/, 'US dollars per million tokens, e.g. "2.5"');
const PriceOverride = z.strictObject({
  input: Dollars,
  output: Dollars,
  cacheRead: Dollars.optional(),
  cacheWrite: Dollars.optional(),
});
const PriceOverrides = z.record(z.string(), PriceOverride);

/** The price of a model: MODEL_PRICES from the environment (JSON: `{"provider:model": {"input": "2.5", "output":
 *  "10"}}`, US dollars per million tokens), then the table above. A local model (`openai-compatible`) is free unless
 *  priced. Anything else unpriced is a configuration error. */
export function priceFor(spec: ModelSpec, env: Readonly<Record<string, string | undefined>>): ModelPrice {
  const key = specText(spec);
  const raw = env.MODEL_PRICES?.trim();
  if (raw !== undefined && raw !== '') {
    let parsed: z.infer<typeof PriceOverrides>;
    try {
      parsed = PriceOverrides.parse(JSON.parse(raw));
    } catch (error) {
      throw new ModelConfigError(`MODEL_PRICES is not valid: ${(error as Error).message}`);
    }
    const o = parsed[key];
    if (o !== undefined) {
      const input = usd(o.input);
      return {
        input,
        output: usd(o.output),
        cacheRead: o.cacheRead === undefined ? input : usd(o.cacheRead),
        cacheWrite: o.cacheWrite === undefined ? input : usd(o.cacheWrite),
      };
    }
  }
  const listed = MODEL_PRICES[key];
  if (listed !== undefined) return listed;
  if (spec.provider === 'openai-compatible') return { input: 0n, output: 0n, cacheRead: 0n, cacheWrite: 0n };
  throw new ModelConfigError(`${key} has no known price: add it to MODEL_PRICES (US dollars per million tokens)`);
}

const tokens = (n: number | undefined): bigint =>
  n === undefined || !Number.isFinite(n) || n < 0 ? 0n : BigInt(Math.trunc(n));

/** The cost of one call's usage in USD micros, rounded up to the micro. Cached input is priced as such when the
 *  provider reports it; reasoning tokens are part of the output tokens. */
export function costOfUsage(usage: LanguageModelUsage | undefined, price: ModelPrice): bigint {
  if (usage === undefined) return 0n;
  const details = usage.inputTokenDetails;
  const cacheRead = tokens(details?.cacheReadTokens);
  const cacheWrite = tokens(details?.cacheWriteTokens);
  const noCache =
    details?.noCacheTokens !== undefined
      ? tokens(details.noCacheTokens)
      : tokens(usage.inputTokens) - cacheRead - cacheWrite;
  const total =
    (noCache > 0n ? noCache : 0n) * price.input +
    cacheRead * price.cacheRead +
    cacheWrite * price.cacheWrite +
    tokens(usage.outputTokens) * price.output;
  return (total + 999_999n) / 1_000_000n;
}
