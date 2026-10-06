import { describe, expect, it } from 'vitest';
import { GAQL_ALLOWLIST, type GaqlLiteral, gaql, lit } from '../src/index.ts';

describe('gaql', () => {
  it('builds SELECT … FROM … WHERE … from allowlisted fields and checked literals', () => {
    const q = gaql({
      from: 'campaign',
      select: ['campaign.id', 'segments.date', 'metrics.clicks'],
      where: [
        { field: 'segments.date', op: 'BETWEEN', from: lit.date('2026-09-01'), to: lit.date('2026-09-28') },
        { field: 'campaign.status', op: 'IN', values: [lit.enum('ENABLED'), lit.enum('PAUSED')] },
        { field: 'campaign.id', op: '=', value: lit.id('123') },
      ],
      limit: 10,
    });
    expect(q.text).toBe(
      "SELECT campaign.id, segments.date, metrics.clicks FROM campaign WHERE segments.date BETWEEN '2026-09-01' AND '2026-09-28' AND campaign.status IN ('ENABLED', 'PAUSED') AND campaign.id = 123 LIMIT 10",
    );
  });

  it('refuses resources and fields outside the allowlist, even past the types', () => {
    const anyGaql = gaql as (spec: unknown) => unknown;
    expect(() => anyGaql({ from: 'user_list', select: ['user_list.id'] })).toThrow(/resource not allowed/);
    expect(() => anyGaql({ from: 'campaign', select: ['campaign.id, customer.id'] })).toThrow(/field not allowed/);
    expect(() => anyGaql({ from: 'campaign', select: ['change_event.user_email'] })).toThrow(/field not allowed/);
    expect(() =>
      anyGaql({
        from: 'campaign',
        select: ['campaign.id'],
        where: [{ field: '1=1 OR campaign.id', op: '=', value: lit.id('1') }],
      }),
    ).toThrow(/filter not allowed/);
    expect(() => anyGaql({ from: 'campaign', select: [] })).toThrow(/at least one field/);
    expect(() =>
      anyGaql({
        from: 'campaign',
        select: ['campaign.id'],
        where: [{ field: 'campaign.id', op: 'LIKE', value: lit.id('1') }],
      }),
    ).toThrow(/operator not allowed/);
  });

  it('literals reject anything that could break out of them', () => {
    for (const bad of ["1' OR '1'='1", '12 OR 1=1', '-1', '1.5', '']) expect(() => lit.id(bad)).toThrow();
    for (const bad of ["ENABLED' OR 'x", 'enabled', 'A B']) expect(() => lit.enum(bad)).toThrow();
    for (const bad of ['2026-02-30', "2026-09-01' OR '", '2026-9-1']) expect(() => lit.date(bad)).toThrow();
    for (const bad of ["customers/1'/x", 'customers/1/conversionActions/2 OR 1', 'campaigns/1']) {
      expect(() => lit.resource(bad)).toThrow();
    }
    expect(() => lit.int(-1)).toThrow();
    expect(lit.resource('customers/123/conversionActions/456').text).toBe("'customers/123/conversionActions/456'");
  });

  it('refuses hand-made literals', () => {
    const forged = { text: "'x' OR campaign.id > 0" } as GaqlLiteral;
    expect(() =>
      gaql({ from: 'campaign', select: ['campaign.id'], where: [{ field: 'campaign.id', op: '=', value: forged }] }),
    ).toThrow(/must come from lit/);
  });

  it('the allowlist has no personal-data resources', () => {
    const resources = Object.keys(GAQL_ALLOWLIST);
    expect(resources).not.toContain('user_list');
    expect(resources).not.toContain('change_event');
    expect(resources).not.toContain('customer_user_access');
  });
});
