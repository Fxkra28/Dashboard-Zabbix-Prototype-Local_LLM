import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clockOffsetMs, noteServerTime, onServerClockChange, resetServerClock, serverNow } from './clock';
import { ago, duration } from './severity';
import { momentWords, staleWhen } from './freshness';
import { formatClockLabeled, formatDay } from './time';
import { useNow } from '../hooks/useNow';

/**
 * The page's ages are worked out from the server's clock, not from the machine that draws it (FR-74). The machine below is the wall PC: its clock is the fake system time, and the server's is
 * ahead of it or behind it by the amounts of the audit's examples.
 */

const PC = Date.parse('2026-11-19T04:00:00Z');
const HOUR = 3_600_000;
/** An answer from a server whose clock is `ahead` ms ahead of the PC's, received now. */
const hear = (ahead: number) => noteServerTime(new Date(PC + ahead).toUTCString(), Date.now());
/** What a Zabbix timestamp is, for a problem the server raised `secondsAgo` seconds ago by its own clock. */
const raisedAgo = (secondsAgo: number, ahead: number) => Math.floor((PC + ahead) / 1000) - secondsAgo;

beforeEach(() => {
  resetServerClock();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(PC);
});
afterEach(() => {
  vi.useRealTimers();
  resetServerClock();
});

describe('the offset of the server’s clock', () => {
  it('is nothing until an answer has been heard, and the page’s own time is the time', () => {
    expect(clockOffsetMs()).toBe(0);
    expect(serverNow()).toBe(PC);
  });

  it('is taken from the Date header: a PC two hours slow, and one ten minutes fast', () => {
    hear(2 * HOUR);
    expect(Math.abs(serverNow() - (PC + 2 * HOUR))).toBeLessThanOrEqual(1_000);
    resetServerClock();
    hear(-10 * 60_000);
    expect(Math.abs(serverNow() - (PC - 10 * 60_000))).toBeLessThanOrEqual(1_000);
  });

  it('leaves a machine that agrees with the server within a second alone, so its seconds do not jump', () => {
    hear(0);
    expect(clockOffsetMs()).toBe(0);
    hear(900);
    expect(serverNow()).toBe(PC);
    resetServerClock();
    hear(-1_000);
    expect(clockOffsetMs()).toBe(0);
  });

  it('keeps the offset it has through the jitter of whole seconds and the network, and follows a clock that moved', () => {
    hear(2 * HOUR);
    const held = clockOffsetMs();
    hear(2 * HOUR + 1_000);
    hear(2 * HOUR - 1_500);
    expect(clockOffsetMs()).toBe(held);
    hear(2 * HOUR + 60_000);
    expect(clockOffsetMs()).not.toBe(held);
    expect(Math.abs(serverNow() - (PC + 2 * HOUR + 60_000))).toBeLessThanOrEqual(1_000);
  });

  it('ignores a header that is missing or is not a date', () => {
    hear(2 * HOUR);
    const held = clockOffsetMs();
    noteServerTime(null);
    noteServerTime('');
    noteServerTime('yesterday, about noon');
    expect(clockOffsetMs()).toBe(held);
  });

  // A header is believed because the server's clock is the portal's, not because it is anything: one that is not a date a portal could be running on would make every time a page writes an Invalid Date.
  it('ignores a date no portal could be running on: the year 275760, a server whose clock was never set, and a date far ahead', () => {
    hear(2 * HOUR);
    const held = clockOffsetMs();
    noteServerTime('Sat, 13 Sep 275760 00:00:00 GMT');
    noteServerTime('Thu, 01 Jan 1970 00:00:05 GMT');
    noteServerTime('Fri, 01 Jan 2101 00:00:00 GMT');
    expect(clockOffsetMs()).toBe(held);
    expect(Number.isFinite(serverNow())).toBe(true);
    expect(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta' }).format(serverNow())).not.toThrow();
  });

  it('ignores them as a first answer too, and still corrects a PC whose own clock is years wrong', () => {
    noteServerTime('Sat, 13 Sep 275760 00:00:00 GMT');
    expect(clockOffsetMs()).toBe(0);
    // A wall PC whose battery died and whose clock says 2003: the server says 2026, which is the date a portal runs on.
    const lost = Date.parse('2003-05-01T00:00:00Z');
    noteServerTime(new Date(PC).toUTCString(), lost);
    expect(clockOffsetMs()).toBeGreaterThan(20 * 365 * 24 * HOUR);
  });

  it('is learned from an answer of the API, whatever page asked', async () => {
    const answer = new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', Date: new Date(PC + 2 * HOUR).toUTCString() } });
    vi.stubGlobal('fetch', vi.fn(async () => answer));
    const { api } = await import('../../api');
    await api.problems();
    vi.unstubAllGlobals();
    expect(Math.abs(serverNow() - (PC + 2 * HOUR))).toBeLessThanOrEqual(1_000);
  });
});

describe('the ages of the page, with the examples of the audit', () => {
  it('says 3m 0s ago for a problem raised three minutes ago, on a PC two hours slow, where it said 0s', () => {
    const clock = raisedAgo(180, 2 * HOUR);
    expect(ago(clock)).toBe('0s ago');
    hear(2 * HOUR);
    expect(ago(clock)).toBe('3m 0s ago');
    expect(duration(clock)).toBe('3m 0s');
  });

  it('says 3m 0s ago on a PC ten minutes fast, where it said 13m 0s', () => {
    const clock = raisedAgo(180, -10 * 60_000);
    expect(ago(clock)).toBe('13m 0s ago');
    hear(-10 * 60_000);
    expect(ago(clock)).toBe('3m 0s ago');
  });

  it('counts the duration of a resolved problem between its two stamps, whatever the PC says', () => {
    hear(2 * HOUR);
    expect(duration(1_000, 1_300)).toBe('5m 0s');
  });

  it('words the age of an old copy by the server’s clock', () => {
    hear(-10 * 60_000);
    const madeAt = PC - 10 * 60_000 - 5 * 60_000;
    expect(staleWhen(madeAt)).toContain('5 min ago');
  });

  it('says which day a moment belongs to by the server’s day, near midnight, when the PC is ten minutes behind it', () => {
    // 23:55 in Jakarta by the PC, 00:05 of the next day by the server: a moment at 23:50 was yesterday.
    vi.setSystemTime(Date.parse('2026-11-19T16:55:00Z'));
    const moment = Date.parse('2026-11-19T16:50:00Z');
    expect(momentWords(moment)).toBe(formatClockLabeled(moment));
    noteServerTime(new Date(Date.now() + 10 * 60_000).toUTCString(), Date.now());
    expect(momentWords(moment)).toBe(`${formatDay(moment)} ${formatClockLabeled(moment)}`);
  });

  it('hands every page that watches the clock the server’s time, and moves with it', () => {
    hear(2 * HOUR);
    const { result } = renderHook(() => useNow(1_000));
    expect(Math.abs(result.current - (PC + 2 * HOUR))).toBeLessThanOrEqual(1_000);
  });
});

describe('a page that watches the clock when the first answer comes after it was drawn (FR-74)', () => {
  it('tells those who asked when the offset was learned, and when it moved, and not for a reading that only repeats it', () => {
    const heard = vi.fn();
    const stop = onServerClockChange(heard);
    hear(2 * HOUR);
    expect(heard).toHaveBeenCalledTimes(1);
    hear(2 * HOUR + 1_000);
    expect(heard).toHaveBeenCalledTimes(1);
    hear(2 * HOUR + 60_000);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    hear(3 * HOUR);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('gives useNow the server\'s time as soon as it is heard, and not at its next tick', () => {
    const { result } = renderHook(() => useNow(60_000));
    expect(result.current).toBe(PC);
    act(() => hear(2 * HOUR));
    expect(Math.abs(result.current - (PC + 2 * HOUR))).toBeLessThanOrEqual(1_000);
  });
});
