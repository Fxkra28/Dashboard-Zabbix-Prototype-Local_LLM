import { describe, expect, it } from 'vitest';
import { windowOf, windowWords } from '../services/assistantWhen.js';

/**
 * The time a question is about, in the words people use for it in English and in Bahasa Indonesia, cut in the SLA time zone like every other day, week and month of the portal. The window that
 * was understood is always written out in the prompt, so a wrong reading is seen and not trusted.
 */

const TZ = 'Asia/Jakarta';
/** Wednesday 18 November 2026, 12:30 in Jakarta. */
const NOW = Date.parse('2026-11-18T05:30:00Z') / 1000;
const at = (iso: string) => Date.parse(`${iso}+07:00`) / 1000;

const win = (q: string) => {
  const w = windowOf(q, NOW, TZ);
  return w && { from: w.from, to: w.to };
};

describe('windowOf: a span counted back from now', () => {
  it('reads a span written as one word, "seminggu terakhir" and "sebulan belakangan", and months and years in a count', () => {
    expect(windowOf('2 minggu terakhir', NOW, TZ)).toMatchObject({ from: NOW - 14 * 86_400, to: NOW, label: 'the last 2 weeks' });
    expect(windowOf('5 menit lalu', NOW, TZ)).toMatchObject({ from: NOW - 300, to: NOW });
    expect(windowOf('grafik suhu seminggu terakhir', NOW, TZ)).toMatchObject({ from: NOW - 7 * 86_400, to: NOW, label: 'the last week' });
    expect(windowOf('CPU sehari terakhir', NOW, TZ)).toMatchObject({ from: NOW - 86_400, to: NOW });
    expect(windowOf('sejam terakhir', NOW, TZ)).toMatchObject({ from: NOW - 3_600, to: NOW });
    expect(windowOf('masalah sebulan belakangan', NOW, TZ)).toMatchObject({ from: NOW - 30 * 86_400, to: NOW });
    expect(windowOf('2 bulan terakhir', NOW, TZ, 90)).toMatchObject({ from: NOW - 60 * 86_400, to: NOW });
    expect(windowOf('last 3 months', NOW, TZ, 366)).toMatchObject({ from: NOW - 90 * 86_400, to: NOW });
    expect(windowOf('setahun terakhir', NOW, TZ, 366)).toMatchObject({ from: NOW - 365 * 86_400, to: NOW });
  });

  it('cuts a longer span to the most that was asked for, and says so', () => {
    expect(windowOf('3 bulan terakhir', NOW, TZ)).toMatchObject({ from: NOW - 31 * 86_400, to: NOW, label: 'the last 3 months (cut to the last 31 days)' });
  });

  it('reads "last N hours" and "N jam terakhir", in minutes, hours, days and weeks', () => {
    expect(win('any problems in the last 3 hours?')).toEqual({ from: NOW - 3 * 3600, to: NOW });
    expect(win('ada masalah 3 jam terakhir?')).toEqual({ from: NOW - 3 * 3600, to: NOW });
    expect(win('past 45 minutes')).toEqual({ from: NOW - 45 * 60, to: NOW });
    expect(win('dalam 2 hari terakhir ada apa saja')).toEqual({ from: NOW - 2 * 86400, to: NOW });
    expect(win('last 2 weeks')).toEqual({ from: NOW - 14 * 86400, to: NOW });
    expect(win('5 menit lalu')).toEqual({ from: NOW - 5 * 60, to: NOW });
  });

  it('reads "just now" as the last hour', () => {
    expect(win('barusan ada yang mati?')).toEqual({ from: NOW - 3600, to: NOW });
    expect(win('what just happened?')).toEqual({ from: NOW - 3600, to: NOW });
  });

  it('never goes back more than 31 days, and says so', () => {
    const w = windowOf('last 90 days', NOW, TZ)!;
    expect(w.from).toBe(NOW - 31 * 86400);
    expect(w.label).toContain('cut to the last 31 days');
  });
});

describe('windowOf: a day or part of one', () => {
  it('reads today, and yesterday as the whole of the day before', () => {
    expect(win('hari ini ada apa?')).toEqual({ from: at('2026-11-18T00:00:00'), to: NOW });
    expect(win('what happened today')).toEqual({ from: at('2026-11-18T00:00:00'), to: NOW });
    expect(win('kemarin ada masalah apa?')).toEqual({ from: at('2026-11-17T00:00:00'), to: at('2026-11-18T00:00:00') });
    expect(win('yesterday')).toEqual({ from: at('2026-11-17T00:00:00'), to: at('2026-11-18T00:00:00') });
  });

  it('reads last night as the evening before and the early morning after it', () => {
    const night = { from: at('2026-11-17T18:00:00'), to: at('2026-11-18T06:00:00') };
    expect(win('tadi malam ada apa?')).toEqual(night);
    expect(win('semalam')).toEqual(night);
    expect(win('what happened last night')).toEqual(night);
  });

  it('reads a part of a day, and does not go past now', () => {
    expect(win('kemarin sore')).toEqual({ from: at('2026-11-17T15:00:00'), to: at('2026-11-17T18:00:00') });
    expect(win('kemarin malam')).toEqual({ from: at('2026-11-17T18:00:00'), to: at('2026-11-18T00:00:00') });
    expect(win('tadi pagi')).toEqual({ from: at('2026-11-18T05:00:00'), to: at('2026-11-18T11:00:00') });
    expect(win('this morning')).toEqual({ from: at('2026-11-18T05:00:00'), to: at('2026-11-18T11:00:00') });
    // The afternoon has not ended at 12:30: it runs to now, not to 15:00.
    expect(win('siang ini')).toEqual({ from: at('2026-11-18T11:00:00'), to: NOW });
  });
});

describe('windowOf: a week or a month', () => {
  it('reads this week from Monday, and last week as the Monday to Monday before it', () => {
    expect(win('minggu ini')).toEqual({ from: at('2026-11-16T00:00:00'), to: NOW });
    expect(win('this week')).toEqual({ from: at('2026-11-16T00:00:00'), to: NOW });
    expect(win('minggu lalu')).toEqual({ from: at('2026-11-09T00:00:00'), to: at('2026-11-16T00:00:00') });
    expect(win('last week')).toEqual({ from: at('2026-11-09T00:00:00'), to: at('2026-11-16T00:00:00') });
  });

  it('reads this month, and last month as the whole of the one before, as the SLA does', () => {
    expect(win('bulan ini')).toEqual({ from: at('2026-11-01T00:00:00'), to: NOW });
    expect(win('bulan lalu')).toEqual({ from: at('2026-10-01T00:00:00'), to: at('2026-11-01T00:00:00') });
    expect(win('last month')).toEqual({ from: at('2026-10-01T00:00:00'), to: at('2026-11-01T00:00:00') });
  });
});

describe('windowOf: no time named', () => {
  it('gives nothing for a question about now', () => {
    expect(windowOf('Ada yang down di Surabaya?', NOW, TZ)).toBeNull();
    expect(windowOf('what is the CPU of the core switch', NOW, TZ)).toBeNull();
  });

  it('does not read a host name or a site name as a time', () => {
    expect(windowOf('is 4.3.3 FPSO ARUBA 3 up?', NOW, TZ)).toBeNull();
    expect(windowOf('status 5.2.1 PAS_IE3200_AS01 sekarang', NOW, TZ)).toBeNull();
  });
});

describe('windowWords', () => {
  it('writes the window out, so that the reader and the model see what was understood', () => {
    const night = windowOf('tadi malam', NOW, TZ)!;
    expect(windowWords(night, TZ)).toBe('last night, from Tue 17 Nov 18:00 to Wed 18 Nov 06:00 (Asia/Jakarta)');
    const hours = windowOf('last 3 hours', NOW, TZ)!;
    expect(windowWords(hours, TZ)).toBe('the last 3 hours, from Wed 18 Nov 09:30 to Wed 18 Nov 12:30 (Asia/Jakarta)');
  });
});

// BK-85, three misreads that came out of the recheck: a greeting is not a part of the day, a count in front of "lalu" is not dropped, and "from this host" is not "from this week".
describe('windowOf: words that look like time and are not', () => {
  it('does not take a greeting for a part of the day', () => {
    const today = { from: at('2026-11-18T00:00:00'), to: NOW, label: 'today' };
    expect(windowOf('Selamat pagi, ada alert apa hari ini?', NOW, TZ)).toEqual(today);
    expect(windowOf('selamat siang, ada masalah hari ini?', NOW, TZ)).toEqual(today);
    expect(windowOf('Good morning, what happened today?', NOW, TZ)).toEqual(today);
    expect(windowOf('Selamat malam, tadi ada alert?', NOW, TZ)).toEqual(today);
    expect(windowOf('Selamat pagi, ada alert?', NOW, TZ)).toBeNull();
    // A part of the day that is asked for is still read.
    expect(windowOf('alert tadi pagi', NOW, TZ)).toMatchObject({ label: 'this morning' });
    expect(windowOf('alert kemarin sore', NOW, TZ)).toMatchObject({ label: 'yesterday afternoon' });
    expect(windowOf('Selamat pagi, alert kemarin sore?', NOW, TZ)).toMatchObject({ label: 'yesterday afternoon' });
  });

  it('keeps the number in "2 minggu lalu" and "3 bulan lalu", as "2 weeks ago" keeps it, and still reads "minggu lalu" as last week', () => {
    expect(windowOf('2 minggu lalu', NOW, TZ)).toMatchObject({ from: NOW - 14 * 86_400, to: NOW });
    expect(windowOf('alert 3 bulan lalu', NOW, TZ)).toMatchObject({ from: NOW - 31 * 86_400, to: NOW, label: 'the last 3 months (cut to the last 31 days)' });
    expect(windowOf('2 weeks ago', NOW, TZ)).toMatchObject({ from: NOW - 14 * 86_400, to: NOW });
    expect(windowOf('minggu lalu', NOW, TZ)).toMatchObject({ from: at('2026-11-09T00:00:00'), to: at('2026-11-16T00:00:00'), label: 'last week' });
    expect(windowOf('bulan lalu', NOW, TZ)).toMatchObject({ label: 'last month' });
    expect(windowOf('last week', NOW, TZ)).toMatchObject({ label: 'last week' });
  });

  it('runs "from" to now for a time and not for "this host" or "last link"', () => {
    expect(windowOf('alerts from this host yesterday', NOW, TZ)).toMatchObject({ from: at('2026-11-17T00:00:00'), to: at('2026-11-18T00:00:00'), label: 'yesterday' });
    expect(windowOf('what did the last switch say yesterday', NOW, TZ)).toMatchObject({ label: 'yesterday' });
    expect(windowOf('problems from yesterday', NOW, TZ)).toMatchObject({ to: NOW, label: 'since yesterday' });
    expect(windowOf('problems from last week', NOW, TZ)).toMatchObject({ to: NOW, label: 'since last week' });
    expect(windowOf('dari minggu lalu', NOW, TZ)).toMatchObject({ to: NOW, label: 'since last week' });
    expect(windowOf('from this morning', NOW, TZ)).toMatchObject({ to: NOW });
    expect(windowOf('from this week', NOW, TZ)).toMatchObject({ label: 'this week' });
  });
});
