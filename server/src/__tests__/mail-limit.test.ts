import { describe, expect, it } from 'vitest';
import { HourLimit, MinuteLimit } from '../clients/limits.js';
import { SENDS_PER_HOUR, limitMessage } from '../security/mailLimit.js';

/**
 * How often one person may send the report by email. A fixed hour for each person, counted in memory, so a
 * restart gives everyone a fresh allowance, as with the AI limits.
 */

describe('HourLimit', () => {
  it('lets a caller through up to the allowance and then says how long to wait', () => {
    let now = 1_000_000;
    const limit = new HourLimit(3, () => now);
    expect(limit.take('user:ana')).toBeNull();
    expect(limit.take('user:ana')).toBeNull();
    now += 10 * 60_000;
    expect(limit.take('user:ana')).toBeNull();
    expect(limit.take('user:ana')).toBe(50 * 60);
  });

  it('keeps each caller apart', () => {
    const limit = new HourLimit(1, () => 0);
    expect(limit.take('user:ana')).toBeNull();
    expect(limit.take('user:budi')).toBeNull();
    expect(limit.take('user:ana')).toBe(3600);
  });

  it('starts again an hour after the first send', () => {
    let now = 0;
    const limit = new HourLimit(1, () => now);
    expect(limit.take('user:ana')).toBeNull();
    now = 3_599_000;
    expect(limit.take('user:ana')).toBe(1);
    now = 3_600_000;
    expect(limit.take('user:ana')).toBeNull();
  });

  it('leaves the minute limit a minute', () => {
    let now = 0;
    const limit = new MinuteLimit(1, () => now);
    expect(limit.take('user:ana')).toBeNull();
    expect(limit.take('user:ana')).toBe(60);
    now = 60_000;
    expect(limit.take('user:ana')).toBeNull();
  });
});

describe('the allowance', () => {
  it('is a handful an hour: a report goes out about once a month', () => {
    expect(SENDS_PER_HOUR).toBe(5);
  });
});

describe('the sentence a person reads when the allowance is used (BK-47)', () => {
  it.each([
    [0, 'about 1 minute.'],
    [1, 'about 1 minute.'],
    [60, 'about 1 minute.'],
    [61, 'about 2 minutes.'],
    [3599, 'about 60 minutes.'],
    [3600, 'about 60 minutes.'],
  ])('says %i seconds as %s', (wait, words) => {
    expect(limitMessage(wait)).toContain(words);
  });

  it('names the allowance', () => {
    expect(limitMessage(120)).toContain(`${SENDS_PER_HOUR} report emails an hour`);
  });
});
