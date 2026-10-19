// The fact-base editor's form (M10a), generated from the fact schema each pack publishes as JSON Schema in
// `pack_manifests` (the dashboard never imports a pack). `nodeOf` reads the schema into the few shapes a form
// needs; `factsFromForm` turns the submitted fields back into a facts object. Field names are `f:` plus the
// value's path: `f:pricing.phase`, `f:plans.0.limits.guests`; a list of objects has one extra, empty item to add
// one, and a remove box per item. Lists of text are one item per line. Money (`…Micros` text fields) is typed as an
// amount. Whether the facts are valid is decided by the schema (contracts `jsonSchemaIssues`) and the worker.
import { type Fields, checked, lines, moneyToMicros, num, str } from './forms.ts';

type Json = Record<string, unknown>;

export type FactNode = (
  | { kind: 'object'; props: { key: string; node: FactNode; required: boolean }[] }
  | { kind: 'list'; item: FactNode; maxItems: number | null }
  | { kind: 'text'; options: string[] | null; money: boolean; pattern: string | null; maxLength: number | null }
  | { kind: 'number'; integer: boolean; min: number | null; max: number | null }
  | { kind: 'boolean' }
  | { kind: 'unsupported'; schema: unknown }
) & { nullable: boolean };

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const numberOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Reads a JSON Schema node. `key` is the property name (money is spotted by its `…Micros` name). */
export function nodeOf(schema: unknown, key = ''): FactNode {
  if (!isObject(schema)) return { kind: 'unsupported', schema, nullable: false };
  const anyOf = schema['anyOf'];
  if (Array.isArray(anyOf)) {
    const rest = anyOf.filter((o) => !(isObject(o) && o['type'] === 'null'));
    if (rest.length === 1 && rest.length < anyOf.length) return { ...nodeOf(rest[0], key), nullable: true };
    return { kind: 'unsupported', schema, nullable: false };
  }
  switch (schema['type']) {
    case 'object': {
      const properties = isObject(schema['properties']) ? schema['properties'] : {};
      const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
      return {
        kind: 'object',
        props: Object.entries(properties).map(([k, s]) => ({ key: k, node: nodeOf(s, k), required: required.has(k) })),
        nullable: false,
      };
    }
    case 'array':
      return {
        kind: 'list',
        item: nodeOf(schema['items'], key),
        maxItems: numberOrNull(schema['maxItems']),
        nullable: false,
      };
    case 'string':
      return {
        kind: 'text',
        options: Array.isArray(schema['enum']) ? (schema['enum'] as string[]) : null,
        money: key.endsWith('Micros'),
        pattern: typeof schema['pattern'] === 'string' ? schema['pattern'] : null,
        maxLength: numberOrNull(schema['maxLength']),
        nullable: false,
      };
    case 'integer':
    case 'number':
      return {
        kind: 'number',
        integer: schema['type'] === 'integer',
        min: numberOrNull(schema['minimum']),
        max: numberOrNull(schema['maximum']),
        nullable: false,
      };
    case 'boolean':
      return { kind: 'boolean', nullable: false };
    default:
      return { kind: 'unsupported', schema, nullable: false };
  }
}

export const fieldName = (path: readonly string[]): string => `f:${path.join('.')}`;

/** Indices of the list items submitted under `path`. */
function itemIndices(f: Fields, path: readonly string[]): number[] {
  const prefix = `${fieldName(path)}.`;
  const found = new Set<number>();
  for (const name of f.keys()) {
    if (!name.startsWith(prefix)) continue;
    const i = /^(\d+)(\.|$)/.exec(name.slice(prefix.length))?.[1];
    if (i !== undefined) found.add(Number(i));
  }
  return [...found].sort((a, b) => a - b);
}

/** The value the fields under `path` give for `node`, or undefined when they're all left empty. */
export function valueFromForm(node: FactNode, f: Fields, path: readonly string[]): unknown {
  const name = fieldName(path);
  switch (node.kind) {
    case 'object': {
      const out: Json = {};
      for (const p of node.props) {
        const v = valueFromForm(p.node, f, [...path, p.key]);
        if (v !== undefined) out[p.key] = v;
      }
      return Object.keys(out).length === 0 ? undefined : fillRequired(node, out);
    }
    case 'list': {
      if (node.item.kind !== 'object' && node.item.kind !== 'list') {
        if (!f.has(name)) return undefined;
        const items = lines(str(f, name)).map((l) => (node.item.kind === 'number' ? num(l) : l));
        return items.length === 0 ? undefined : items;
      }
      const items = itemIndices(f, path)
        .filter((i) => !checked(f, `${name}.${i}.__remove`))
        .map((i) => valueFromForm(node.item, f, [...path, String(i)]))
        .filter((v) => v !== undefined);
      return items.length === 0 ? undefined : items;
    }
    case 'text': {
      const text = str(f, name);
      if (text === '') return node.nullable && f.has(name) ? null : undefined;
      return node.money ? moneyToMicros(text) : text;
    }
    case 'number': {
      const text = str(f, name);
      if (text === '') return node.nullable && f.has(name) ? null : undefined;
      return num(text);
    }
    case 'boolean':
      return checked(f, name) ? true : undefined;
    case 'unsupported': {
      // Edited as JSON text; text that isn't JSON is sent as typed, for the schema to refuse.
      const text = str(f, name);
      if (text === '') return undefined;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
  }
}

/** A required list or object left empty is sent empty ([] or {}), so an object whose parts are all optional is
 *  valid without them, and the schema names a required list that needs items. */
function fillRequired(node: Extract<FactNode, { kind: 'object' }>, out: Json): Json {
  for (const p of node.props) {
    if (!p.required || p.key in out) continue;
    if (p.node.kind === 'list') out[p.key] = [];
    else if (p.node.kind === 'object') out[p.key] = fillRequired(p.node, {});
  }
  return out;
}

/** The facts object the editor's fields give; empty optional parts are left out, as if never set. */
export function factsFromForm(root: FactNode, f: Fields): Json {
  const value = valueFromForm(root, f, []);
  const facts = isObject(value) ? value : {};
  return root.kind === 'object' ? fillRequired(root, facts) : facts;
}
