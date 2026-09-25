import { describe, expect, it } from 'vitest';
import { addDecimals } from '../src/repos/batch.ts';

describe('addDecimals', () => {
  it('adds Postgres numeric strings exactly', () => {
    expect(addDecimals('0.1', '0.2')).toBe('0.3');
    expect(addDecimals('1.25', '0.5')).toBe('1.75');
    expect(addDecimals('2', '3')).toBe('5');
    expect(addDecimals('-1.5', '0.25')).toBe('-1.25');
    expect(addDecimals('0.001', '-0.001')).toBe('0.000');
    expect(addDecimals(null, '4.5')).toBe('4.5');
    expect(addDecimals(undefined, undefined)).toBe('0');
    expect(() => addDecimals('1e3', '1')).toThrow(RangeError);
  });
});
