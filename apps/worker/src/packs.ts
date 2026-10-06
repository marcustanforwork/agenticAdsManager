// The packs this worker is built with (BLUEPRINT §2: only the apps import packs; core gets this registry). Each is
// checked by definePack when the registry is made. M05b adds the property pack.
import { createRegistry, type PackRegistry } from '@ads/pack-sdk';
import snappool from '@ads/pack-saas-snappool';

export const INSTALLED_PACKS: PackRegistry = createRegistry([snappool]);
