// @ads/pack-saas-snappool: the SnapPool product pack, checked by definePack when it's loaded.
import { definePack } from '@ads/pack-sdk';
import { manifest } from './manifest.ts';
import { runtime } from './runtime.ts';

export { SnapPoolFacts, PRICING_PHASES, manifest } from './manifest.ts';
export { DATABASE_URL_ENV, idsFromAttribution, isTestEmail, snapPoolAdapter, webFrom } from './adapter.ts';
export { BETA_ENDS_AT, detectPhase } from './runtime.ts';

export const pack = definePack({ manifest, runtime });
export default pack;
