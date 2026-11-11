import { describe, expect, it } from 'vitest';
import * as web from '../shared/lib/sites';
import * as webTime from '../shared/lib/time';
import * as server from '../../../server/src/domain/naming';
import * as serverTime from '../../../server/src/sli/time';

/**
 * Two helpers in lib/ are copies of server files, because the browser cannot import server code.
 * They are not byte for byte: the web time.ts adds the zone the page follows. What has to stay
 * equal is what they answer, so both are run over the same inputs here and must agree. In CI the
 * repository holds both packages, so this runs there. Every name below is made up or comes from the
 * naming convention the code itself documents.
 */
describe('shared/lib/sites.ts and server/src/domain/naming.ts', () => {
  const NAMES = [
    ...server.SITES.flatMap((s) => [`${s.code}.1 ${s.aliases[0]}01`, `${s.code}.2.3 ${s.aliases[s.aliases.length - 1].toLowerCase()}-02`, `INET : ${s.name} WAN 1`, `SERVER : CUCM ${s.aliases[0]}`]),
    '', '   ', '0.1 SAMPLE', '15.1 SAMPLE', '1', '1.', '1.1', '.5 SAMPLE', 'x 1.2 SAMPLE', 'jakarta', 'Jakarta core', 'SAMPLE-SWITCH', '3.2.4 ÄÖÜ', '14.1 TWSB OFFICE', '10.9.9 FPU ARUBA 9',
    '10.20.30.40', ' 12.0.0.1', '10.0.0.1 CORE', '1.2.3.4', '192.168.1.10', '10.2.1 FPU-SW-01', '12.1.1. POR-C9200-01',
  ];

  it('list the same sites, with the same codes, names and aliases', () => {
    expect(web.SITES).toEqual(server.SITES);
  });

  it.each(NAMES)('read the site of %j the same way', (name) => {
    expect(web.siteFromHostName(name)).toEqual(server.siteFromHostName(name));
  });

  it('read the name of a host that is an address as no site, on both sides', () => {
    for (const name of ['10.20.30.40', ' 12.0.0.1', '10.0.0.1 CORE', '1.2.3.4']) {
      expect(web.siteFromHostName(name), name).toBeNull();
      expect(server.siteFromHostName(name), name).toBeNull();
    }
  });

  it('read some site for most of the names, so the comparison is not two nulls', () => {
    expect(NAMES.filter((n) => server.siteFromHostName(n) !== null).length).toBeGreaterThan(30);
  });

  it('sort names in the same order, numbers by value', () => {
    const sample = ['1.10 B', '1.2 A', '1.2.1 A', '10.1 C', '2.1 D', 'INET : X 2', 'INET : X 10', '1.2 a'];
    expect([...sample].sort(web.naturalCompare)).toEqual([...sample].sort(server.naturalCompare));
  });
});

describe('shared/lib/time.ts and server/src/sli/time.ts', () => {
  // Fixed offset, two with daylight saving in different hemispheres, and one with a half-hour shift.
  const ZONES = ['Asia/Jakarta', 'UTC', 'America/New_York', 'Europe/London', 'Pacific/Auckland', 'Australia/Lord_Howe'];
  const MONTHS = Array.from({ length: 24 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);

  it.each(ZONES)('cut every month the same in %s', (tz) => {
    for (const month of MONTHS) expect(webTime.monthBounds(month, tz), `${month} in ${tz}`).toEqual(serverTime.monthBounds(month, tz));
  });

  it.each(ZONES)('start every month at the same moment in %s', (tz) => {
    for (let year = 2025; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) expect(webTime.zonedMonthStart(year, month, tz), `${year}-${month} in ${tz}`).toBe(serverTime.zonedMonthStart(year, month, tz));
    }
  });

  it.each(ZONES)('name the month of a moment the same way in %s, on both sides of each boundary', (tz) => {
    for (const month of MONTHS) {
      const { from, to } = serverTime.monthBounds(month, tz);
      for (const at of [from - 1, from, from + 1, to - 1, to, to + 1]) expect(webTime.monthOf(at, tz), `${at} in ${tz}`).toBe(serverTime.monthOf(at, tz));
    }
  });

  // 47 zone-and-month pairs from 2018 to 2034 start on a day the clock changes, where a month start worked out in one
  // pass lands an hour off. These are some of them; the search that found them ran over every IANA zone.
  const ON_A_CLOCK_CHANGE: [string, string][] = [
    ['Australia/Adelaide', '2023-10'], ['Australia/Adelaide', '2018-04'], ['America/Asuncion', '2023-10'],
    ['Antarctica/McMurdo', '2018-04'], ['Antarctica/Macquarie', '2028-10'], ['Antarctica/Macquarie', '2018-04'],
  ];

  it.each(ON_A_CLOCK_CHANGE)('start %s %s at the same moment on both sides, though the clock changes that day', (tz, month) => {
    expect(webTime.monthBounds(month, tz)).toEqual(serverTime.monthBounds(month, tz));
    const [year, mon] = month.split('-').map(Number);
    expect(webTime.zonedMonthStart(year, mon, tz)).toBe(serverTime.zonedMonthStart(year, mon, tz));
  });

  it('start October 2023 in Adelaide at 14:30 UTC the day before: daylight saving began at 02:00 that morning, after midnight', () => {
    // Local midnight on 1 October was still +9:30. A one-pass reading of the offset at 00:00 UTC (+10:30) would say 13:30.
    const expected = Date.UTC(2023, 8, 30, 14, 30) / 1000;
    expect(webTime.zonedMonthStart(2023, 10, 'Australia/Adelaide')).toBe(expected);
    expect(serverTime.zonedMonthStart(2023, 10, 'Australia/Adelaide')).toBe(expected);
  });

  it('make a month 28 to 31 days long, or 23 to 25 hours more or less across a clock change, the same on both sides', () => {
    const { from, to } = webTime.monthBounds('2026-03', 'America/New_York');
    expect((to - from) / 3600).toBe(31 * 24 - 1);
    expect(serverTime.monthBounds('2026-03', 'America/New_York')).toEqual({ from, to });
  });
});
