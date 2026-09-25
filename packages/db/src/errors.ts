/** Errors the repositories throw on purpose. Callers may match on `name`. */

/** A write based on an old version (settings `baseVersion`, product docs, proposal versions). */
export class StaleVersionError extends Error {
  readonly expected: number;
  readonly actual: number | null;
  constructor(what: string, expected: number, actual: number | null) {
    super(`${what}: stale version ${expected}, current is ${actual ?? 'missing'}`);
    this.name = 'StaleVersionError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** A proposal status change that the §3.9 transition table doesn't allow. */
export class IllegalTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  constructor(proposalId: string, from: string, to: string) {
    super(`proposal ${proposalId}: illegal transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** A second scheduled cycle for the same product, kind and date. */
export class DuplicateCycleError extends Error {
  constructor(productId: string, kind: string, cycleDate: string) {
    super(`a ${kind} cycle for product ${productId} on ${cycleDate} already exists`);
    this.name = 'DuplicateCycleError';
  }
}

/** A request that is well-formed but not allowed in the current state (e.g. deciding a stale version). */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

/** Postgres unique_violation, optionally on a named constraint or index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = findPgError(error);
  return e !== null && e.code === '23505' && (constraint === undefined || e.constraint === constraint);
}

function findPgError(error: unknown): { code?: string; constraint?: string } | null {
  for (let e: unknown = error, depth = 0; e !== null && typeof e === 'object' && depth < 5; depth++) {
    const candidate = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return candidate as { code?: string; constraint?: string };
    e = candidate.cause;
  }
  return null;
}
