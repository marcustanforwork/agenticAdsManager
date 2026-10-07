// A small valid pack for the pack-sdk tests. No product names (it's shared code's test).
import type { OutcomeAdapter, PackManifest, ProductPack } from '@ads/contracts';
import { z } from 'zod';

export const testFacts = z.object({
  features: z.array(z.string().min(1)).min(1),
  tier: z.enum(['free', 'pro']),
  priceMicros: z
    .string()
    .regex(/^\d{1,19}$/)
    .nullable(),
  limits: z.object({ guests: z.number().int().min(0), days: z.number().int().positive().optional() }),
  note: z.string().max(40).optional(),
});

export const testManifest = (over: Partial<PackManifest> = {}): PackManifest => ({
  id: 'saas-test',
  version: '1.0.0',
  defaults: {
    outcomes: {
      stages: [
        { id: 'lead', label: 'Lead', tier: 'soft' },
        { id: 'signup', label: 'Signup', tier: 'success' },
      ],
      primaryKpiStage: 'signup',
      feedback: [{ stage: 'signup', platform: 'meta', destinationId: null, eventName: 'CompleteRegistration' }],
    },
    copy: { tier: 'fragments', requiredStrings: [], bannedPhrases: [] },
  },
  phases: [{ id: 'launch', label: 'Launch', intent: 'Find the first users.', budgetPosture: 'conserve' }],
  facts: { schema: testFacts, requiredForCopy: ['features'] },
  thresholds: {
    zero_outcome_spend: { minImpressions: 500, minClicks: 20, minSpendMicros: '20000000', minDays: 7 },
  },
  platformPolicy: {},
  analystContext: 'Be careful.',
  ...over,
});

const adapter: OutcomeAdapter = {
  fetchSince: () => Promise.resolve([]),
  healthcheck: () => Promise.resolve({ ok: true }),
};

export const testPack = (over: Partial<PackManifest> = {}): ProductPack => ({
  manifest: testManifest(over),
  runtime: { outcomeAdapter: () => adapter, detectPhase: () => 'launch' },
});
