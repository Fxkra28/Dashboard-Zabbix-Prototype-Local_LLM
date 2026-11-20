import { describe, expect, it } from 'vitest';
import { windowOf, windowWords } from '../services/assistantWhen.js';
import { capacitySection, noiseSection, topTriggersSection } from '../services/assistantReports.js';
import { topicsOf } from '../services/assistantTopics.js';
import { slaWindowOf } from '../services/assistantSla.js';
import { sitesNamed } from '../services/assistantFocus.js';

/**
 * The everyday words of a question, read as the window and the report they mean (BK-85, BK-86, BK-87). The time is Wednesday 18 November 2026, 12:30 in Jakarta, as in the other tests of the
 * words, and the zone is the SLA's.
 */
const TZ = 'Asia/Jakarta';
const at = (iso: string) => Date.parse(`${iso}+07:00`) / 1000;
const NOW = at('2026-11-18T12:30:00');
const DAY = 86_400;

describe('from a time until now (BK-85)', () => {
  it.each([
    ['sejak kemarin', '2026-11-17T00:00:00', 'since yesterday'],
    ['dari kemarin', '2026-11-17T00:00:00', 'since yesterday'],
    ['kemarin sampai sekarang', '2026-11-17T00:00:00', 'since yesterday'],
    ['yesterday until now', '2026-11-17T00:00:00', 'since yesterday'],
    ['since yesterday', '2026-11-17T00:00:00', 'since yesterday'],
    ['since this morning', '2026-11-18T05:00:00', 'since this morning'],
    ['sejak tadi pagi', '2026-11-18T05:00:00', 'since this morning'],
    ['sejak tadi malam', '2026-11-17T18:00:00', 'since last night'],
    ['since last week', '2026-11-09T00:00:00', 'since last week'],
    ['sejak minggu lalu', '2026-11-09T00:00:00', 'since last week'],
    ['since last month', '2026-10-01T00:00:00', 'since last month'],
  ])('reads "%s" as that start, through now', (question, from, label) => {
    expect(windowOf(question, NOW, TZ)).toEqual({ from: at(from), to: NOW, label });
  });

  it('writes the exact ends into the prompt', () => {
    expect(windowWords(windowOf('sejak kemarin', NOW, TZ)!, TZ)).toBe('since yesterday, from Tue 17 Nov 00:00 to Wed 18 Nov 12:30 (Asia/Jakarta)');
  });

  it('leaves a window that already ends now as it was', () => {
    expect(windowOf('since 3 days ago', NOW, TZ)).toMatchObject({ from: NOW - 3 * DAY, to: NOW });
    expect(windowOf('sejak hari ini', NOW, TZ)).toMatchObject({ from: at('2026-11-18T00:00:00'), to: NOW, label: 'today' });
  });
});

describe('two days or weeks named together (BK-85)', () => {
  it.each([
    ['yesterday and today', '2026-11-17T00:00:00', 'yesterday and today'],
    ['kemarin dan hari ini ada masalah apa', '2026-11-17T00:00:00', 'yesterday and today'],
    ['minggu lalu dan minggu ini', '2026-11-09T00:00:00', 'last week and this week'],
    ['bulan lalu dan bulan ini', '2026-10-01T00:00:00', 'last month and this month'],
  ])('reads "%s" as one window from the earlier start to now', (question, from, label) => {
    expect(windowOf(question, NOW, TZ)).toEqual({ from: at(from), to: NOW, label });
  });
});

describe('colloquial and unit-only phrases (BK-85)', () => {
  it('reads "minggu kemarin" as last week and "bulan kemarin" as last month', () => {
    expect(windowOf('berapa kali down minggu kemarin?', NOW, TZ)).toMatchObject({ from: at('2026-11-09T00:00:00'), to: at('2026-11-16T00:00:00'), label: 'last week' });
    expect(windowOf('bulan kemarin ada apa?', NOW, TZ)).toMatchObject({ label: 'last month' });
  });

  it.each([
    ['any problems in the last hour?', 3_600, 'the last hour'],
    ['ada masalah dalam the past day', DAY, 'the last day'],
    ['in the past week', 7 * DAY, 'the last week'],
    ['dua hari terakhir', 2 * DAY, 'the last 2 days'],
    ['tiga jam terakhir ada apa?', 3 * 3_600, 'the last 3 hours'],
    ['in the last two hours', 2 * 3_600, 'the last 2 hours'],
    ['lima menit lalu', 300, 'the last 5 minutes'],
  ])('reads "%s" as a span back from now', (question, seconds, label) => {
    expect(windowOf(question, NOW, TZ)).toEqual({ from: NOW - seconds, to: NOW, label });
  });

  it('reads this evening, tonight and malam ini once the evening has begun, and gives no window before it', () => {
    const evening = at('2026-11-18T20:00:00');
    for (const question of ['tonight', 'malam ini ada masalah?', 'this evening']) {
      expect(windowOf(question, evening, TZ), question).toMatchObject({ from: at('2026-11-18T18:00:00'), to: evening });
      expect(windowOf(question, NOW, TZ), question).toBeNull();
    }
    expect(windowOf('sore ini', at('2026-11-18T16:00:00'), TZ)).toMatchObject({ from: at('2026-11-18T15:00:00'), to: at('2026-11-18T16:00:00') });
  });

  it('says in the label when "ago" was read as a span from then until now', () => {
    expect(windowOf('3 days ago', NOW, TZ)).toEqual({ from: NOW - 3 * DAY, to: NOW, label: 'the last 3 days (read from "3 days ago" until now)' });
    expect(windowOf('2 hari yang lalu', NOW, TZ)).toMatchObject({ label: 'the last 2 days (read from "2 days ago" until now)' });
    expect(windowOf('5 menit lalu', NOW, TZ)).toMatchObject({ label: 'the last 5 minutes' });
  });
});

describe('the title of a report block says what it reads (BK-86)', () => {
  const REPORT_WINDOW = { from: NOW - 7 * DAY, to: NOW, label: 'the last 7 days' };
  const capacity = { days: 7, metrics: [{ key: 'cpu', label: 'CPU utilisation', rows: [{ host: 'A', avg: 1, max: 2, units: '%', metric: 'cpu' }] }] } as never;
  const noise = (from: number, to: number) => ({ from, to, windowSeconds: to - from, minSeverity: 0, truncated: false, totalEvents: 1, distinctTriggers: 1, concentration: { topN: 1, percentOfEvents: 100 }, counts: { flapping: 0, unactioned: 0, chronic: 0 }, thresholds: { shortSeconds: 300, minCount: 5 }, total: 0, triggers: [] }) as never;
  const triggers = { triggers: [], truncated: false, days: 7 } as never;
  const title = (text: string) => text.split('\n')[0];

  it('uses the words of the window only when it is the span the report reads, back from now', () => {
    expect(title(capacitySection(capacity, { window: REPORT_WINDOW, tz: TZ, budget: 900, now: NOW }).text)).toContain('the last 7 days, from Wed 11 Nov 12:30 to Wed 18 Nov 12:30 (Asia/Jakarta)');
    expect(title(topTriggersSection(triggers, { window: REPORT_WINDOW, tz: TZ, budget: 900, now: NOW }).text)).toContain('from Wed 11 Nov 12:30 to Wed 18 Nov 12:30');
    expect(title(noiseSection(noise(NOW - 7 * DAY, NOW), { window: REPORT_WINDOW, tz: TZ, budget: 900, now: NOW }).text)).toContain('from Wed 11 Nov 12:30 to Wed 18 Nov 12:30');
  });

  it('says the last N days counted back from now, with the range it reads, when the question named another window', () => {
    const lastWeek = windowOf('alert noise minggu lalu', NOW, TZ)!;
    for (const text of [
      capacitySection(capacity, { window: lastWeek, tz: TZ, budget: 900, now: NOW }).text,
      topTriggersSection(triggers, { window: lastWeek, tz: TZ, budget: 900, now: NOW }).text,
      noiseSection(noise(NOW - 7 * DAY, NOW), { window: lastWeek, tz: TZ, budget: 900, now: NOW }).text,
    ]) {
      expect(title(text)).toContain('the last 7 days counted back from now, not last week, from Wed 11 Nov 12:30 to Wed 18 Nov 12:30 (Asia/Jakarta)');
      expect(title(text)).not.toContain('Mon 9 Nov');
    }
  });

  it('says so for a day, a night and a part of the week as well', () => {
    for (const question of ['alert noise kemarin', 'alert noise tadi malam', 'alert noise minggu ini']) {
      const w = windowOf(question, NOW, TZ)!;
      const text = noiseSection(noise(NOW - DAY, NOW), { window: w, tz: TZ, budget: 900, now: NOW }).text;
      expect(title(text), question).toContain(`counted back from now, not ${w.label}`);
    }
  });

  it('keeps the plain words when the question named no window', () => {
    expect(title(capacitySection(capacity, { window: null, tz: TZ, budget: 900, now: NOW }).text)).toBe('CAPACITY over the last 7 days, the busiest hosts by peak:');
  });
});

describe('the words that start the Capacity report (BK-87)', () => {
  it.each(['Berapa kapasitas link internet di Surabaya?', 'capacity of the WAN link', 'what is the bandwidth capacity of the VPN?', 'kapasitas jalur ISP Surabaya', 'link capacity at Jakarta'])('do not, in "%s": it is about a link', (question) => {
    expect(topicsOf(question).capacity).toBe(false);
  });

  it.each(['host mana yang paling penuh minggu ini?', 'which hosts are nearly full?', 'forecast disk growth for the next month', 'prediksi pertumbuhan disk', 'kapasitas disk 4.3.3 FPSO ARUBA 3', 'what is the CPU capacity trend this week'])('do, in "%s"', (question) => {
    expect(topicsOf(question).capacity).toBe(true);
  });

  it('wait for a host or a metric when the only word is capacity, and say that a host would do', () => {
    expect(topicsOf('berapa kapasitas?').capacity).toBe(false);
    expect(topicsOf('berapa kapasitas?').capacityOfHost).toBe(true);
    expect(topicsOf('halo').capacityOfHost).toBe(false);
  });
});

describe('month names in a question about the SLA (BK-87)', () => {
  it('does not read the modal "may" as May, and this month wins', () => {
    const w = slaWindowOf('Which sites may miss their SLA this month?', NOW, TZ);
    expect(w?.label).toBe('this month');
    expect(slaWindowOf('which sites may miss their SLA?', NOW, TZ)).toBeNull();
    expect(slaWindowOf('SLA bulan ini mar dan dec', NOW, TZ)?.label).toBe('this month');
  });

  it.each([
    ['SLA in May 2026', 'May 2026'],
    ['SLA for May', 'May 2026'],
    ['SLA bulan mei', 'May 2026'],
    ['SLA mei', 'May 2026'],
    ['sla may 2026', 'May 2026'],
    ['availability in dec', 'December 2025'],
    ['SLA for mar 2026', 'March 2026'],
    ['sla desember', 'December 2025'],
    ['availability october 2025', 'October 2025'],
    ['SLA bulan Oktober berapa?', 'October 2026'],
  ])('still reads "%s" as %s', (question, label) => {
    expect(slaWindowOf(question, NOW, TZ)?.label).toBe(label);
  });

  it('does not read a bare abbreviation that is also a word', () => {
    expect(slaWindowOf('will the SLA mar our record', NOW, TZ)).toBeNull();
    expect(slaWindowOf('SLA dec', NOW, TZ)).toBeNull();
  });
});

describe('MAC in a question (BK-87)', () => {
  it('is not the site MOPU / MAC when it is a MAC address, and is the site when it is a name', () => {
    expect(sitesNamed('What is the MAC address of switch X?')).toEqual([]);
    expect(sitesNamed('alamat MAC switch X berapa?')).toEqual([]);
    expect(sitesNamed('show the MAC table of the core switch')).toEqual([]);
    // The address words are read in any case: a question is typed as people type, and the site name alone is the one that wants capitals.
    expect(sitesNamed('What is the MAC Address of switch X?')).toEqual([]);
    expect(sitesNamed('Alamat MAC switch X berapa?')).toEqual([]);
    expect(sitesNamed('MAC ADDRESS table of the core switch')).toEqual([]);
    expect(sitesNamed('Show me the Mac Table')).toEqual([]);
    expect(sitesNamed('Ada yang down di MAC Tabel?')).toEqual([]);
    expect(sitesNamed('mac address of switch X')).toEqual([]);
    expect(sitesNamed('Ada yang down di MAC?').map((s) => s.name)).toEqual(['MOPU / MAC']);
    expect(sitesNamed('Ada yang down di MOPU?').map((s) => s.name)).toEqual(['MOPU / MAC']);
  });
});
