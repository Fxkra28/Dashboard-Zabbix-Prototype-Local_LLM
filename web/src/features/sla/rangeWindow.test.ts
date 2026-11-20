import { describe, expect, it } from 'vitest';
import {
  ALL_DAY,
  MAX_RANGE_SECONDS,
  addDays,
  atHour,
  boundsOf,
  dayBounds,
  daysText,
  hoursProblem,
  hoursQuery,
  hoursText,
  isDate,
  keepsEverything,
  measuredHoursText,
  offeredYears,
  parseDays,
  rangeWords,
  windowProblem,
  yearBounds,
  type RangeChoice,
} from './rangeWindow';

// The report zone is Asia/Jakarta, which has no daylight saving: a day is 24 hours and midnight is 17:00 UTC the evening before.
const TZ = 'Asia/Jakarta';
const at = (iso: string) => Date.parse(iso) / 1000;

describe('dates', () => {
  it('knows a calendar date from a string that only looks like one', () => {
    expect(isDate('2026-02-28')).toBe(true);
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('26-02-01')).toBe(false);
    expect(isDate('')).toBe(false);
  });

  it('adds days across a month and a year', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('the window a choice names', () => {
  it('is a day from midnight to the next midnight of the report zone', () => {
    expect(dayBounds('2026-11-16', TZ)).toEqual({ from: at('2026-11-15T17:00:00Z'), to: at('2026-11-16T17:00:00Z') });
    expect(dayBounds('2026-02-30', TZ).to).toBeNaN();
  });

  it('is a year from the first of January to the first of the next', () => {
    expect(yearBounds(2026, TZ)).toEqual({ from: at('2025-12-31T17:00:00Z'), to: at('2026-12-31T17:00:00Z') });
    const { from, to } = yearBounds(2028, TZ);
    expect(to - from).toBe(366 * 86400);
  });

  it('reads two ends of a custom range as a date and an hour', () => {
    expect(atHour('2026-11-16', 8, TZ)).toBe(at('2026-11-16T01:00:00Z'));
    expect(atHour('2026-11-16', 24, TZ)).toBeNaN();
    expect(atHour('2026-11-16', 1.5, TZ)).toBeNaN();
  });

  const base: RangeChoice = { mode: 'month', day: '2026-11-16', month: '2026-10', year: 2026, fromDate: '2026-11-01', fromHour: 8, toDate: '2026-11-02', toHour: 20 };
  it('takes the end points from the mode', () => {
    expect(boundsOf(base, TZ)).toEqual({ from: at('2026-09-30T17:00:00Z'), to: at('2026-10-31T17:00:00Z') });
    expect(boundsOf({ ...base, mode: 'day' }, TZ)).toEqual(dayBounds('2026-11-16', TZ));
    expect(boundsOf({ ...base, mode: 'year' }, TZ)).toEqual(yearBounds(2026, TZ));
    expect(boundsOf({ ...base, mode: 'custom' }, TZ)).toEqual({ from: at('2026-11-01T01:00:00Z'), to: at('2026-11-02T13:00:00Z') });
    expect(boundsOf({ ...base, month: 'October' }, TZ).from).toBeNaN();
  });

  it('says why a window cannot be asked for', () => {
    expect(windowProblem(NaN, 5)).toMatch(/date and an hour/);
    expect(windowProblem(10, 10)).toMatch(/before the end/);
    expect(windowProblem(10, 5)).toMatch(/before the end/);
    expect(windowProblem(0, MAX_RANGE_SECONDS + 3600)).toMatch(/366 days/);
    expect(windowProblem(0, MAX_RANGE_SECONDS)).toBeNull();
  });

  // FR-67: the server refuses a start that is in the future or more than 400 days back, and the page says so instead of sending it.
  it('judges the start as the server does when it is given the time now', () => {
    const now = at('2026-11-19T05:00:00Z');
    const day = 86400;
    expect(windowProblem(now - 30 * day, now - 29 * day, now)).toBeNull();
    expect(windowProblem(now + day, now + 2 * day, now)).toBe('That period has not started yet.');
    expect(windowProblem(now - 401 * day, now - 400 * day, now, TZ)).toBe('Zabbix keeps events for about a year; pick a later period.');
    // Without the time, only the shape of the window is judged, as before.
    expect(windowProblem(now + day, now + 2 * day)).toBeNull();
  });

  // The server reads a range in whole months and refuses a month that began more than 400 days ago, and so a range that begins in one, though its own start is later.
  it('refuses a start whose first month began more than 400 days ago, and names the first month that is read', () => {
    const now = at('2026-11-19T05:00:00Z'); // the 400-day line is 15 October 2025
    const twentieth = at('2025-10-19T17:00:00Z'); // 20 October 2025, 00:00 in Jakarta: 335 days back, in a month that began 414 days back
    const problem = windowProblem(twentieth, twentieth + 86400, now, TZ);
    expect(problem).toMatch(/^Zabbix keeps events for about a year; pick a later period\. /);
    expect(problem).toContain('start in Nov 2025 or later');
    // The line itself is inside October, and the last hour of October is too.
    expect(windowProblem(now - 400 * 86400, now - 399 * 86400, now, TZ)).toContain('Nov 2025');
    expect(windowProblem(at('2025-10-31T16:00:00Z'), at('2025-10-31T18:00:00Z'), now, TZ)).toContain('Nov 2025');
    // The first midnight of November is the first start whose month is read.
    expect(windowProblem(at('2025-10-31T17:00:00Z'), at('2025-11-01T17:00:00Z'), now, TZ)).toBeNull();
  });

  it('takes the month of the line as the first one read when the line is that month\'s first second', () => {
    // 1 December 2025, 00:00 in Jakarta, is the line: 400 days before 4 January 2027, 17:00 UTC.
    const line = at('2025-11-30T17:00:00Z');
    const now = line + 400 * 86400;
    expect(windowProblem(line, line + 86400, now, TZ)).toBeNull();
    // An hour before it is plainly too old, and the page does not add a month to start in.
    expect(windowProblem(line - 3600, line, now, TZ)).toBe('Zabbix keeps events for about a year; pick a later period.');
  });

  it('names January when the month of the line is December', () => {
    const now = at('2028-01-19T05:00:00Z'); // the line is 15 December 2026
    const twentieth = at('2026-12-19T17:00:00Z'); // 20 December 2026, 00:00 in Jakarta
    expect(windowProblem(twentieth, twentieth + 86400, now, TZ)).toContain('start in Jan 2027 or later');
  });
});

describe('the years a Year choice offers (FR-67)', () => {
  it('offers this year and, while its first day is in reach, last year', () => {
    // 19 November 2026: 1 January 2025 is 687 days back and out of reach, 1 January 2026 is 322 days back.
    expect(offeredYears(at('2026-11-19T05:00:00Z'), TZ)).toEqual([2026]);
  });

  it('offers last year in January and until the first of its days passes 400 days', () => {
    // The first midnight of 2026 in Jakarta passes 400 days back at 17:00 UTC on 4 February 2027.
    expect(offeredYears(at('2027-01-15T05:00:00Z'), TZ)).toEqual([2027, 2026]);
    expect(offeredYears(at('2027-02-04T05:00:00Z'), TZ)).toEqual([2027, 2026]);
    expect(offeredYears(at('2027-02-07T05:00:00Z'), TZ)).toEqual([2027]);
  });

  it('never offers a year the server would refuse', () => {
    for (const iso of ['2026-01-02T00:00:00Z', '2026-03-01T00:00:00Z', '2026-12-31T16:00:00Z', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z']) {
      const now = at(iso);
      for (const y of offeredYears(now, TZ)) expect(windowProblem(yearBounds(y, TZ).from, yearBounds(y, TZ).to, now) ?? '').not.toMatch(/about a year/);
    }
  });
});

describe('the hours of the day and the days of the week', () => {
  it('sends nothing for a choice that keeps everything', () => {
    expect(hoursQuery(ALL_DAY)).toEqual({});
    expect(hoursQuery({ start: 0, end: 24, days: [1, 2, 3, 4, 5, 6, 7] })).toEqual({});
    expect(keepsEverything({ start: 0, end: 24, days: [] })).toBe(true);
  });

  it('sends the hours, the days, or both', () => {
    expect(hoursQuery({ start: 8, end: 17, days: [] })).toEqual({ dayHours: '8-17' });
    expect(hoursQuery({ start: 0, end: 24, days: [5, 1, 3] })).toEqual({ days: '1,3,5' });
    expect(hoursQuery({ start: 22, end: 6, days: [1, 2, 3, 4, 5] })).toEqual({ dayHours: '22-6', days: '1,2,3,4,5' });
  });

  it('refuses hours that start and end together, except all of the day', () => {
    expect(hoursProblem({ start: 6, end: 6, days: [] })).toMatch(/different times/);
    expect(hoursProblem({ start: 0, end: 24, days: [] })).toBeNull();
    expect(hoursProblem({ start: 22, end: 6, days: [] })).toBeNull();
    // 24 is midnight, so starting at 0 and ending at 24 is a whole day and ending at 24 from 12 is not the same hour.
    expect(hoursProblem({ start: 12, end: 24, days: [] })).toBeNull();
  });

  it('reads the days of an address, and nothing else', () => {
    expect(parseDays('1,2,3,4,5')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('5,1,5')).toEqual([1, 5]);
    expect(parseDays('')).toEqual([]);
    expect(parseDays('0,8')).toEqual([]);
    expect(parseDays('mon')).toEqual([]);
  });

  it('says days and hours in words', () => {
    expect(daysText([1, 2, 3, 4, 5])).toBe('Monday to Friday');
    expect(daysText([1, 3, 5])).toBe('Monday, Wednesday and Friday');
    expect(daysText([6, 7])).toBe('Saturday and Sunday');
    expect(daysText([2])).toBe('Tuesday');
    expect(daysText(null)).toBe('every day');
    expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe('every day');
    expect(hoursText({ start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] })).toBe('08:00 to 17:00, Monday to Friday');
    expect(hoursText({ start: 22, end: 6, weekdays: null })).toBe('22:00 to 06:00 the next morning, every day');
    expect(hoursText({ start: 0, end: 24, weekdays: [6, 7] })).toBe('all day, Saturday and Sunday');
    expect(hoursText({ start: 8, end: 24, weekdays: null })).toBe('08:00 to 24:00, every day');
  });

  it('says measured time in hours', () => {
    expect(measuredHoursText(189 * 3600)).toBe('189 hours');
    expect(measuredHoursText(3600)).toBe('1 hour');
    expect(measuredHoursText(5400)).toBe('1.5 hours');
  });
});

describe('rangeWords, what a person reads of a range in a button, a dialog and a message', () => {
  const from = atHour('2026-11-03', 0, TZ);
  const to = atHour('2026-11-10', 0, TZ);

  it('gives the two times on the wall clock of the report, the end being the first moment after the range', () => {
    expect(rangeWords(from, to, ALL_DAY, TZ)).toBe('3 Nov 2026, 00:00 to 10 Nov 2026, 00:00');
  });

  it('adds the hours that count, in the words the page and the file use', () => {
    expect(rangeWords(from, to, { start: 8, end: 17, days: [1, 2, 3, 4, 5] }, TZ)).toBe('3 Nov 2026, 00:00 to 10 Nov 2026, 00:00, 08:00 to 17:00, Monday to Friday');
    expect(rangeWords(from, to, { start: 22, end: 6, days: [] }, TZ)).toBe('3 Nov 2026, 00:00 to 10 Nov 2026, 00:00, 22:00 to 06:00 the next morning, every day');
    expect(rangeWords(from, to, { start: 0, end: 24, days: [6, 7] }, TZ)).toBe('3 Nov 2026, 00:00 to 10 Nov 2026, 00:00, all day, Saturday and Sunday');
  });

  it('says nothing of hours when every hour counts, even with all seven days named', () => {
    expect(rangeWords(from, to, { start: 0, end: 24, days: [1, 2, 3, 4, 5, 6, 7] }, TZ)).toBe('3 Nov 2026, 00:00 to 10 Nov 2026, 00:00');
  });

  it('reads the hour in the zone it is given, not in the browser’s', () => {
    expect(rangeWords(at('2026-11-02T17:00:00Z'), at('2026-11-02T20:00:00Z'), ALL_DAY, 'UTC')).toBe('2 Nov 2026, 17:00 to 2 Nov 2026, 20:00');
    expect(rangeWords(at('2026-11-02T17:00:00Z'), at('2026-11-02T20:00:00Z'), ALL_DAY, TZ)).toBe('3 Nov 2026, 00:00 to 3 Nov 2026, 03:00');
  });
});
