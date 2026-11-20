import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../core/cache.js';
import { buildSnapshot, SNAPSHOT_CHAR_CAP } from '../services/assistant.js';
import { getProblems } from '../domain/queries.js';
import { getSites } from '../services/sites.js';
import { getSlas, getSli } from '../services/sla.js';
import { getServiceTree } from '../services/services.js';
import { derivedServiceLines, derivedSlaLines } from '../sli/summary.js';

/**
 * The made-up estate that the model bake-off asks its questions about (scripts/bakeoff, P3.2). It is built by the portal's own snapshot code from the invented data below, so the text is in the
 * format the model really reads, and the test fails when the builder's format moves and the kept copy has not: run it again with UPDATE_BAKEOFF=1. Nothing here is HCML's.
 */

vi.mock('../domain/queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/queries.js')>();
  const { cached } = await import('../core/cache.js');
  const getProblems = vi.fn();
  return { ...actual, getProblems, getHostsWithMeta: vi.fn(), cachedProblems: () => cached('problems', actual.PROBLEMS_TTL_MS, getProblems), withOpdata: async (problems: unknown[]) => problems };
});
vi.mock('../services/sites.js', async () => {
  const { cached } = await import('../core/cache.js');
  const getSites = vi.fn();
  return { getSites, sitesView: () => cached('sites', 15_000, getSites) };
});
vi.mock('../services/sla.js', async () => {
  const { cached } = await import('../core/cache.js');
  const getSlas = vi.fn();
  const getSli = vi.fn();
  return { getSlas, getSli, slasView: () => cached('sla', 60_000, getSlas), sliView: (slaid: string, serviceid?: string) => cached(`sli:${slaid}:${serviceid ?? 'all'}`, 60_000, () => getSli(slaid, serviceid)) };
});
vi.mock('../services/services.js', async () => {
  const { cached } = await import('../core/cache.js');
  const getServiceTree = vi.fn();
  return { getServiceTree, serviceTreeView: () => cached('services:tree', 30_000, getServiceTree) };
});
vi.mock('../sli/summary.js', () => ({ derivedSlaLines: vi.fn(), derivedServiceLines: vi.fn() }));
// The made-up estate has no gauge on a dashboard, so the snapshot of the bake-off has no internet part.
vi.mock('../services/meters.js', () => ({ metersView: vi.fn(async () => ({ meters: [], generatedAt: 0, found: false })) }));

const FILE = fileURLToPath(new URL('../../scripts/bakeoff/snapshot.txt', import.meta.url));
const NOW = Date.parse('2026-11-17T05:00:00Z') / 1000;
const ago = (minutes: number) => String(NOW - minutes * 60);

type State = 'up' | 'down' | 'degraded' | 'nodata';
const HOSTS: { site: string; hostid: string; name: string; state: State }[] = [
  { site: 'Jakarta', hostid: '101', name: '1.1 ALPHA-FW01', state: 'up' },
  { site: 'Jakarta', hostid: '102', name: '1.2.1 ALPHA-SW01', state: 'up' },
  { site: 'Jakarta', hostid: '103', name: '1.2.2 ALPHA-SW02', state: 'up' },
  { site: 'Jakarta', hostid: '104', name: '1.3 ALPHA-AP01', state: 'up' },
  { site: 'Surabaya', hostid: '201', name: '2.1 BRAVO-FW01', state: 'up' },
  { site: 'Surabaya', hostid: '202', name: '2.2.1 BRAVO-SW01', state: 'down' },
  { site: 'Surabaya', hostid: '203', name: '2.2.2 BRAVO-SW02', state: 'up' },
  { site: 'Surabaya', hostid: '204', name: '2.3.1 BRAVO-AP01', state: 'up' },
  { site: 'Surabaya', hostid: '205', name: '2.3.2 BRAVO-AP02', state: 'up' },
  { site: 'SSB / Sampang', hostid: '301', name: '3.1 CHARLIE-FW01', state: 'up' },
  { site: 'SSB / Sampang', hostid: '302', name: '3.2.1 CHARLIE-SW01', state: 'up' },
  { site: 'SSB / Sampang', hostid: '303', name: 'INET : SAMPANG WAN 1', state: 'up' },
  { site: 'SSB / Sampang', hostid: '304', name: 'INET : SAMPANG WAN 2', state: 'down' },
  { site: 'FPSO KAS3 & BD-WHP', hostid: '401', name: '4.1 DELTA-FW01', state: 'up' },
  { site: 'FPSO KAS3 & BD-WHP', hostid: '402', name: '4.2.1 DELTA-SW01', state: 'down' },
  { site: 'FPSO KAS3 & BD-WHP', hostid: '403', name: '4.3.1 DELTA-AP01', state: 'down' },
  { site: 'FPSO KAS3 & BD-WHP', hostid: '404', name: '4.3.2 DELTA-AP02', state: 'down' },
  { site: 'FPSO KAS3 & BD-WHP', hostid: '405', name: '4.3.3 DELTA-AP03', state: 'up' },
  { site: 'FPSO KAS3 & BD-WHP', hostid: '406', name: '4.4 DELTA-RADIO01', state: 'degraded' },
  { site: 'Pasuruan / GMS', hostid: '501', name: '5.1 ECHO-FW01', state: 'up' },
  { site: 'Pasuruan / GMS', hostid: '502', name: '5.2.1 ECHO-SW01', state: 'up' },
  { site: 'Sumenep', hostid: '601', name: '6.1 FOXTROT-FW01', state: 'up' },
  { site: 'Sumenep', hostid: '602', name: '6.2.1 FOXTROT-SW01', state: 'up' },
  { site: 'Sumenep', hostid: '603', name: '6.3 FOXTROT-AP01', state: 'nodata' },
];

// [eventid, host, name, severity, minutes open, acknowledged]
const PROBLEMS: [string, string, string, number, number, boolean][] = [
  ['9001', '4.2.1 DELTA-SW01', 'Unavailable by ICMP ping', 5, 30, false],
  ['9002', '4.3.1 DELTA-AP01', 'Unavailable by ICMP ping', 4, 45, false],
  ['9003', '4.3.2 DELTA-AP02', 'Unavailable by ICMP ping', 4, 45, false],
  ['9004', '2.2.1 BRAVO-SW01', 'Unavailable by ICMP ping', 4, 300, true],
  ['9005', 'INET : SAMPANG WAN 2', 'Unavailable by ICMP ping', 4, 2880, true],
  ['9006', '4.4 DELTA-RADIO01', 'High ICMP ping loss', 3, 240, false],
  ['9007', '2.3.1 BRAVO-AP01', 'High ICMP ping loss', 3, 90, false],
  ['9008', '1.2.1 ALPHA-SW01', 'Interface Gi1/0/12: Link down', 3, 120, false],
  ['9009', '1.2.2 ALPHA-SW02', 'High CPU utilization', 3, 600, true],
  ['9010', '3.2.1 CHARLIE-SW01', 'Interface Gi1/0/3: High error rate', 2, 1440, true],
  ['9011', '5.2.1 ECHO-SW01', 'Interface Gi1/0/8: Link down', 2, 4320, true],
  ['9012', '6.2.1 FOXTROT-SW01', 'High memory utilization', 2, 15, false],
  ['9013', '1.1 ALPHA-FW01', 'High memory utilization', 2, 200, false],
  ['9014', '2.1 BRAVO-FW01', 'Disk space is low', 2, 5000, true],
  ['9015', '4.1 DELTA-FW01', 'High ICMP ping loss', 2, 25, false],
  ['9016', '6.1 FOXTROT-FW01', 'Zabbix agent is not available', 2, 10080, true],
  ['9017', '1.3 ALPHA-AP01', 'Number of clients is high', 1, 180, false],
  ['9018', '2.3.2 BRAVO-AP02', 'Number of clients is high', 1, 60, false],
  ['9019', '5.1 ECHO-FW01', 'System uptime is less than 10 minutes', 1, 8, false],
  ['9020', '3.1 CHARLIE-FW01', 'Version of Zabbix agent has changed', 1, 17280, true],
  ['9021', '6.3 FOXTROT-AP01', 'No data from the device for 30 minutes', 2, 130, false],
  ['9022', '4.3.3 DELTA-AP03', 'Interface Gi0/1: Link down', 3, 55, false],
];

const siteOf = (name: string) => {
  const hosts = HOSTS.filter((h) => h.site === name);
  const probs = PROBLEMS.filter(([, host]) => hosts.some((h) => h.name === host));
  const by = (state: State) => hosts.filter((h) => h.state === state).length;
  const bySeverity: Record<string, number> = {};
  for (const [, , , sev] of probs) bySeverity[String(sev)] = (bySeverity[String(sev)] ?? 0) + 1;
  return {
    name,
    total: hosts.length,
    available: by('up') + by('degraded'),
    unavailable: by('down'),
    unknown: by('nodata'),
    up: by('up'),
    down: by('down'),
    degraded: by('degraded'),
    nodata: by('nodata'),
    maintenance: 0,
    disabled: 0,
    problems: probs.length,
    unacknowledged: probs.filter(([, , , , , acked]) => !acked).length,
    bySeverity,
    worst: probs.reduce((m, [, , , sev]) => Math.max(m, sev), 0),
    hosts: hosts.map((h) => ({
      hostid: h.hostid,
      name: h.name,
      status: '0',
      availability: h.state === 'down' ? 'unavailable' : h.state === 'nodata' ? 'unknown' : 'available',
      state: h.state,
      reason: h.state === 'nodata' ? 'none' : 'ping',
      siteSource: 'name',
      problems: { total: probs.filter(([, host]) => host === h.name).length, bySeverity: {} },
    })),
  };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW * 1000));
  invalidate('');
  vi.mocked(getProblems).mockResolvedValue(
    PROBLEMS.map(([eventid, host, name, severity, minutes, acked]) => ({
      eventid,
      objectid: eventid,
      object: '0',
      name,
      severity: String(severity),
      clock: ago(minutes),
      r_eventid: '0',
      acknowledged: acked ? '1' : '0',
      opdata: '',
      tags: [],
      host,
      hostid: HOSTS.find((h) => h.name === host)?.hostid ?? '0',
    })) as never,
  );
  const sites = ['Jakarta', 'Surabaya', 'SSB / Sampang', 'FPSO KAS3 & BD-WHP', 'Pasuruan / GMS', 'Sumenep'].map(siteOf);
  vi.mocked(getSites).mockResolvedValue({ sites, coverage: { hosts: HOSTS.length, tag: HOSTS.length, inventory: 0, group: 0 } } as never);
  vi.mocked(getSlas).mockResolvedValue([]);
  vi.mocked(getSli).mockResolvedValue([]);
  vi.mocked(getServiceTree).mockResolvedValue({ tree: [], total: 0, degraded: 0, worst: -1 } as never);
  vi.mocked(derivedSlaLines).mockResolvedValue([
    "Derived SLA (target 99%, from ICMP triggers, not from Zabbix's own SLAs):",
    '- 2026-10: 98.42% strict, missed (23/24 devices with data)',
    "- 2026-10 by HCML's report method: 99.41% (ignores devices fully down)",
    "- 1 devices never measured (no ICMP data ever collected); HCML's method counts them as 100%",
    '- 2026-11 so far: 97.80% strict',
    '- All 3 sites below target 2026-10: FPSO KAS3 & BD-WHP 95.10%, Surabaya 97.90%, SSB / Sampang 98.50%',
    '- Worst devices 2026-10: 4.3.2 DELTA-AP02 91.20%, 4.2.1 DELTA-SW01 94.80%, INET : SAMPANG WAN 2 96.00%',
  ]);
  vi.mocked(derivedServiceLines).mockResolvedValue(['- Voice path: 96.20% this month; now: Unavailable by ICMP ping', '- Internet access: 98.10% this month; now: Unavailable by ICMP ping']);
});

describe('the estate of the model bake-off', () => {
  it('is built by the portal\'s own snapshot code, within the size the model is given, and is the copy that is kept', async () => {
    const { text, meta } = await buildSnapshot();
    expect(text.length).toBeLessThanOrEqual(SNAPSHOT_CHAR_CAP);
    expect(meta).toMatchObject({ hosts: 24, sites: 6, problems: 22 });
    if (process.env.UPDATE_BAKEOFF === '1') writeFileSync(FILE, `${text}\n`);
    expect(`${text}\n`, 'scripts/bakeoff/snapshot.txt is out of date: run this test with UPDATE_BAKEOFF=1').toBe(readFileSync(FILE, 'utf8'));
  });
});
