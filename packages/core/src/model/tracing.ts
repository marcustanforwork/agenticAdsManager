// Tracing to Langfuse (BLUEPRINT §5.17, D-078). AI SDK 7 reports each call to a telemetry integration; Langfuse's
// integration turns the events into OpenTelemetry spans, and its span processor exports them. Nothing here is
// registered globally except the async context manager, so each process (or test) builds its own tracer: the
// worker one at startup, a test one with an in-memory exporter. No Langfuse keys = no tracing; the calls still run.
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { Telemetry } from 'ai';
import { redactPersonalData } from './redact.ts';

export interface ModelTracing {
  /** Passed to each AI SDK call (`telemetry.integrations`). */
  readonly integration: Telemetry;
  /** Sends what is buffered. A short-lived process (a CLI) calls it before exiting. */
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

let contextManagerSet = false;

/** Trace attributes (product, cycle, stage) travel in the async context, so the spans the integration creates inside
 *  a call carry them. That needs an async context manager, set once per process. */
function ensureContextManager(): void {
  if (contextManagerSet) return;
  // If something else already set one, it works for this purpose too (setGlobalContextManager then returns false).
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  contextManagerSet = true;
}

/** The second guard against personal data (the first is the prompt redaction): every string in an exported span. */
export function maskPersonalData(data: unknown): unknown {
  if (typeof data === 'string') return redactPersonalData(data).text;
  if (Array.isArray(data)) return data.map(maskPersonalData);
  if (data !== null && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, maskPersonalData(v)]));
  }
  return data;
}

const set = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v === undefined || v === '' ? undefined : v;
};

export interface ModelTracingOptions {
  /** Where spans go instead of Langfuse's endpoint (tests). */
  exporter?: SpanExporter;
}

/** Tracing from `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and optionally `LANGFUSE_BASE_URL` (default
 *  https://cloud.langfuse.com) and `LANGFUSE_TRACING_ENVIRONMENT`; null without keys. Tests pass an `exporter`. */
export function createModelTracing(
  env: Readonly<Record<string, string | undefined>>,
  opts: ModelTracingOptions = {},
): ModelTracing | null {
  const publicKey = set(env.LANGFUSE_PUBLIC_KEY);
  const secretKey = set(env.LANGFUSE_SECRET_KEY);
  if (publicKey === undefined || secretKey === undefined) return null;
  ensureContextManager();
  const baseUrl = set(env.LANGFUSE_BASE_URL);
  const environment = set(env.LANGFUSE_TRACING_ENVIRONMENT);
  const processor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(environment === undefined ? {} : { environment }),
    ...(opts.exporter === undefined ? {} : { exporter: opts.exporter }),
    mask: ({ data }) => maskPersonalData(data),
  });
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  return {
    integration: new LangfuseVercelAiSdkIntegration({ tracer: provider.getTracer('ai') }),
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
