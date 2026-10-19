// What changed between two settings versions, for the history screen: one line per changed setting. Lists are
// compared whole (a patch replaces them whole).
export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function changedPaths(before: unknown, after: unknown, path: string[] = []): Change[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => changedPaths(before[k], after[k], [...path, k]));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: path.join('.') || '(all)', before, after }];
}
