// @ads/pack-property-sg: the Property SG product pack, checked by definePack when it's loaded.
import { definePack } from '@ads/pack-sdk';
import { manifest } from './manifest.ts';
import { runtime } from './runtime.ts';

export { LAUNCH_PHASES, PropertyFacts, manifest, type LaunchPhase } from './manifest.ts';
export {
  AIRTABLE_API,
  AIRTABLE_BASE_ENV,
  AIRTABLE_TABLE_ENV,
  AIRTABLE_TOKEN_ENV,
  AirtableSourceError,
  LEAD_FIELDS,
  airtableAdapter,
  idsFromFields,
  isTestEmail,
  sinceFormula,
  type AirtableAdapterOptions,
} from './airtable.ts';
export { singaporeDayStart } from './days.ts';
export { detectPhase } from './runtime.ts';

export const pack = definePack({ manifest, runtime });
export default pack;
