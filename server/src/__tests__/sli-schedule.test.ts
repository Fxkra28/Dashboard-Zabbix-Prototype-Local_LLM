import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_SECONDS,
  RETRY_AFTER_SECONDS,
  SETTLE_SECONDS,
  latestSlot,
  nextSlot,
  planNext,
  retryDelay,
  skippedSlots,
  slotFor,
} from '../sli/schedule.js';
import { zonedTime } from '../sli/time.js';
import type { Schedule, SendRecord } from '../core/state.js';

/**
 * When the monthly report is due, and what to do about it now. Pure: the clock is handed in. The report for a month is
 * sent on day D of the month after it, at a time of day, and again and again for a week if something stops it.
 */

const JKT = 'Asia/Jakarta';
const at = (iso: string) => Date.parse(iso) / 1000;

const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  enabled: true,
  day: 1,
  time: '00:00',
  formats: ['pdf'],
  style: { decimal: 'dot', date: 'long', separator: 'comma' },
  notify: [],
  enabledAt: at('2026-10-20T00:00:00+07:00'),
  setBy: 'ana',
  setAt: at('2026-10-20T00:00:00+07:00'),
  ...over,
});
const record = (over: Partial<SendRecord> = {}): SendRecord => ({
  month: '2026-10',
  trigger: 'schedule',
  by: 'schedule',
  at: at('2026-11-01T00:10:00+07:00'),
  outcome: 'sent',
  attempts: 1,
  formats: ['pdf'],
  recipients: 2,
  refused: 0,
  bytes: 100,
  ...over,
});

describe('zonedTime', () => {
  it('is the instant a wall clock reads in a zone', () => {
    expect(zonedTime(2026, 11, 1, 0, 0, JKT)).toBe(at('2026-11-01T00:00:00+07:00'));
    expect(zonedTime(2026, 11, 1, 8, 30, JKT)).toBe(at('2026-11-01T08:30:00+07:00'));
    expect(zonedTime(2026, 11, 1, 23, 59, 'UTC')).toBe(at('2026-11-01T23:59:00Z'));
  });

  it('follows daylight saving time in a zone that has it', () => {
    expect(zonedTime(2026, 7, 1, 0, 0, 'Europe/London')).toBe(at('2026-06-30T23:00:00Z'));
    expect(zonedTime(2026, 12, 1, 0, 0, 'Europe/London')).toBe(at('2026-12-01T00:00:00Z'));
  });
});

describe('slotFor: the moment the report of a month is due', () => {
  it('is the chosen day and time of the month after it', () => {
    expect(slotFor('2026-10', 1, '00:00', JKT)).toBe(at('2026-11-01T00:00:00+07:00'));
    expect(slotFor('2026-10', 15, '08:30', JKT)).toBe(at('2026-11-15T08:30:00+07:00'));
    expect(slotFor('2026-02', 28, '23:59', JKT)).toBe(at('2026-03-28T23:59:00+07:00'));
  });

  it('rolls into the next year after December', () => {
    expect(slotFor('2026-12', 1, '00:00', JKT)).toBe(at('2027-01-01T00:00:00+07:00'));
    expect(slotFor('2026-12', 15, '08:30', JKT)).toBe(at('2027-01-15T08:30:00+07:00'));
  });

  it('reads the clock of the report’s zone, in summer and in winter', () => {
    expect(slotFor('2026-09', 1, '00:00', 'Europe/London')).toBe(at('2026-09-30T23:00:00Z'));
    expect(slotFor('2026-10', 1, '00:00', 'Europe/London')).toBe(at('2026-11-01T00:00:00Z'));
  });
});

describe('latestSlot: the newest slot that has come', () => {
  it('is last month’s report once its day has come', () => {
    expect(latestSlot(at('2026-11-04T12:00:00+07:00'), 1, '00:00', JKT)).toEqual({ month: '2026-10', slot: at('2026-11-01T00:00:00+07:00') });
  });

  it('includes the very second of the slot, and not the one before', () => {
    expect(latestSlot(at('2026-11-01T00:00:00+07:00'), 1, '00:00', JKT).month).toBe('2026-10');
    expect(latestSlot(at('2026-10-31T23:59:59+07:00'), 1, '00:00', JKT)).toEqual({ month: '2026-09', slot: at('2026-10-01T00:00:00+07:00') });
  });

  it('is the month before, until the day chosen has come', () => {
    expect(latestSlot(at('2026-11-04T12:00:00+07:00'), 15, '08:30', JKT)).toEqual({ month: '2026-09', slot: at('2026-10-15T08:30:00+07:00') });
    expect(latestSlot(at('2026-11-15T08:29:59+07:00'), 15, '08:30', JKT).month).toBe('2026-09');
    expect(latestSlot(at('2026-11-15T08:30:00+07:00'), 15, '08:30', JKT).month).toBe('2026-10');
  });

  it('crosses the new year', () => {
    expect(latestSlot(at('2027-01-03T10:00:00+07:00'), 1, '00:00', JKT)).toEqual({ month: '2026-12', slot: at('2027-01-01T00:00:00+07:00') });
    expect(latestSlot(at('2026-12-20T10:00:00+07:00'), 25, '09:00', JKT).month).toBe('2026-10');
  });

  it('keeps the day by the report’s zone, not by UTC', () => {
    // 17:30 UTC on 31 October is already 1 November in Jakarta.
    expect(latestSlot(at('2026-10-31T17:30:00Z'), 1, '00:00', JKT).month).toBe('2026-10');
    expect(latestSlot(at('2026-10-31T16:30:00Z'), 1, '00:00', JKT).month).toBe('2026-09');
  });
});

describe('nextSlot: the first slot still to come', () => {
  it('is the current month’s report, on the day after this month ends', () => {
    expect(nextSlot(at('2026-11-04T12:00:00+07:00'), 1, '00:00', JKT)).toEqual({ month: '2026-11', slot: at('2026-12-01T00:00:00+07:00') });
  });

  it('is last month’s report when its day has not come yet', () => {
    expect(nextSlot(at('2026-11-04T12:00:00+07:00'), 15, '08:30', JKT)).toEqual({ month: '2026-10', slot: at('2026-11-15T08:30:00+07:00') });
  });

  it('does not include the slot that is this very second: that one has come', () => {
    expect(nextSlot(at('2026-11-01T00:00:00+07:00'), 1, '00:00', JKT).month).toBe('2026-11');
    expect(nextSlot(at('2026-10-31T23:59:59+07:00'), 1, '00:00', JKT).month).toBe('2026-10');
  });

  it('passes over a month that is already done, and takes the next', () => {
    const done = new Set(['2026-10']);
    expect(nextSlot(at('2026-11-02T12:00:00+07:00'), 3, '08:30', JKT, done)).toEqual({ month: '2026-11', slot: at('2026-12-03T08:30:00+07:00') });
  });

  it('passes over every month that is done, not only the first', () => {
    const done = new Set(['2026-10', '2026-11']);
    expect(nextSlot(at('2026-11-02T12:00:00+07:00'), 3, '08:30', JKT, done).month).toBe('2026-12');
  });

  it('takes a month that is not in the set, even when a later one is', () => {
    expect(nextSlot(at('2026-11-02T12:00:00+07:00'), 3, '08:30', JKT, new Set(['2026-11'])).month).toBe('2026-10');
  });

  it('is always after the latest, by about a month', () => {
    for (const now of ['2026-01-01T00:00:00+07:00', '2026-06-17T13:00:00+07:00', '2026-12-31T23:59:59+07:00']) {
      for (const day of [1, 14, 28]) {
        const a = latestSlot(at(now), day, '00:00', JKT).slot;
        const b = nextSlot(at(now), day, '00:00', JKT).slot;
        expect(b).toBeGreaterThan(at(now));
        expect(a).toBeLessThanOrEqual(at(now));
        expect(b - a).toBeGreaterThanOrEqual(28 * 86400);
        expect(b - a).toBeLessThanOrEqual(31 * 86400);
      }
    }
  });
});

describe('the retry delays', () => {
  it('are 15 minutes after the first failure, an hour after the second, and four hours after that', () => {
    expect(RETRY_AFTER_SECONDS).toEqual([900, 3600, 14400]);
    expect([1, 2, 3, 4, 10].map(retryDelay)).toEqual([900, 3600, 14400, 14400, 14400]);
    // Never asked for in practice, but a zero must not index before the list.
    expect(retryDelay(0)).toBe(900);
  });

  it('wait ten minutes after the slot for Zabbix to hold the last values, and give up a week after it', () => {
    expect(SETTLE_SECONDS).toBe(600);
    expect(CATCH_UP_SECONDS).toBe(7 * 86400);
  });
});

describe('planNext: what to do now', () => {
  const plan = (now: string, over: Partial<Schedule> = {}, sends: SendRecord[] = [], s: Schedule | null = schedule(over)) =>
    planNext(at(now), s, sends, JKT);

  it('does nothing when there is no schedule, or it is off', () => {
    expect(plan('2026-11-04T12:00:00+07:00', {}, [], null)).toEqual({ kind: 'off' });
    expect(plan('2026-11-04T12:00:00+07:00', { enabled: false })).toEqual({ kind: 'off' });
  });

  it('waits for Zabbix to settle after the slot, then says the time it will send', () => {
    expect(plan('2026-11-01T00:05:00+07:00')).toEqual({
      kind: 'wait',
      month: '2026-10',
      slot: at('2026-11-01T00:00:00+07:00'),
      at: at('2026-11-01T00:10:00+07:00'),
    });
  });

  it('sends when the wait is over, to the second', () => {
    expect(plan('2026-11-01T00:09:59+07:00').kind).toBe('wait');
    expect(plan('2026-11-01T00:10:00+07:00')).toEqual({ kind: 'send', month: '2026-10', slot: at('2026-11-01T00:00:00+07:00'), attempt: 1 });
  });

  it('keeps sending a late month, up to a week after its slot', () => {
    expect(plan('2026-11-04T12:00:00+07:00').kind).toBe('send');
    expect(plan('2026-11-08T00:00:00+07:00').kind).toBe('send');
    expect(plan('2026-11-08T00:00:01+07:00')).toMatchObject({ kind: 'expired', attempted: false, month: '2026-10' });
  });

  it('does not send a slot that came before the schedule was turned on', () => {
    expect(plan('2026-11-04T12:00:00+07:00', { enabledAt: at('2026-11-03T00:00:00+07:00') })).toEqual({
      kind: 'wait',
      month: '2026-11',
      slot: at('2026-12-01T00:00:00+07:00'),
      at: at('2026-12-01T00:10:00+07:00'),
    });
  });

  it('sends a slot that came at the very second the schedule was turned on', () => {
    expect(plan('2026-11-01T00:10:00+07:00', { enabledAt: at('2026-11-01T00:00:00+07:00') }).kind).toBe('send');
    expect(plan('2026-11-01T00:10:00+07:00', { enabledAt: at('2026-11-01T00:00:01+07:00') }).kind).toBe('wait');
  });

  it('waits for the next slot once the month is sent, and says which', () => {
    expect(plan('2026-11-04T12:00:00+07:00', {}, [record()])).toEqual({
      kind: 'wait',
      month: '2026-11',
      slot: at('2026-12-01T00:00:00+07:00'),
      at: at('2026-12-01T00:10:00+07:00'),
    });
  });

  it.each(['sent', 'failed', 'missed'] as const)('treats a month with a %s record as done', (outcome) => {
    expect(plan('2026-11-04T12:00:00+07:00', {}, [record({ outcome })]).kind).toBe('wait');
  });

  it('does not promise a month that has gone when the day is moved later: the next send is the month after', () => {
    // October went on 1 November. On the 2nd the day is changed from 1 to 3.
    expect(plan('2026-11-02T12:00:00+07:00', { day: 3, enabledAt: at('2026-11-02T11:59:00+07:00') }, [record()])).toEqual({
      kind: 'wait',
      month: '2026-11',
      slot: at('2026-12-03T00:00:00+07:00'),
      at: at('2026-12-03T00:10:00+07:00'),
    });
  });

  it('does not pass over a month that is still being tried when the day is moved later', () => {
    const trying = record({ outcome: 'sending', nextAt: at('2026-11-02T12:15:00+07:00') });
    expect(plan('2026-11-02T12:00:00+07:00', { day: 3, enabledAt: at('2026-11-02T11:59:00+07:00') }, [trying])).toMatchObject({ kind: 'wait', month: '2026-10' });
  });

  it('does not pass over a month that was only sent by hand: the schedule has not sent it', () => {
    const byHand = record({ trigger: 'manual', by: 'ana' });
    expect(plan('2026-11-02T12:00:00+07:00', { day: 3, enabledAt: at('2026-11-02T11:59:00+07:00') }, [byHand])).toMatchObject({ kind: 'wait', month: '2026-10' });
  });

  it('still promises the month that has not gone when the day is moved later', () => {
    expect(plan('2026-11-02T12:00:00+07:00', { day: 3, enabledAt: at('2026-11-02T11:59:00+07:00') }, [])).toMatchObject({ kind: 'wait', month: '2026-10', slot: at('2026-11-03T00:00:00+07:00') });
  });

  it('counts only the schedule’s own record: a report sent by hand does not stand in for it', () => {
    expect(plan('2026-11-04T12:00:00+07:00', {}, [record({ trigger: 'manual', by: 'ana' })]).kind).toBe('send');
  });

  it('counts only the month asked about: an older record is no help', () => {
    expect(plan('2026-11-04T12:00:00+07:00', {}, [record({ month: '2026-09' })]).kind).toBe('send');
  });

  describe('a send that is under way', () => {
    const trying = (over: Partial<SendRecord> = {}) => record({ outcome: 'sending', attempts: 2, nextAt: at('2026-11-01T01:25:00+07:00'), ...over });

    it('waits until the time set for the next try', () => {
      expect(plan('2026-11-01T01:00:00+07:00', {}, [trying()])).toEqual({
        kind: 'backoff',
        month: '2026-10',
        slot: at('2026-11-01T00:00:00+07:00'),
        at: at('2026-11-01T01:25:00+07:00'),
      });
    });

    it('tries again, as the next attempt, when that time has come', () => {
      expect(plan('2026-11-01T01:25:00+07:00', {}, [trying()])).toMatchObject({ kind: 'send', attempt: 3 });
      expect(plan('2026-11-01T01:24:59+07:00', {}, [trying()]).kind).toBe('backoff');
    });

    it('tries at once when no time was set, as after a restart in the middle of a send', () => {
      expect(plan('2026-11-01T00:30:00+07:00', {}, [trying({ nextAt: undefined, attempts: 1 })])).toMatchObject({ kind: 'send', attempt: 2 });
    });

    it('is given up on, as attempted, when the week is over', () => {
      expect(plan('2026-11-08T00:00:01+07:00', {}, [trying()])).toMatchObject({ kind: 'expired', attempted: true, month: '2026-10' });
    });
  });

  it('does not look at a month before the latest slot: a missed one stays missed', () => {
    expect(plan('2026-11-04T12:00:00+07:00', {}, [record({ month: '2026-09', outcome: 'missed' }), record()]).kind).toBe('wait');
  });

  it('follows the schedule’s own day and time', () => {
    expect(plan('2026-11-15T08:39:59+07:00', { day: 15, time: '08:30' }, [record({ month: '2026-09' })])).toMatchObject({ kind: 'wait', month: '2026-10' });
    expect(plan('2026-11-15T08:40:00+07:00', { day: 15, time: '08:30' }, [record({ month: '2026-09' })])).toMatchObject({ kind: 'send', month: '2026-10' });
  });
});

describe('skippedSlots: older slots that no look judged (BK-45)', () => {
  // Day 1, 00:00: the report of September is due on 1 October, October's on 1 November, November's on 1 December.
  const now = at('2026-12-04T10:00:00+07:00');
  const from = (iso: string) => schedule({ enabledAt: at(iso) });

  it('finds every slot between the one the schedule was turned on for and the newest, oldest first, with no record', () => {
    expect(skippedSlots(now, from('2026-09-20T00:00:00+07:00'), [], JKT)).toEqual([
      { month: '2026-09', slot: at('2026-10-01T00:00:00+07:00'), attempted: false },
      { month: '2026-10', slot: at('2026-11-01T00:00:00+07:00'), attempted: false },
    ]);
  });

  it('finds nothing while the portal has run all along: the newest slot is the only one that has not been judged', () => {
    const sent = [record({ month: '2026-09' }), record({ month: '2026-10' })];
    expect(skippedSlots(now, from('2026-09-20T00:00:00+07:00'), sent, JKT)).toEqual([]);
  });

  it('passes over a month that has a final record of the schedule, sent, failed or missed', () => {
    for (const outcome of ['sent', 'failed', 'missed'] as const) {
      expect(skippedSlots(now, from('2026-09-20T00:00:00+07:00'), [record({ month: '2026-09', outcome }), record({ month: '2026-10', outcome })], JKT)).toEqual([]);
    }
  });

  it('counts a month that was tried and never ended as attempted', () => {
    const open = [record({ month: '2026-10', outcome: 'sending', attempts: 2 })];
    expect(skippedSlots(now, from('2026-09-20T00:00:00+07:00'), open, JKT)).toEqual([
      { month: '2026-09', slot: at('2026-10-01T00:00:00+07:00'), attempted: false },
      { month: '2026-10', slot: at('2026-11-01T00:00:00+07:00'), attempted: true },
    ]);
  });

  it('counts only the schedule’s own record: a report sent by hand does not stand in for it', () => {
    const byHand = [record({ month: '2026-10', trigger: 'manual' })];
    expect(skippedSlots(now, from('2026-10-20T00:00:00+07:00'), byHand, JKT).map((s) => s.month)).toEqual(['2026-10']);
  });

  it('leaves out a slot that came before the schedule was turned on, and takes one that came at that very second', () => {
    expect(skippedSlots(now, from('2026-11-01T00:00:01+07:00'), [], JKT)).toEqual([]);
    expect(skippedSlots(now, from('2026-11-01T00:00:00+07:00'), [], JKT).map((s) => s.month)).toEqual(['2026-10']);
  });

  it('looks back a year at most, however long ago the schedule was turned on', () => {
    const long = skippedSlots(at('2028-06-04T10:00:00+07:00'), from('2026-01-01T00:00:00+07:00'), [], JKT);
    expect(long).toHaveLength(12);
    expect(long[11]!.month).toBe('2028-04');
  });

  it('finds nothing for a schedule that is off or missing', () => {
    expect(skippedSlots(now, null, [], JKT)).toEqual([]);
    expect(skippedSlots(now, schedule({ enabled: false, enabledAt: at('2026-09-20T00:00:00+07:00') }), [], JKT)).toEqual([]);
  });
});

describe('the turn of the year and the bound on the look ahead (BK-47)', () => {
  const monthsFrom = (first: string, count: number): string[] => {
    const [y, m] = first.split('-').map(Number) as [number, number];
    return Array.from({ length: count }, (_, i) => {
      const index = (y * 12 + (m - 1)) + i;
      return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    });
  };

  it('is due in January of the next year for the report of December', () => {
    expect(slotFor('2026-12', 1, '00:00', JKT)).toBe(at('2027-01-01T00:00:00+07:00'));
    expect(slotFor('2026-11', 15, '08:30', JKT)).toBe(at('2026-12-15T08:30:00+07:00'));
  });

  it('names December as the latest month in January', () => {
    expect(latestSlot(at('2027-01-03T10:00:00+07:00'), 1, '00:00', JKT)).toEqual({ month: '2026-12', slot: at('2027-01-01T00:00:00+07:00') });
  });

  it('goes from December to January of the next year when it looks ahead past a month that went', () => {
    const next = nextSlot(at('2026-12-20T10:00:00+07:00'), 1, '00:00', JKT, new Set(['2026-12']));
    expect(next).toEqual({ month: '2027-01', slot: at('2027-02-01T00:00:00+07:00') });
  });

  it('stops with an error, and does not loop, when every month it can reach is marked as gone', () => {
    const done = new Set(monthsFrom('2026-10', 300));
    expect(() => nextSlot(at('2026-12-20T10:00:00+07:00'), 1, '00:00', JKT, done)).toThrow(/slot/i);
  });

  it('still finds a slot past a full year of months that went', () => {
    const done = new Set(monthsFrom('2026-11', 24));
    expect(nextSlot(at('2026-12-20T10:00:00+07:00'), 1, '00:00', JKT, done).month).toBe('2028-11');
  });
});
