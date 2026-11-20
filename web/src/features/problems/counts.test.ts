import { describe, expect, it } from 'vitest';
import { isInMaintenance, isResolved, matchingWords, partsOf } from './counts';
import { problem } from '../../__tests__/problems';

/** The count beside the filters of the Problems page agrees with the Dashboard's: a problem in maintenance is not open (FR-75). */

const open = (n: number) => problem(n, 3, 60);
const resolved = (n: number) => ({ ...problem(n, 3, 60), r_eventid: '77', r_clock: '1800000100' });
const quiet = (n: number) => ({ ...problem(n, 3, 60), suppressed: '1' as const });

describe('what a problem of the list is', () => {
  it('is resolved when Zabbix gives it a recovery event, and not for the zero it gives an open one', () => {
    expect(isResolved(resolved(1))).toBe(true);
    expect(isResolved({ ...open(1), r_eventid: '0' })).toBe(false);
    expect(isResolved(open(1))).toBe(false);
  });

  it('is in maintenance when it was raised in a window and is still open', () => {
    expect(isInMaintenance(quiet(1))).toBe(true);
    expect(isInMaintenance(open(1))).toBe(false);
    expect(isInMaintenance({ ...quiet(1), r_eventid: '77' })).toBe(false);
  });

  it('divides a list into the three, a resolved problem being resolved whatever window it was raised in', () => {
    const list = [open(1), open(2), quiet(3), resolved(4), { ...quiet(5), r_eventid: '78' }];
    expect(partsOf(list)).toEqual({ open: 2, maintenance: 1, resolved: 2 });
  });
});

describe('the line beside the filters', () => {
  it('says only how many match when all of them are open', () => {
    expect(matchingWords([open(1), open(2), open(3)])).toBe('3 matching');
    expect(matchingWords([])).toBe('0 matching');
  });

  it('keeps the words it had for a list with resolved problems', () => {
    expect(matchingWords([open(1), open(2), resolved(3)])).toBe('3 matching: 2 open, 1 just resolved');
  });

  it('counts the ones in maintenance on their own, and not as open', () => {
    expect(matchingWords([open(1), open(2), quiet(3)])).toBe('3 matching: 2 open, 1 in maintenance');
  });

  it('gives all three parts when a list has all three, in that order', () => {
    expect(matchingWords([open(1), quiet(2), quiet(3), resolved(4)])).toBe('4 matching: 1 open, 2 in maintenance, 1 just resolved');
  });

  it('says 0 open when everything that matches is in maintenance or resolved', () => {
    expect(matchingWords([quiet(1), resolved(2)])).toBe('2 matching: 0 open, 1 in maintenance, 1 just resolved');
  });
});
