import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BadRequestError } from '../core/validate.js';
import { monthWindow } from '../services/incidents.js';
import { monthBounds } from '../sli/time.js';

// BK-42: the 400-day limit and its two sentences exist once, in `checkPeriodStart`, and every report window asks it.
const TZ = 'Asia/Jakarta';

afterEach(() => vi.useRealTimers());

const at = (seconds: number) => {
  vi.useFakeTimers();
  vi.setSystemTime(seconds * 1000);
};

describe('monthWindow', () => {
  it('refuses a month that starts this very second, as the engine and the mail route do', () => {
    const { from } = monthBounds('2026-12', TZ);
    at(from);
    expect(() => monthWindow('2026-12')).toThrow(new BadRequestError('That period has not started yet.'));
  });

  it('accepts a month that started one second ago and clips its end to now', () => {
    const { from, to } = monthBounds('2026-12', TZ);
    at(from + 1);
    expect(monthWindow('2026-12')).toEqual({ from, to: from + 1 });
    expect(to).toBeGreaterThan(from + 1);
  });

  it('refuses a month that began more than 400 days ago, in the same sentence', () => {
    const { from } = monthBounds('2025-01', TZ);
    at(from + 401 * 86400);
    expect(() => monthWindow('2025-01')).toThrow(new BadRequestError('Zabbix keeps events for about a year; pick a later period.'));
  });
});

describe('the limit of a report period', () => {
  it('is written in one place of the server', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__') walk(path);
        } else if (name.endsWith('.ts') && readFileSync(path, 'utf8').includes('Zabbix keeps events for about a year')) {
          found.push(path.slice(root.length));
        }
      }
    };
    walk(root);
    expect(found).toEqual([join('sli', 'time.ts')]);
  });
});
