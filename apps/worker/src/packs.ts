// The packs this worker is built with (BLUEPRINT §2: only the apps import packs; core gets this registry). Each is
// checked by definePack when the registry is made.
import { createRegistry, type PackRegistry } from '@ads/pack-sdk';
import propertySg from '@ads/pack-property-sg';
import snappool from '@ads/pack-saas-snappool';

export const INSTALLED_PACKS: PackRegistry = createRegistry([snappool, propertySg]);
