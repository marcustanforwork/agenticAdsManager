// Checking a value against a pack's published fact schema (M10a). The worker publishes each pack's fact schema as
// JSON Schema (`pack_manifests`), so the dashboard can build and check the fact editor without importing a pack.
// The worker's own check (core `validateFacts`, against the pack's zod schema) stays the one that decides; this
// one lets the editor refuse bad facts before they're recorded, and agrees with it (apps/worker's facts test).
import { z } from 'zod';

type Schema = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Keys in `value` that the schema doesn't define, by path (the worker refuses them as "not a fact"). Objects inside
 *  lists are compared item by item. */
function unknownKeys(schema: unknown, value: unknown, path: string[]): string[] {
  if (!isObject(schema)) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => unknownKeys(schema['items'], item, [...path, String(i)]));
  }
  for (const option of (schema['anyOf'] as unknown[] | undefined) ?? []) {
    if (isObject(option) && option['type'] === 'object') return unknownKeys(option, value, path);
  }
  if (!isObject(value) || !isObject(schema['properties'])) return [];
  const properties = schema['properties'];
  return Object.entries(value).flatMap(([key, v]) =>
    key in properties ? unknownKeys(properties[key], v, [...path, key]) : [[...path, key].join('.')],
  );
}

/** Every problem with `value` under the JSON Schema `schema`, as "path: message"; empty when it's valid. */
export function jsonSchemaIssues(schema: Schema, value: unknown): string[] {
  let parsed: z.ZodType;
  try {
    parsed = z.fromJSONSchema(schema);
  } catch (error) {
    return [`(schema): can't be read (${(error as Error).message})`];
  }
  const result = parsed.safeParse(value);
  const issues = result.success
    ? []
    : result.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
  return [...issues, ...unknownKeys(schema, value, []).map((p) => `${p}: not a fact`)];
}
