import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestError } from '../core/validate.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * What a caller asks the SLA for, in a query (/api/sli, /api/sli/export) or in a body (/api/sli/email): a calendar month, or any two whole hours, and the
 * hours of the day that count. One reader of the words for all three, so a file is for the same window as the page.
 */

const reads = vi.hoisted(() => ({ month: vi.fn(), window: vi.fn() }));
vi.mock('../services/sli.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/sli.js')>()),
  getMonthlySli: reads.month,
  getWindowSli: reads.window,
}));

const { parseAsk, readReport, checkAsk, boundsOfAsk, askForLog } = await import('../services/sliAsk.js');

const NOW = new Date('2026-09-17T03:00:00Z');
const at = (iso: string) => Date.parse(iso) / 1000;
const { strict } = sampleSliReports();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  reads.month.mockReset().mockResolvedValue(strict);
  reads.window.mockReset().mockResolvedValue(strict);
});
afterEach(() => vi.useRealTimers());

describe('parseAsk', () => {
  it('takes no words as the current month, in the hours of the whole day', () => {
    expect(parseAsk({})).toEqual({ kind: 'month', month: '2026-09', hours: null });
  });

  it('takes a month, in a query or a body', () => {
    expect(parseAsk({ month: '2026-08' })).toEqual({ kind: 'month', month: '2026-08', hours: null });
    expect(() => parseAsk({ month: '2026-8' })).toThrow(BadRequestError);
  });

  it('takes two times in Unix seconds, as the text of a query or as the numbers of a body', () => {
    const want = { kind: 'window', from: 1785517200, to: 1785603600, hours: null };
    expect(parseAsk({ from: '1785517200', to: '1785603600' })).toEqual(want);
    expect(parseAsk({ from: 1785517200, to: 1785603600 })).toEqual(want);
  });

  it.each([
    ['a missing end', { from: '1785517200' }, 'to must be a time in Unix seconds.'],
    ['a missing start', { to: '1785517200' }, 'from must be a time in Unix seconds.'],
    ['a fraction', { from: 1.5, to: 2 }, 'from must be a time in Unix seconds.'],
    ['a word', { from: 'yesterday', to: '2' }, 'from must be a time in Unix seconds.'],
    ['a negative number', { from: -5, to: 2 }, 'from must be a time in Unix seconds.'],
    ['a list', { from: ['1', '2'], to: '3' }, 'from must be a time in Unix seconds.'],
  ])('refuses %s', (_why, raw, message) => {
    expect(() => parseAsk(raw)).toThrow(message);
  });

  it('refuses a month and a window together, whichever way round they are written', () => {
    expect(() => parseAsk({ month: '2026-08', from: '1', to: '2' })).toThrow('Give a month, or from and to, and not both.');
    expect(() => parseAsk({ month: '2026-08', to: '2' })).toThrow('Give a month, or from and to, and not both.');
  });

  it('reads the hours of the day by the rules the page uses, and none when they keep everything', () => {
    expect(parseAsk({ month: '2026-08', dayHours: '8-17', days: '1,2,3,4,5' }).hours).toEqual({ start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] });
    expect(parseAsk({ month: '2026-08', dayHours: '0-24', days: '1,2,3,4,5,6,7' }).hours).toBeNull();
    expect(() => parseAsk({ month: '2026-08', dayHours: '8' })).toThrow(BadRequestError);
  });
});

describe('readReport', () => {
  const signal = new AbortController().signal;

  it('reads a month with nothing else asked of it as the monthly report, with its web checks', async () => {
    await readReport(parseAsk({ month: '2026-08' }), 'availability', signal);
    expect(reads.month).toHaveBeenCalledWith('2026-08', 'availability', signal);
    expect(reads.window).not.toHaveBeenCalled();
  });

  it('reads a month in the hours of the day as a window that knows its month', async () => {
    await readReport(parseAsk({ month: '2026-08', dayHours: '8-17' }), 'hcml-report', signal);
    expect(reads.month).not.toHaveBeenCalled();
    expect(reads.window).toHaveBeenCalledWith({
      from: at('2026-08-01T00:00:00+07:00'),
      to: at('2026-09-01T00:00:00+07:00'),
      profile: 'hcml-report',
      hours: { start: 8, end: 17, weekdays: null },
      month: '2026-08',
      signal,
    });
  });

  it('reads two times as a window with no month', async () => {
    const from = at('2026-08-03T00:00:00+07:00');
    const to = at('2026-08-10T00:00:00+07:00');
    await readReport(parseAsk({ from, to, days: '1,2,3,4,5' }), 'availability', signal);
    expect(reads.window).toHaveBeenCalledWith({ from, to, profile: 'availability', hours: { start: 0, end: 24, weekdays: [1, 2, 3, 4, 5] }, signal });
  });
});

describe('checkAsk and boundsOfAsk, which the mail route runs before it reads anything or counts an allowance', () => {
  const from = at('2026-08-03T00:00:00+07:00');
  const to = at('2026-08-10T00:00:00+07:00');
  const now = Math.floor(NOW.getTime() / 1000);

  it('gives the bounds of a month and of a window', () => {
    expect(boundsOfAsk(parseAsk({ month: '2026-08' }))).toEqual({ from: at('2026-08-01T00:00:00+07:00'), to: at('2026-09-01T00:00:00+07:00') });
    expect(boundsOfAsk(parseAsk({ from, to }))).toEqual({ from, to });
  });

  it('lets a good window through and refuses the ones the read would refuse', () => {
    expect(() => checkAsk(parseAsk({ from, to }), now)).not.toThrow();
    expect(() => checkAsk(parseAsk({ from: from + 60, to }), now)).toThrow('whole hours');
    expect(() => checkAsk(parseAsk({ from: to, to: from }), now)).toThrow('from must be before to');
    expect(() => checkAsk(parseAsk({ from: at('2027-01-01T00:00:00+07:00'), to: at('2027-01-02T00:00:00+07:00') }), now)).toThrow('not started yet');
    expect(() => checkAsk(parseAsk({ from, to: from + 367 * 86400 }), now)).toThrow('at most');
    // Its own start is within the 400 days and its first month is not: the read would refuse it, so the send must not take an allowance first.
    expect(() => checkAsk(parseAsk({ from: at('2025-08-20T00:00:00+07:00'), to: at('2025-08-21T00:00:00+07:00') }), now)).toThrow('Zabbix keeps events for about a year; pick a later period.');
  });

  it('refuses a window with no hour inside the daily hours, as the read does', () => {
    // A Monday to Friday choice over a Saturday and a Sunday.
    const weekend = { from: at('2026-08-01T00:00:00+07:00'), to: at('2026-08-03T00:00:00+07:00') };
    expect(() => checkAsk(parseAsk({ ...weekend, days: '1,2,3,4,5' }), now)).toThrow('No hour of this range falls inside the daily hours you chose.');
  });

  it('refuses a month that has not started, and takes one that is running', () => {
    expect(() => checkAsk(parseAsk({ month: '2026-10' }), now)).toThrow('not started yet');
    expect(() => checkAsk(parseAsk({ month: '2026-09' }), now)).not.toThrow();
  });
});

describe('askForLog', () => {
  it('says only what was validated: the month, or the two times, and the hours when they are not the whole day', () => {
    expect(askForLog(parseAsk({ month: '2026-08' }))).toEqual({ month: '2026-08' });
    expect(askForLog(parseAsk({ month: '2026-08', dayHours: '8-17', days: '1,2,3,4,5' }))).toEqual({ month: '2026-08', dayHours: '8-17', days: '1,2,3,4,5' });
    expect(askForLog(parseAsk({ from: '1785517200', to: '1785603600' }))).toEqual({ from: 1785517200, to: 1785603600 });
    expect(askForLog(parseAsk({ from: '1785517200', to: '1785603600', days: '6,7' }))).toEqual({ from: 1785517200, to: 1785603600, days: '6,7' });
  });
});
