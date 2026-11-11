import { describe, expect, it } from 'vitest';
import { count } from './plural';

describe('count', () => {
  it('says "1 host" for one and "2 hosts" for any other number', () => {
    expect(count(1, 'host')).toBe('1 host');
    expect(count(0, 'host')).toBe('0 hosts');
    expect(count(2, 'host')).toBe('2 hosts');
    expect(count(138, 'device')).toBe('138 devices');
  });

  it('takes the plural when the noun does not just add an s', () => {
    expect(count(1, 'entry', 'entries')).toBe('1 entry');
    expect(count(3, 'entry', 'entries')).toBe('3 entries');
  });
});
