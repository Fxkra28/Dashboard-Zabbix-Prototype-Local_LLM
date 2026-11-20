import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SliProfile } from '../core/config.js';
import { buildEstate, NOW_ISO, serveFixture, wib } from './helpers/sliEstate.js';

/**
 * The derived SLA as it was before the engine was split into reading and evaluating (ADR-0018): reports of a made-up estate (helpers/sliEstate.ts), for
 * both methods, as the engine made them, kept as files. They pin every figure of a month, of a window across months and of a window inside one, so that the split,
 * the daily hours and the ranges cannot move a digit that HCML reads. Run with UPDATE_GOLDEN=1 to write them again, only when a figure is meant to change.
 */

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const estate = buildEstate();
const DIR = fileURLToPath(new URL('./golden/sli/', import.meta.url));

interface Scenario {
  name: string;
  request: { month: string } | { from: number; to: number };
  declared?: [number, number][];
}

const SCENARIOS: Scenario[] = [
  { name: 'jun-closed', request: { month: '2026-06' } },
  { name: 'jul-closed', request: { month: '2026-07' } },
  { name: 'aug-closed', request: { month: '2026-08' } },
  { name: 'sep-open', request: { month: '2026-09' } },
  { name: 'aug-declared', request: { month: '2026-08' }, declared: [[wib('2026-08-15 10:00'), wib('2026-08-15 16:30')]] },
  { name: 'window-jun-aug', request: { from: wib('2026-06-10 00:00'), to: wib('2026-08-20 00:00') } },
  { name: 'window-in-aug', request: { from: wib('2026-08-10 00:00'), to: wib('2026-08-20 00:00') } },
  { name: 'window-aug-sep', request: { from: wib('2026-08-25 00:00'), to: wib('2026-09-20 00:00') } },
];

const PROFILES: SliProfile[] = ['availability', 'hcml-report'];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(async () => {
  vi.useRealTimers();
  zbxMock.mockReset();
  (await import('../core/config.js')).config.sla.noDataWindows = [];
});

describe('computeSli against the reports kept before the split', () => {
  for (const scenario of SCENARIOS) {
    for (const profile of PROFILES) {
      it(`${scenario.name}, ${profile}`, async () => {
        serveFixture(zbxMock, estate);
        const { config } = await import('../core/config.js');
        config.sla.noDataWindows = scenario.declared ?? [];
        const { computeSli } = await import('../sli/engine.js');
        const report = await computeSli({ profile, ...scenario.request });
        const made = JSON.parse(JSON.stringify({ ...report, generatedAt: 0, stats: { ...report.stats, ms: 0 } }));

        const file = `${DIR}${scenario.name}.${profile}.json`;
        if (process.env.UPDATE_GOLDEN === '1') {
          mkdirSync(DIR, { recursive: true });
          writeFileSync(file, `${JSON.stringify(made, null, 1)}\n`);
        }
        expect(made).toEqual(JSON.parse(readFileSync(file, 'utf8')));
      });
    }
  }

  it('has hosts, a WAN path, web checks and gaps to hold, so that the files say something', async () => {
    serveFixture(zbxMock, estate);
    const { computeSli } = await import('../sli/engine.js');
    const strict = await computeSli({ profile: 'availability', month: '2026-08' });
    expect(strict.hosts.length).toBe(11);
    expect(strict.wanPaths.map((p) => p.name)).toEqual(['SAMPANG']);
    expect(strict.web.length).toBe(2);
    expect(strict.hosts.some((h) => h.dataStatus === 'partial')).toBe(true);
    expect(strict.hosts.some((h) => h.dataStatus === 'nodata')).toBe(true);
    expect(strict.hosts.some((h) => h.maintenance > 0)).toBe(true);
    const july = await computeSli({ profile: 'availability', month: '2026-07' });
    expect(july.gaps.length).toBeGreaterThan(0);
    const hcml = await computeSli({ profile: 'hcml-report', month: '2026-08' });
    expect(hcml.web).toEqual([]);
    expect(hcml.hosts.some((h) => h.incidents > 1)).toBe(true);
  });
});
