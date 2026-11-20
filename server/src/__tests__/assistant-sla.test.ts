import { beforeEach, describe, expect, it, vi } from 'vitest';
import { percentText } from '../export/slaReport.js';
import { getWindowSli } from '../services/sli.js';
import { hoursOf, readSlaWindow, slaSection, slaWindowOf, snapshotHolds, type SlaWindow } from '../services/assistantSla.js';

vi.mock('../services/sli.js', () => ({ getWindowSli: vi.fn() }));

/**
 * The SLA of a window the snapshot does not hold: a named month, a year, a week, a run of days, the hours that count. The portal's strict method, from months read once and kept; a window is whole hours
 * in the SLA time zone, and what the snapshot already says (last month, this month, every hour) is not read again.
 */

const TZ = 'Asia/Jakarta';
const NOW = Date.parse('2026-11-18T05:30:00Z') / 1000;
const at = (iso: string) => Date.parse(`${iso}+07:00`) / 1000;

describe('hoursOf', () => {
  it('reads "jam kerja" as 08:00 to 17:00 on weekdays', () => {
    expect(hoursOf('SLA bulan lalu jam kerja')).toEqual({ hours: { start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] }, text: '08:00 to 17:00 on weekdays' });
    expect(hoursOf('uptime during office hours?')?.text).toBe('08:00 to 17:00 on weekdays');
  });

  it('reads the hours a question says, for every day unless it says weekdays', () => {
    expect(hoursOf('availability dari jam 8 sampai 17')).toEqual({ hours: { start: 8, end: 17, weekdays: null }, text: '08:00 to 17:00' });
    expect(hoursOf('SLA 08:00-17:00 setiap hari')?.hours.weekdays).toBeNull();
    expect(hoursOf('SLA from 9 to 18 on weekdays')?.hours).toEqual({ start: 9, end: 18, weekdays: [1, 2, 3, 4, 5] });
    expect(hoursOf('SLA jam 22 sampai 6')?.text).toBe('22:00 to 06:00');
  });

  it('names no hours for a question that names none, or an hour that does not exist', () => {
    expect(hoursOf('SLA bulan lalu')).toBeNull();
    expect(hoursOf('SLA jam 25 sampai 30')).toBeNull();
    expect(hoursOf('SLA 7 hari terakhir')).toBeNull();
    // Two numbers before a month are the days of a range of dates, not a range of hours; with jam or pukul in front of them they are hours.
    expect(hoursOf('SLA from 1 to 7 November')).toBeNull();
    expect(hoursOf('SLA between 1 and 7 november')).toBeNull();
    expect(hoursOf('SLA dari 1 sampai 7 november')).toBeNull();
    expect(hoursOf('SLA antara 3 dan 9 Desember')).toBeNull();
    expect(hoursOf('SLA from 1 to 7 of November')).toBeNull();
    expect(hoursOf('SLA dari 8 sampai 17')?.text).toBe('08:00 to 17:00');
    expect(hoursOf('SLA from 8 to 17 in November')?.text).toBe('08:00 to 17:00');
    expect(hoursOf('SLA November dari jam 8 sampai 17')?.text).toBe('08:00 to 17:00');
  });
});

describe('slaWindowOf', () => {
  const whole = (w: SlaWindow) => [w.from % 3600, w.to % 3600];

  it('reads a month by its name, the latest one that has begun, or the year it says', () => {
    const october = slaWindowOf('SLA bulan Oktober berapa?', NOW, TZ)!;
    expect([october.from, october.to, october.label]).toEqual([at('2026-10-01T00:00:00'), at('2026-11-01T00:00:00'), 'October 2026']);
    expect(slaWindowOf('sla desember', NOW, TZ)!.label).toBe('December 2025');
    expect(slaWindowOf('availability oktober 2025', NOW, TZ)!.label).toBe('October 2025');
    expect(slaWindowOf('SLA November', NOW, TZ)!.to).toBe(Math.floor(NOW / 3600) * 3600);
  });

  it('gives nothing for a month that has not begun', () => {
    expect(slaWindowOf('SLA Desember 2026', NOW, TZ)).toBeNull();
  });

  it('reads this year and last year', () => {
    const year = slaWindowOf('SLA tahun ini', NOW, TZ)!;
    expect([year.from, year.to, year.label]).toEqual([at('2026-01-01T00:00:00'), Math.floor(NOW / 3600) * 3600, 'this year']);
    const last = slaWindowOf('sla tahun lalu', NOW, TZ)!;
    expect([last.from, last.to]).toEqual([at('2025-01-01T00:00:00'), at('2026-01-01T00:00:00')]);
  });

  it('reads the windows that a question about the past reads, up to a year, in whole hours', () => {
    const days = slaWindowOf('SLA 7 hari terakhir', NOW, TZ)!;
    expect(days.label).toBe('the last 7 days');
    expect(whole(days)).toEqual([0, 0]);
    expect(slaWindowOf('SLA 300 hari terakhir', NOW, TZ)!.label).toBe('the last 300 days');
    expect(slaWindowOf('sla kemarin', NOW, TZ)).toMatchObject({ from: at('2026-11-17T00:00:00'), to: at('2026-11-18T00:00:00') });
    expect(slaWindowOf('SLA minggu lalu', NOW, TZ)!.label).toBe('last week');
  });

  it('carries the hours that count', () => {
    expect(slaWindowOf('SLA minggu lalu jam kerja', NOW, TZ)).toMatchObject({ label: 'last week', hoursText: '08:00 to 17:00 on weekdays', hours: { start: 8, end: 17 } });
  });

  it('gives nothing when no time is named, or less than an hour of one is left', () => {
    expect(slaWindowOf('berapa SLA sekarang?', NOW, TZ)).toBeNull();
    expect(slaWindowOf('SLA 20 menit lalu', NOW, TZ)).toBeNull();
  });
});

describe('snapshotHolds', () => {
  it('knows last month and this month over every hour, which the snapshot already says', () => {
    expect(snapshotHolds(slaWindowOf('SLA bulan lalu', NOW, TZ)!, NOW, TZ)).toBe(true);
    expect(snapshotHolds(slaWindowOf('SLA bulan ini', NOW, TZ)!, NOW, TZ)).toBe(true);
    expect(snapshotHolds(slaWindowOf('SLA oktober', NOW, TZ)!, NOW, TZ)).toBe(true);
  });

  it('does not know another month, a week, or the same month for some hours only', () => {
    expect(snapshotHolds(slaWindowOf('SLA september', NOW, TZ)!, NOW, TZ)).toBe(false);
    expect(snapshotHolds(slaWindowOf('SLA minggu lalu', NOW, TZ)!, NOW, TZ)).toBe(false);
    expect(snapshotHolds(slaWindowOf('SLA bulan lalu jam kerja', NOW, TZ)!, NOW, TZ)).toBe(false);
  });
});

const report = (over: Record<string, unknown> = {}) =>
  ({
    target: 99,
    overall: { sli: 99.5, meeting: true, hosts: 120, withData: 118 },
    sites: [
      { name: 'Surabaya', sli: 98.2 },
      { name: 'Pasuruan / GMS', sli: 99.9 },
      { name: 'FPSO', sli: 97.1 },
    ],
    hosts: [
      { name: 'A-SW1', sli: 91.4 },
      { name: 'B-SW2', sli: 99.8 },
      { name: 'C-FW1', sli: 95 },
      { name: 'D-AP1', sli: 96.2 },
      { name: 'E-AP2', sli: 97.9 },
    ],
    ...over,
  }) as never;

describe('slaSection', () => {
  const week = slaWindowOf('SLA minggu lalu', NOW, TZ)!;

  it('gives the figure with its window, the sites below target worst first, the three worst devices and what is left out', () => {
    const lines = slaSection(report(), week, TZ, 900).text.split('\n');
    expect(lines[0]).toBe(`SLA of last week, from Mon 9 Nov 00:00 to Mon 16 Nov 00:00 (Asia/Jakarta), by the strict method (target 99%): ${percentText(99.5, 99)}, met (118 of 120 devices with data):`);
    expect(lines[1]).toBe(`- 2 sites below target: FPSO ${percentText(97.1, 99)}, Surabaya ${percentText(98.2, 99)}`);
    expect(lines[2]).toBe(`- worst devices: A-SW1 ${percentText(91.4, 99)}, C-FW1 ${percentText(95, 99)}, D-AP1 ${percentText(96.2, 99)}`);
    expect(lines[3]).toBe('- planned maintenance is left out, and so are the hours in which nothing was collected');
  });

  it('says which hours were counted, and that the target was missed', () => {
    const hours = slaWindowOf('SLA minggu lalu jam kerja', NOW, TZ)!;
    const text = slaSection(report({ overall: { sli: 97, meeting: false, hosts: 120, withData: 118 } }), hours, TZ, 900).text;
    expect(text.split('\n')[0]).toContain(', counting only 08:00 to 17:00 on weekdays, by the strict method');
    expect(text.split('\n')[0]).toContain(`${percentText(97, 99)}, missed`);
  });

  it('says so when there is no figure', () => {
    expect(slaSection(report({ overall: { sli: null, meeting: null, hosts: 0, withData: 0 }, sites: [], hosts: [] }), week, TZ, 900).text.split('\n')[0]).toContain('no data, missed (0 of 0 devices with data)');
  });
});

describe('readSlaWindow', () => {
  beforeEach(() => {
    vi.mocked(getWindowSli).mockReset().mockResolvedValue(report());
  });

  it('asks the SLA service for the window by the strict method, with the hours', async () => {
    const w = slaWindowOf('SLA minggu lalu jam kerja', NOW, TZ)!;
    await readSlaWindow(w);
    expect(getWindowSli).toHaveBeenCalledWith({ from: w.from, to: w.to, profile: 'availability', hours: w.hours });
  });
});
