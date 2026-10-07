// Attribution (BLUEPRINT §5.12, M05b): platform ids, gclid lookup, utm, none; in that order; recent `none`
// outcomes retried.
import type { OutcomeEvent } from '@ads/contracts';
import {
  type AdEntity,
  createProduct,
  insertOutcomes,
  listOutcomes,
  upsertAdEntity,
  upsertGoogleClicks,
} from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTRIBUTION_RETRY_DAYS, attributeOutcomes, attributionFor, attributionIndex } from '../src/index.ts';
import { type World, makeWorld } from './support/world.ts';

const NOW = new Date('2026-10-07T04:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

// A database per test: the world's accounts have fixed ids.
let t: TestDatabase;
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => t.drop());

interface Entities {
  googleCampaign: AdEntity;
  googleAdGroup: AdEntity;
  metaCampaign: AdEntity;
  metaAdSet: AdEntity;
  metaAd: AdEntity;
  /** Two Meta campaigns share this name. */
  twinA: AdEntity;
  twinB: AdEntity;
}

async function world(): Promise<{ w: World; e: Entities }> {
  const w = await makeWorld(t.db, { slug: 'attr', now: NOW });
  const entity = (
    account: 'google' | 'meta',
    type: 'campaign' | 'ad_group' | 'ad',
    externalId: string,
    name: string,
    parentId: string | null = null,
  ) =>
    upsertAdEntity(t.db, {
      productId: w.productId,
      accountId: account === 'google' ? w.googleAccountId : w.metaAccountId,
      platform: account,
      type,
      externalId,
      parentId,
      name,
      status: 'active',
      rawStatus: account === 'google' ? 'ENABLED' : 'ACTIVE',
    });
  const googleCampaign = await entity('google', 'campaign', '21987654321', 'Search - Brand');
  const googleAdGroup = await entity('google', 'ad_group', '16543210987', 'Brand terms', googleCampaign.id);
  const metaCampaign = await entity('meta', 'campaign', '120210000000000001', 'Signups - Weddings');
  const metaAdSet = await entity('meta', 'ad_group', '120210000000000002', 'Weddings SG', metaCampaign.id);
  const metaAd = await entity('meta', 'ad', '120210000000000003', 'Video 1', metaAdSet.id);
  const twinA = await entity('meta', 'campaign', '120210000000000010', 'Retargeting');
  const twinB = await entity('meta', 'campaign', '120210000000000011', 'Retargeting');
  await upsertGoogleClicks(t.db, [
    { productId: w.productId, gclid: 'gclid-recent', date: '2026-10-01', campaignExternalId: '21987654321' },
    { productId: w.productId, gclid: 'gclid-old', date: '2026-06-01', campaignExternalId: '21987654321' },
    { productId: w.productId, gclid: 'gclid-unknown-campaign', date: '2026-10-01', campaignExternalId: '999' },
  ]);
  return { w, e: { googleCampaign, googleAdGroup, metaCampaign, metaAdSet, metaAd, twinA, twinB } };
}

const outcome = (sourceId: string, ids: OutcomeEvent['ids'], occurredAt = ago(1), isTest = false): OutcomeEvent => ({
  sourceId,
  stage: 'signup',
  occurredAt,
  isTest,
  ids,
});

/** The attribution stored for each source id. */
async function stored(productId: string): Promise<Record<string, [string | null, string | null]>> {
  const rows = await listOutcomes(t.db, { productId, from: new Date(0), to: NOW, includeTest: true });
  return Object.fromEntries(rows.map((r) => [r.sourceId, [r.attributionMethod, r.attributedEntityId]]));
}

describe('attribution', () => {
  it('tries platform ids, then the gclid, then utm_campaign; otherwise none, kept and reported', async () => {
    const { w, e } = await world();
    await insertOutcomes(t.db, w.productId, [
      outcome('google-campaign-id', { googleCampaignId: '21987654321', gclid: 'gclid-unknown-campaign' }),
      outcome('google-ad-group-only', { googleAdGroupId: '16543210987' }),
      outcome('meta-campaign-id', { metaCampaignId: '120210000000000001', fbclid: 'f1' }),
      outcome('meta-ad-set-only', { metaAdSetId: '120210000000000002' }),
      outcome('meta-ad-only', { metaAdId: '120210000000000003' }),
      // An unknown campaign id falls through to the next method.
      outcome('unknown-id-then-gclid', { googleCampaignId: '1', gclid: 'gclid-recent' }),
      outcome('gclid', { gclid: 'gclid-recent' }),
      outcome('gclid-older-than-90-days', { gclid: 'gclid-old' }),
      outcome('gclid-not-synced', { gclid: 'gclid-tomorrow' }),
      outcome('utm-name', { utmSource: 'meta', utmCampaign: 'Signups - Weddings' }),
      outcome('utm-id', { utmCampaign: '21987654321' }),
      outcome('utm-wrong-platform', { utmSource: 'google', utmCampaign: 'Signups - Weddings' }),
      outcome('utm-ambiguous-name', { utmCampaign: 'Retargeting' }),
      outcome('organic', {}),
      outcome('test-traffic', { googleCampaignId: '21987654321' }, ago(1), true),
    ]);

    expect(await attributeOutcomes(t.db, { productId: w.productId, now: NOW })).toEqual({
      checked: 15,
      attributed: { platform_ids: 6, gclid_lookup: 2, utm: 2 },
      none: 5,
    });
    expect(await stored(w.productId)).toEqual({
      'google-campaign-id': ['platform_ids', e.googleCampaign.id],
      'google-ad-group-only': ['platform_ids', e.googleCampaign.id],
      'meta-campaign-id': ['platform_ids', e.metaCampaign.id],
      'meta-ad-set-only': ['platform_ids', e.metaCampaign.id],
      'meta-ad-only': ['platform_ids', e.metaCampaign.id],
      'unknown-id-then-gclid': ['gclid_lookup', e.googleCampaign.id],
      gclid: ['gclid_lookup', e.googleCampaign.id],
      'gclid-older-than-90-days': ['none', null],
      'gclid-not-synced': ['none', null],
      'utm-name': ['utm', e.metaCampaign.id],
      'utm-id': ['utm', e.googleCampaign.id],
      'utm-wrong-platform': ['none', null],
      'utm-ambiguous-name': ['none', null],
      organic: ['none', null],
      'test-traffic': ['platform_ids', e.googleCampaign.id],
    });
  });

  it('retries recent unattributable outcomes once their click arrives; older ones and attributed ones stay', async () => {
    const { w, e } = await world();
    await insertOutcomes(t.db, w.productId, [
      outcome('today', { gclid: 'gclid-late' }, ago(0.1)),
      outcome('long-ago', { gclid: 'gclid-late-old' }, ago(ATTRIBUTION_RETRY_DAYS + 1)),
      outcome('attributed', { metaCampaignId: '120210000000000001' }),
    ]);
    expect(await attributeOutcomes(t.db, { productId: w.productId, now: NOW })).toMatchObject({ checked: 3, none: 2 });
    // The next day's click sync brings both clicks; a rerun finds only the recent one again.
    await upsertGoogleClicks(t.db, [
      { productId: w.productId, gclid: 'gclid-late', date: '2026-10-07', campaignExternalId: '21987654321' },
      { productId: w.productId, gclid: 'gclid-late-old', date: '2026-09-29', campaignExternalId: '21987654321' },
    ]);
    expect(await attributeOutcomes(t.db, { productId: w.productId, now: NOW })).toEqual({
      checked: 1,
      attributed: { platform_ids: 0, gclid_lookup: 1, utm: 0 },
      none: 0,
    });
    expect(await stored(w.productId)).toEqual({
      today: ['gclid_lookup', e.googleCampaign.id],
      'long-ago': ['none', null],
      attributed: ['platform_ids', e.metaCampaign.id],
    });
    expect(await attributeOutcomes(t.db, { productId: w.productId, now: NOW })).toMatchObject({ checked: 0 });
  });

  it('never matches another product’s campaigns or clicks', async () => {
    const { w } = await world();
    const other = await createProduct(t.db, {
      slug: 'other',
      name: 'Other',
      packId: 'test-pack',
      settings: TEST_SETTINGS,
    });
    await upsertGoogleClicks(t.db, [
      { productId: other.id, gclid: 'gclid-elsewhere', date: '2026-10-01', campaignExternalId: '21987654321' },
    ]);
    await insertOutcomes(t.db, w.productId, [outcome('elsewhere', { gclid: 'gclid-elsewhere' })]);
    const index = await attributionIndex(t.db, w.productId, [{ ids: { gclid: 'gclid-elsewhere' } }]);
    expect(index.clicks.size).toBe(0);
    for (const entity of index.entities.values()) expect(entity.productId).toBe(w.productId);
    expect(attributionFor({ ids: { gclid: 'gclid-elsewhere' }, occurredAt: NOW }, index)).toEqual({
      method: 'none',
      entityId: null,
    });
    expect(await attributionIndex(t.db, other.id, [])).toMatchObject({ entities: new Map(), byId: new Map() });
  });
});
