import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDetails, type DetailContext } from '../services/assistantDetail.js';
import { readAcks, readAcksIn } from '../services/assistantAcks.js';
import { readSlaWindow } from '../services/assistantSla.js';
import { readMaintenance } from '../services/assistantMaintenance.js';
import { linksView } from '../services/links.js';
import { getGraph } from '../services/history.js';
import { readPort } from '../services/assistantPorts.js';
import { readHostMaps, readMapNames } from '../services/assistantMaps.js';
import { getCapacityReport } from '../services/capacity.js';
import { getScorecard } from '../services/inventory.js';
import { getNoiseReport } from '../services/noise.js';
import { getTopTriggers } from '../services/reports.js';
import { webMonitoringView } from '../services/webMonitoring.js';
import { readPast } from '../services/assistantPast.js';
import { readHostValues } from '../services/assistantValues.js';
import { readHostInfo } from '../services/assistantHostInfo.js';
import { topHostsView } from '../services/topHosts.js';

vi.mock('../services/assistantMaps.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantMaps.js')>()), readHostMaps: vi.fn(), readMapNames: vi.fn() }));
vi.mock('../services/capacity.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/capacity.js')>()), getCapacityReport: vi.fn() }));
vi.mock('../services/inventory.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/inventory.js')>()), getScorecard: vi.fn() }));
vi.mock('../services/noise.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/noise.js')>()), getNoiseReport: vi.fn() }));
vi.mock('../services/reports.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/reports.js')>()), getTopTriggers: vi.fn() }));
vi.mock('../services/assistantPorts.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantPorts.js')>()), readPort: vi.fn() }));
vi.mock('../services/history.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/history.js')>()), getGraph: vi.fn() }));
vi.mock('../services/links.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/links.js')>()), linksView: vi.fn() }));
vi.mock('../services/webMonitoring.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/webMonitoring.js')>()), webMonitoringView: vi.fn() }));
vi.mock('../services/assistantMaintenance.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantMaintenance.js')>()), readMaintenance: vi.fn() }));
vi.mock('../services/assistantSla.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantSla.js')>()), readSlaWindow: vi.fn() }));
vi.mock('../services/assistantAcks.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantAcks.js')>()), readAcks: vi.fn(), readAcksIn: vi.fn() }));
vi.mock('../services/assistantPast.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantPast.js')>()), readPast: vi.fn() }));
vi.mock('../services/assistantValues.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantValues.js')>()), readHostValues: vi.fn() }));
vi.mock('../services/assistantHostInfo.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantHostInfo.js')>()), readHostInfo: vi.fn() }));
vi.mock('../services/topHosts.js', () => ({ topHostsView: vi.fn() }));

/**
 * What a question gets beyond the snapshot and the focus on a site: the problems of a past window, the latest values of a host or a site, the details of a host and the contacts behind it. Each is read
 * for the user's own pages only (ADR-0017), for what the question names, within a time and a size, and a read that fails is said to have failed, so that the model does not take silence for "none".
 */

const TZ = 'Asia/Jakarta';
const NOW = Date.parse('2026-11-18T05:30:00Z') / 1000;
const at = (iso: string) => Date.parse(`${iso}+07:00`) / 1000;

const host = (hostid: string, name: string) => ({ hostid, name }) as never;
const SURABAYA = [host('21', '2.1 BRAVO-FW01'), host('22', '2.2.1 BRAVO-SW01'), host('23', '2.3.1 BRAVO-AP01')];
const ALL_SITES = [{ name: 'Surabaya', hosts: SURABAYA }, { name: 'FPSO KAS3 & BD-WHP', hosts: [host('41', '4.3.3 FPSO ARUBA 3')] }] as never;
const SURABAYA_REF = { code: 2, name: 'Surabaya' };

const everything = (over: Partial<DetailContext> = {}): DetailContext => ({
  question: '',
  now: NOW,
  tz: TZ,
  readAt: '12:30',
  sites: [],
  hosts: [],
  allSites: ALL_SITES,
  problems: [],
  admin: true,
  operator: true,
  can: () => true,
  external: false,
  ...over,
});

beforeEach(() => {
  vi.mocked(readPast).mockReset().mockResolvedValue({ events: [], truncated: false });
  vi.mocked(readHostValues).mockReset().mockResolvedValue([]);
  vi.mocked(readHostInfo).mockReset().mockResolvedValue([]);
  vi.mocked(readSlaWindow).mockReset();
  vi.mocked(readMaintenance).mockReset().mockResolvedValue([]);
  vi.mocked(linksView).mockReset();
  vi.mocked(getGraph).mockReset();
  vi.mocked(readPort).mockReset();
  vi.mocked(readHostMaps).mockReset();
  vi.mocked(readMapNames).mockReset();
  vi.mocked(getCapacityReport).mockReset();
  vi.mocked(getNoiseReport).mockReset();
  vi.mocked(getTopTriggers).mockReset();
  vi.mocked(getScorecard).mockReset();
  vi.mocked(webMonitoringView).mockReset();
  vi.mocked(readAcks).mockReset().mockResolvedValue([]);
  vi.mocked(readAcksIn).mockReset().mockResolvedValue({ problems: [], truncated: false });
  vi.mocked(topHostsView).mockReset();
});


import { readSlaWindow as readSla } from '../services/assistantSla.js';
import { topHostsLines } from '../services/assistantValues.js';

/**
 * What a question may take from the slow reads, and how it labels what it reads (BK-88, BK-90): a place in the person's line for each heavy topic, the reader's signal passed on, the time of
 * the list that was read, and the right item for the CPU. Every name here is made up.
 */

const ARUBA_HOST = host('41', '4.3.3 FPSO ARUBA 3');
const noise = { from: NOW - 7 * 86_400, to: NOW, windowSeconds: 7 * 86_400, minSeverity: 0, truncated: false, totalEvents: 1, distinctTriggers: 1, concentration: { topN: 1, percentOfEvents: 100 }, counts: { flapping: 0, unactioned: 0, chronic: 0 }, thresholds: { shortSeconds: 300, minCount: 5 }, total: 0, triggers: [] } as never;

describe('a place in the line of the heavy reports for each heavy topic (BK-88)', () => {
  it('takes one for the noise report, one for the capacity trends and one for the top triggers, and reads them', async () => {
    vi.mocked(getNoiseReport).mockResolvedValue(noise);
    vi.mocked(getCapacityReport).mockResolvedValue({ days: 7, metrics: [] } as never);
    vi.mocked(getTopTriggers).mockResolvedValue({ days: 7, triggers: [], truncated: false } as never);
    const heavy = vi.fn(() => () => undefined);
    await buildDetails(everything({ question: 'alert noise, forecast and top triggers this week', places: { heavy, sla: () => () => undefined } }));
    expect(heavy).toHaveBeenCalledTimes(3);
    expect(getNoiseReport).toHaveBeenCalled();
    expect(getTopTriggers).toHaveBeenCalled();
  });

  it('says in the block that the person already has four reports being prepared, and reads nothing, when no place is left', async () => {
    const { blocks } = await buildDetails(everything({ question: 'alert noise minggu ini', places: { heavy: () => null, sla: () => () => undefined } }));
    expect(blocks.join('\n')).toMatch(/ALERT NOISE: not read: you already have 4 reports being prepared/);
    expect(getNoiseReport).not.toHaveBeenCalled();
  });

  it('takes a place in the line of the SLA reads for a window the snapshot does not hold, and says so when none is left', async () => {
    vi.mocked(readSlaWindow).mockResolvedValue({ target: 99.9, overall: { sli: 99.99, meeting: true, withData: 3, hosts: 3 }, sites: [], hosts: [] } as never);
    const taken = vi.fn(() => () => undefined);
    await buildDetails(everything({ question: 'SLA bulan September berapa?', places: { heavy: () => () => undefined, sla: taken } }));
    expect(taken).toHaveBeenCalledTimes(1);
    const refused = await buildDetails(everything({ question: 'SLA bulan September berapa?', places: { heavy: () => () => undefined, sla: () => null } }));
    expect(refused.blocks.join('\n')).toMatch(/SLA of September 2026[^\n]*: not read: you already have 4 reports being prepared/);
  });

  // A read goes on after the question stopped waiting for it, so the place is the person's while it runs, and is freed when it ends, whichever way, and not when the answer is out (BK-88).
  describe('and frees it when the read ends', () => {
    afterEach(() => vi.useRealTimers());

    it('after the read finishes, though the question stopped waiting for it long before', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let finish!: (report: unknown) => void;
      vi.mocked(getNoiseReport).mockImplementation(() => new Promise((resolve) => (finish = resolve as never)));
      const release = vi.fn();
      const pending = buildDetails(everything({ question: 'alert noise minggu ini', places: { heavy: () => release, sla: () => null } }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).blocks.join('\n')).toMatch(/ALERT NOISE: is still being worked out/);
      expect(release).not.toHaveBeenCalled();
      finish(noise);
      await vi.advanceTimersByTimeAsync(0);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('after the read fails, and the place of a read that took none is not asked for', async () => {
      vi.mocked(getTopTriggers).mockRejectedValue(new Error('Zabbix is down'));
      const release = vi.fn();
      const got = await buildDetails(everything({ question: 'top triggers this week', places: { heavy: () => release, sla: () => null } }));
      expect(got.blocks.join('\n')).toMatch(/TOP TRIGGERS: could not be read/);
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    });

    it('after the SLA read ends, from the SLA line and not the heavy one', async () => {
      vi.mocked(readSlaWindow).mockResolvedValue({ target: 99.9, overall: { sli: 99.99, meeting: true, withData: 3, hosts: 3 }, sites: [], hosts: [] } as never);
      const releaseSla = vi.fn();
      const releaseHeavy = vi.fn();
      await buildDetails(everything({ question: 'SLA bulan September berapa?', places: { heavy: () => releaseHeavy, sla: () => releaseSla } }));
      await vi.waitFor(() => expect(releaseSla).toHaveBeenCalledTimes(1));
      expect(releaseHeavy).not.toHaveBeenCalled();
    });
  });

  it('takes none for a topic that is not heavy, and none when no limit is given', async () => {
    const heavy = vi.fn(() => () => undefined);
    await buildDetails(everything({ question: 'berapa CPU 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA_HOST], places: { heavy, sla: heavy } }));
    expect(heavy).not.toHaveBeenCalled();
    vi.mocked(getNoiseReport).mockResolvedValue(noise);
    expect((await buildDetails(everything({ question: 'alert noise minggu ini' }))).topics).toEqual(['noise']);
  });
});

describe('the reader who leaves (BK-88, BK-91)', () => {
  it('has the heavy reads given their signal, so a read nobody waits for stops', async () => {
    vi.mocked(getNoiseReport).mockResolvedValue(noise);
    vi.mocked(getCapacityReport).mockResolvedValue({ days: 7, metrics: [] } as never);
    vi.mocked(getTopTriggers).mockResolvedValue({ days: 7, triggers: [], truncated: false } as never);
    vi.mocked(readSla).mockResolvedValue({ target: 99.9, overall: { sli: 99, meeting: false, withData: 1, hosts: 1 }, sites: [], hosts: [] } as never);
    const ac = new AbortController();
    await buildDetails(everything({ question: 'alert noise, forecast and top triggers, and the SLA bulan September', signal: ac.signal }));
    expect(vi.mocked(getNoiseReport).mock.calls[0][3]).toBe(ac.signal);
    expect(vi.mocked(getCapacityReport).mock.calls[0][2]).toBe(ac.signal);
    expect(vi.mocked(getTopTriggers).mock.calls[0][1]).toBe(ac.signal);
    expect(vi.mocked(readSla).mock.calls[0][1]).toBe(ac.signal);
  });

  it('starts no heavy read, and takes no place, when the reader has already left', async () => {
    const ac = new AbortController();
    ac.abort();
    const heavy = vi.fn(() => () => undefined);
    const got = await buildDetails(everything({ question: 'alert noise, forecast and top triggers', signal: ac.signal, places: { heavy, sla: heavy } }));
    expect(got.blocks).toEqual([]);
    expect(heavy).not.toHaveBeenCalled();
    expect(getNoiseReport).not.toHaveBeenCalled();
    expect(getCapacityReport).not.toHaveBeenCalled();
    expect(getTopTriggers).not.toHaveBeenCalled();
  });
});

describe('the time the values are labelled with (BK-90)', () => {
  const list = (generatedAt: number) => ({ generatedAt, metrics: [{ key: 'cpu', label: 'CPU utilisation', considered: 5, current: 2, rows: [{ hostid: '1', host: 'A-FW1', itemid: '1', value: 80, clock: generatedAt }] }] }) as never;

  it('is the time of the list of busiest hosts for a question that names nothing, and says that nothing was named', async () => {
    vi.mocked(topHostsView).mockResolvedValue(list(at('2026-11-18T12:20:00')));
    const { blocks } = await buildDetails(everything({ question: 'berapa CPU tertinggi?', readAt: '12:30' }));
    expect(blocks[0]).toContain("BUSIEST HOSTS NOW (the Dashboard's Top hosts, read 12:20; no host or site was named in this question or the one before it)");
    expect(blocks[0]).not.toContain('read 12:30');
  });

  it('is the time of that list for the CPU of a site, and the time of the question for the other metrics', async () => {
    vi.mocked(topHostsView).mockResolvedValue({ generatedAt: at('2026-11-18T12:20:00'), metrics: [{ key: 'cpu', label: 'CPU utilisation', considered: 3, current: 3, rows: SURABAYA.map((h) => ({ hostid: (h as { hostid: string }).hostid, host: (h as { name: string }).name, itemid: '1', value: 50, clock: at('2026-11-18T12:20:00') })) }] } as never);
    vi.mocked(readHostValues).mockResolvedValue([]);
    const { blocks } = await buildDetails(everything({ question: 'berapa CPU tertinggi di Surabaya?', sites: [SURABAYA_REF], readAt: '12:30' }));
    expect(blocks[0]).toContain('HIGHEST CPU NOW at Surabaya (read 12:20;');
    expect(topHostsLines({ generatedAt: 1, metrics: [] } as never, ['cpu'], '12:00', 5)).toEqual([]);
  });
});

describe('the days of the reports are the periods the pages offer (BK-88)', () => {
  it.each([
    ['alert noise 14 hari terakhir', 30],
    ['alert noise 3 hari terakhir', 7],
    ['alert noise kemarin', 1],
    ['alert noise minggu lalu', 7],
    ['alert noise 40 hari terakhir', 90],
  ])('reads "%s" at %s days, a period of the page, so that it shares the page\'s read', async (question, days) => {
    vi.mocked(getNoiseReport).mockResolvedValue(noise);
    vi.mocked(getTopTriggers).mockResolvedValue({ days, triggers: [], truncated: false } as never);
    await buildDetails(everything({ question }));
    expect(vi.mocked(getNoiseReport).mock.calls.at(-1)![0]).toBe(days);
    await buildDetails(everything({ question: question.replace('alert noise', 'top triggers') }));
    expect(vi.mocked(getTopTriggers).mock.calls.at(-1)![0]).toBe(days);
  });
});

describe('the months of one question about the SLA (BK-88)', () => {
  it('reads a window of up to four months, and says that a longer one was not read, and takes no place for it', async () => {
    vi.mocked(readSlaWindow).mockResolvedValue({ target: 99.9, overall: { sli: 99.99, meeting: true, withData: 3, hosts: 3 }, sites: [], hosts: [] } as never);
    const taken = vi.fn(() => () => undefined);
    await buildDetails(everything({ question: 'SLA 3 bulan terakhir', places: { heavy: () => () => undefined, sla: taken } }));
    expect(readSlaWindow).toHaveBeenCalledTimes(1);
    vi.mocked(readSlaWindow).mockClear();
    taken.mockClear();
    const { blocks } = await buildDetails(everything({ question: 'SLA tahun ini', places: { heavy: () => () => undefined, sla: taken } }));
    expect(blocks.join('\n')).toMatch(/SLA of this year[^\n]*: not read: this window touches 11 months[^\n]*ask for 4 months or fewer/);
    expect(readSlaWindow).not.toHaveBeenCalled();
    expect(taken).not.toHaveBeenCalled();
  });
});
