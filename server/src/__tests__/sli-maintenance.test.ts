import { describe, expect, it } from 'vitest';
import { maintenanceWindows, type ZMaintenance, type ZTimeperiod } from '../sli/maintenance.js';

/**
 * Zabbix maintenance schedules as concrete windows. August
 * 2026 in Asia/Jakarta: the 1st is a Saturday, the last Sunday is the 30th, and
 * local midnight on day d is A + (d - 1) days.
 */
const TZ = 'Asia/Jakarta';
const A = 1785517200; // 2026-08-01 00:00 WIB
const D = 86400;
const AUG_END = A + 31 * D;

const maint = (timeperiods: ZTimeperiod[], over: Partial<ZMaintenance> = {}): ZMaintenance => ({
  maintenanceid: '1',
  active_since: String(A),
  active_till: String(A + 60 * D),
  timeperiods,
  ...over,
});
const at = (day: number, seconds: number) => A + (day - 1) * D + seconds;

describe('maintenanceWindows', () => {
  it('reads a one-time period as its start plus its length', () => {
    const m = maint([{ timeperiod_type: '0', start_date: String(at(11, 3600)), period: '7200' }]);
    expect(maintenanceWindows(m, A, AUG_END, TZ)).toEqual([[at(11, 3600), at(11, 10800)]]);
  });

  it('clips every window to the maintenance active period and to the range asked for', () => {
    const m = maint([{ timeperiod_type: '0', start_date: String(at(11, 0)), period: String(2 * D) }], {
      active_till: String(at(12, 0)),
    });
    expect(maintenanceWindows(m, A, AUG_END, TZ)).toEqual([[at(11, 0), at(12, 0)]]);
    expect(maintenanceWindows(m, at(11, 3600), AUG_END, TZ)).toEqual([[at(11, 3600), at(12, 0)]]);
  });

  it('repeats a daily period every N days from the active day, at the local start time', () => {
    const m = maint([{ timeperiod_type: '2', every: '2', start_time: String(22 * 3600), period: String(4 * 3600) }]);
    expect(maintenanceWindows(m, A, at(8, 0), TZ)).toEqual([
      [at(1, 22 * 3600), at(2, 2 * 3600)],
      [at(3, 22 * 3600), at(4, 2 * 3600)],
      [at(5, 22 * 3600), at(6, 2 * 3600)],
      [at(7, 22 * 3600), at(8, 0)],
    ]);
  });

  it('keeps the part of a window that began the day before the range', () => {
    const m = maint([{ timeperiod_type: '2', every: '1', start_time: String(22 * 3600), period: String(4 * 3600) }]);
    expect(maintenanceWindows(m, at(2, 0), at(2, 12 * 3600), TZ)).toEqual([[at(2, 0), at(2, 2 * 3600)]]);
  });

  it('repeats a weekly period on its weekdays, every N weeks', () => {
    const saturday = { timeperiod_type: '3', dayofweek: '32', start_time: String(22 * 3600), period: '3600' };
    const weekly = maintenanceWindows(maint([{ ...saturday, every: '1' }]), A, AUG_END, TZ);
    expect(weekly.map(([s]) => s)).toEqual([1, 8, 15, 22, 29].map((d) => at(d, 22 * 3600)));
    const fortnightly = maintenanceWindows(maint([{ ...saturday, every: '2' }]), A, AUG_END, TZ);
    expect(fortnightly.map(([s]) => s)).toEqual([1, 15, 29].map((d) => at(d, 22 * 3600)));
  });

  it('runs a monthly period on a day of the month, or on the Nth or last weekday, in the months it names', () => {
    const august = String(1 << 7);
    const byDay = maint([{ timeperiod_type: '4', month: august, day: '15', start_time: '7200', period: '3600' }]);
    expect(maintenanceWindows(byDay, A, AUG_END, TZ)).toEqual([[at(15, 7200), at(15, 10800)]]);

    const firstMonday = maint([{ timeperiod_type: '4', month: august, day: '0', every: '1', dayofweek: '1', start_time: '0', period: '3600' }]);
    expect(maintenanceWindows(firstMonday, A, AUG_END, TZ)).toEqual([[at(3, 0), at(3, 3600)]]);

    const lastSunday = maint([{ timeperiod_type: '4', month: august, day: '0', every: '5', dayofweek: '64', start_time: '0', period: '3600' }]);
    expect(maintenanceWindows(lastSunday, A, AUG_END, TZ)).toEqual([[at(30, 0), at(30, 3600)]]);

    const julyOnly = maint([{ timeperiod_type: '4', month: String(1 << 6), day: '15', start_time: '0', period: '3600' }]);
    expect(maintenanceWindows(julyOnly, A, AUG_END, TZ)).toEqual([]);
  });

  it('returns nothing for a maintenance outside the range', () => {
    const m = maint([{ timeperiod_type: '0', start_date: String(A - 10 * D), period: '3600' }], {
      active_since: String(A - 20 * D),
      active_till: String(A - D),
    });
    expect(maintenanceWindows(m, A, AUG_END, TZ)).toEqual([]);
  });
});
