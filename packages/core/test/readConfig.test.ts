// The read configs with feedback routes whose destination isn't set up yet (D-076).
import type { ProductSettings } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import { googleReadConfig, metaReadConfig } from '../src/index.ts';

const settings = (feedback: ProductSettings['outcomes']['feedback']) =>
  ({
    outcomes: {
      stages: [
        { id: 'lead', label: 'Lead', tier: 'soft' },
        { id: 'signup', label: 'Signup', tier: 'success' },
      ],
      primaryKpiStage: 'signup',
      feedback,
    },
  }) as ProductSettings;

describe('read configs with routes not set up yet', () => {
  it('Meta counts the route event without a dataset to watch', () => {
    const config = metaReadConfig(
      settings([
        { stage: 'lead', platform: 'meta', destinationId: null, eventName: 'Lead' },
        { stage: 'signup', platform: 'meta', destinationId: null, eventName: 'CompleteRegistration' },
      ]),
    );
    expect(config.conversionActionTypes).toEqual(['offsite_conversion.fb_pixel_complete_registration']);
    expect(config.datasetId).toBeUndefined();
    expect(config.warnings).toEqual([]);
  });

  it('Google warns that the conversion action id is missing and counts nothing', () => {
    const config = googleReadConfig(settings([{ stage: 'signup', platform: 'google', destinationId: null }]));
    expect(config.conversionActionIds).toEqual([]);
    expect(config.warnings).toEqual([
      'the Google route for "signup" has no conversion action id yet: platform conversions read as 0',
    ]);
  });
});
