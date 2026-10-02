import { describe, expect, it } from 'vitest';
import { META_STATUS_TABLE, actionTypesForEvents, normaliseMetaStatus, parseMetaReadCredential } from '../src/index.ts';

describe('status normalisation (BLUEPRINT §5.7)', () => {
  it('matches the table', () => {
    expect(
      Object.entries(META_STATUS_TABLE)
        .map(([k, v]) => `${k}=${v}`)
        .sort(),
    ).toEqual(
      [
        'ACTIVE=active',
        'PAUSED=paused',
        'CAMPAIGN_PAUSED=paused',
        'ADSET_PAUSED=paused',
        'DELETED=removed',
        'ARCHIVED=removed',
        'IN_PROCESS=pending',
        'PENDING_REVIEW=pending',
        'PREAPPROVED=pending',
        'PENDING_BILLING_INFO=pending',
        'WITH_ISSUES=limited',
        'DISAPPROVED=limited',
      ].sort(),
    );
  });

  it('maps anything else, including prototype keys, to unknown', () => {
    for (const s of ['SOMETHING_NEW', 'active', '', 'constructor', '__proto__', 'toString'])
      expect(normaliseMetaStatus(s)).toBe('unknown');
  });
});

describe('actionTypesForEvents', () => {
  it('maps standard events and refuses unknown ones', () => {
    expect(actionTypesForEvents(['Lead', 'CompleteRegistration', 'Lead'])).toEqual([
      'offsite_conversion.fb_pixel_complete_registration',
      'offsite_conversion.fb_pixel_lead',
    ]);
    expect(() => actionTypesForEvents(['HostSignup'])).toThrow(/no confirmed insights action type/);
    expect(() => actionTypesForEvents(['constructor'])).toThrow();
  });
});

describe('parseMetaReadCredential', () => {
  it('accepts the documented shape and names only the bad fields', () => {
    const ok = { accessToken: `EAA${'y'.repeat(40)}`, appSecret: 's'.repeat(32) };
    expect(parseMetaReadCredential(ok)).toEqual(ok);
    const err = (() => {
      try {
        parseMetaReadCredential({ accessToken: 'short-secret-value' });
      } catch (e) {
        return String(e);
      }
      return '';
    })();
    expect(err).toMatch(/accessToken, appSecret/);
    expect(err).not.toContain('short-secret-value');
  });
});
