// The pack registry: the packs the worker was built with, by id. Core receives it from the app and never imports
// a pack itself (BLUEPRINT §2 rule 2).
import type { ProductPack } from '@ads/contracts';
import { definePack } from './definePack.ts';

export class UnknownPackError extends Error {
  readonly packId: string;
  constructor(packId: string, known: readonly string[]) {
    super(`no pack "${packId}" is installed (installed: ${known.join(', ') || 'none'})`);
    this.name = 'UnknownPackError';
    this.packId = packId;
  }
}

export interface PackRegistry {
  /** The pack, or UnknownPackError. */
  get(packId: string): ProductPack;
  has(packId: string): boolean;
  /** Every pack, by id. */
  list(): readonly ProductPack[];
}

/** A registry of the given packs, each checked by definePack. Two packs with one id are an error. */
export function createRegistry(packs: readonly ProductPack[]): PackRegistry {
  const byId = new Map<string, ProductPack>();
  for (const pack of packs) {
    const defined = definePack(pack);
    if (byId.has(defined.manifest.id)) throw new Error(`two packs have the id "${defined.manifest.id}"`);
    byId.set(defined.manifest.id, defined);
  }
  const ids = [...byId.keys()].sort();
  return {
    get(packId) {
      const pack = byId.get(packId);
      if (pack === undefined) throw new UnknownPackError(packId, ids);
      return pack;
    },
    has: (packId) => byId.has(packId),
    list: () => ids.map((id) => byId.get(id) as ProductPack),
  };
}
