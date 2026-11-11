import { describe, expect, it } from 'vitest';
import { BadRequestError, isZabbixId, optionalId, requireId } from '../core/validate.js';

/**
 * A Zabbix id is an unsigned 64-bit number, at most 18446744073709551615. A longer one is not an id,
 * and sent on anyway it comes back as a failed read, not as the 400 the caller earned (BK-37).
 */
describe('isZabbixId', () => {
  it('accepts digits up to the largest id Zabbix stores', () => {
    for (const id of ['0', '1', '10084', '000123', '99999999999', '9223372036854775807', '18446744073709551615']) {
      expect(isZabbixId(id), id).toBe(true);
    }
  });

  it('refuses a number past it, however it is padded or written', () => {
    for (const id of ['18446744073709551616', '99999999999999999999', '123456789012345678901', '0'.repeat(30) + '1', '9'.repeat(2_000)]) {
      expect(isZabbixId(id), id.slice(0, 30)).toBe(false);
    }
  });

  it('refuses what is not digits only', () => {
    for (const id of ['', ' 1', '1 ', '-1', '+1', '1.5', '1e3', '0x10', 'abc', '１２３', '12;13']) {
      expect(isZabbixId(id), JSON.stringify(id)).toBe(false);
    }
  });
});

describe('requireId and optionalId', () => {
  it('return a good id as it came', () => {
    expect(requireId('10084', 'hostid')).toBe('10084');
    expect(requireId('18446744073709551615', 'hostid')).toBe('18446744073709551615');
    expect(optionalId('7', 'hostid')).toBe('7');
  });

  it('refuse an id that is too long with the same 400 as one that is not a number, naming the field', () => {
    for (const bad of ['18446744073709551616', '99999999999999999999999', 'abc', undefined, 5]) {
      expect(() => requireId(bad, 'hostid'), String(bad)).toThrow(BadRequestError);
      expect(() => requireId(bad, 'hostid'), String(bad)).toThrow('hostid is required and must be a numeric Zabbix id.');
    }
    expect(() => optionalId('18446744073709551616', 'groupid')).toThrow(BadRequestError);
  });

  it('read absent or empty as not given', () => {
    expect(optionalId(undefined, 'hostid')).toBeUndefined();
    expect(optionalId('', 'hostid')).toBeUndefined();
  });
});
