import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDetails, DETAIL_TOTAL, type DetailContext } from '../services/assistantDetail.js';
import { notGivenLine } from '../services/assistantPrompt.js';
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
import { BadRequestError } from '../core/validate.js';
import { readPast } from '../services/assistantPast.js';
import { readHostValues } from '../services/assistantValues.js';
import { readHostInfo } from '../services/assistantHostInfo.js';
import { topHostsView } from '../services/topHosts.js';
import { windowOf } from '../services/assistantWhen.js';

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
const ARUBA = host('41', '4.3.3 FPSO ARUBA 3');

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

const only = (...ids: string[]) => (...wanted: string[]) => wanted.some((w) => ids.includes(w));

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

describe('buildDetails: past problems', () => {
  it('reads the window the question named, for the whole estate when it names no site or host', async () => {
    const { blocks, topics } = await buildDetails(everything({ question: 'tadi malam ada masalah apa?' }));
    expect(topics).toEqual(['past']);
    const window = windowOf('tadi malam', NOW, TZ)!;
    expect(readPast).toHaveBeenCalledWith(expect.objectContaining({ from: window.from, to: window.to }), null, 3);
    expect(blocks[0]).toContain('PROBLEMS THAT OPENED last night, from Tue 17 Nov 18:00 to Wed 18 Nov 06:00 (Asia/Jakarta), Average and above, across the estate: 0 opened');
  });

  it('reads the hosts of the site the question names, or the host, and says which', async () => {
    await buildDetails(everything({ question: 'kemarin ada masalah apa di Surabaya?', sites: [SURABAYA_REF] }));
    expect(readPast).toHaveBeenLastCalledWith(expect.anything(), ['21', '22', '23'], 3);
    const { blocks } = await buildDetails(everything({ question: 'berapa kali 4.3.3 FPSO ARUBA 3 down minggu ini?', hosts: [ARUBA] }));
    expect(readPast).toHaveBeenLastCalledWith(expect.anything(), ['41'], 3);
    expect(blocks[0]).toContain('at 4.3.3 FPSO ARUBA 3');
  });

  it('takes a week when the question counts and names no time, and a day when it only asks about the past', async () => {
    await buildDetails(everything({ question: 'berapa kali 4.3.3 FPSO ARUBA 3 down?', hosts: [ARUBA] }));
    const week = vi.mocked(readPast).mock.calls.at(-1)![0];
    expect(week.to - week.from).toBe(7 * 86_400);
    await buildDetails(everything({ question: 'apa yang sudah resolved?' }));
    const day = vi.mocked(readPast).mock.calls.at(-1)![0];
    expect(day.to - day.from).toBe(86_400);
  });

  it('does not read the whole estate for a question that counts and names no site or host, since that answers nothing of it', async () => {
    const got = await buildDetails(everything({ question: 'berapa kali switch ini down minggu ini?' }));
    expect(got).toEqual({ topics: [], blocks: [], notGiven: null });
    expect(readPast).not.toHaveBeenCalled();
  });

  it('is not read for a user without the Problems page', async () => {
    const { blocks, notGiven } = await buildDetails(everything({ question: 'tadi malam ada masalah apa?', can: only('sites', 'hosts') }));
    // Nothing is read, and the model is told that it was not given the past problems, so it does not answer none (BK-84). The line is not data: it is not among the blocks.
    expect(blocks).toEqual([]);
    expect(notGiven).toBe(notGivenLine(['past problems']));
    expect(readPast).not.toHaveBeenCalled();
  });

  it('says that the read failed, so that nothing is taken for "no problems"', async () => {
    vi.mocked(readPast).mockRejectedValue(new Error('Zabbix did not answer'));
    const { blocks } = await buildDetails(everything({ question: 'tadi malam ada masalah apa?' }));
    expect(blocks[0]).toBe('PROBLEMS THAT OPENED last night, from Tue 17 Nov 18:00 to Wed 18 Nov 06:00 (Asia/Jakarta): could not be read from Zabbix in time; nothing is known of them from this snapshot');
  });
});

describe('buildDetails: values', () => {
  const item = (over: Record<string, unknown> = {}) => ({ hostid: '41', host: '4.3.3 FPSO ARUBA 3', metric: 'cpu', name: 'CPU utilization', key: 'system.cpu.util', value: '42', units: '%', clock: NOW - 30, fresh: true, ...over });

  it('reads the metrics the question named for the host it named, and gives them', async () => {
    vi.mocked(readHostValues).mockResolvedValue([item()] as never);
    const { blocks, topics } = await buildDetails(everything({ question: 'berapa CPU 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA] }));
    expect(topics).toEqual(['values']);
    expect(readHostValues).toHaveBeenCalledWith([{ hostid: '41', name: '4.3.3 FPSO ARUBA 3' }], ['cpu'], { network: true, now: NOW });
    expect(blocks[0]).toBe('VALUES NOW of 4.3.3 FPSO ARUBA 3 (read 12:30):\n- CPU: CPU utilization 42 % (1 min ago)');
  });

  it('gives the highest across the hosts of a site when it names a site and no host', async () => {
    vi.mocked(readHostValues).mockResolvedValue([item({ hostid: '22', host: '2.2.1 BRAVO-SW01', metric: 'temperature', name: 'Temperature', units: '°C', value: '58.1' })] as never);
    const { blocks } = await buildDetails(everything({ question: 'suhu di Surabaya berapa?', sites: [SURABAYA_REF] }));
    expect(readHostValues).toHaveBeenCalledWith(SURABAYA.map((h: { hostid: string; name: string }) => ({ hostid: h.hostid, name: h.name })), ['temperature'], { network: true, now: NOW });
    expect(blocks[0].split('\n')[0]).toBe('HIGHEST TEMPERATURE NOW at Surabaya (read 12:30; 1 of 3 hosts have a current reading):');
    expect(blocks[0]).toContain('- 2.2.1 BRAVO-SW01: Temperature 58.1 °C');
  });

  it('takes the CPU and the memory of a site from the Dashboard list kept for every host, cut to the hosts of the site', async () => {
    const rows = (key: 'cpu' | 'memory', list: [string, string, number][]) => ({ key, label: key === 'cpu' ? 'CPU utilisation' : 'Memory utilisation', considered: 9, current: list.length, rows: list.map(([hostid, name, value]) => ({ hostid, host: name, itemid: hostid, value, clock: NOW - 60 })) });
    vi.mocked(topHostsView).mockResolvedValue({
      generatedAt: NOW,
      metrics: [rows('cpu', [['41', '4.3.3 FPSO ARUBA 3', 97], ['22', '2.2.1 BRAVO-SW01', 64], ['21', '2.1 BRAVO-FW01', 12]]), rows('memory', [['23', '2.3.1 BRAVO-AP01', 71]])],
    } as never);
    const { blocks } = await buildDetails(everything({ question: 'CPU dan memori tertinggi di Surabaya berapa?', sites: [SURABAYA_REF] }));
    expect(topHostsView).toHaveBeenCalledWith(Number.POSITIVE_INFINITY);
    expect(readHostValues).not.toHaveBeenCalled();
    expect(blocks[0].split('\n')).toEqual([
      'HIGHEST CPU NOW at Surabaya (read 12:30; 2 of 3 hosts have a current reading):',
      '- 2.2.1 BRAVO-SW01: CPU utilisation 64 %',
      '- 2.1 BRAVO-FW01: CPU utilisation 12 %',
    ]);
    expect(blocks[1].split('\n')).toEqual(['HIGHEST MEMORY NOW at Surabaya (read 12:30; 1 of 3 hosts have a current reading):', '- 2.3.1 BRAVO-AP01: Memory utilisation 71 %']);
  });

  it('reads a site\'s other metrics by item, and its CPU from the list, in the same answer', async () => {
    vi.mocked(topHostsView).mockResolvedValue({ generatedAt: NOW, metrics: [{ key: 'cpu', label: 'CPU utilisation', considered: 3, current: 1, rows: [{ hostid: '21', host: '2.1 BRAVO-FW01', itemid: '1', value: 30, clock: NOW }] }] } as never);
    vi.mocked(readHostValues).mockResolvedValue([item({ hostid: '22', host: '2.2.1 BRAVO-SW01', metric: 'temperature', name: 'Temperature', units: '°C', value: '58.1' })] as never);
    const { blocks } = await buildDetails(everything({ question: 'CPU dan suhu di Surabaya berapa?', sites: [SURABAYA_REF] }));
    expect(readHostValues).toHaveBeenCalledWith(expect.anything(), ['temperature'], { network: true, now: NOW });
    expect(blocks.map((b) => b.split('\n')[0])).toEqual(['HIGHEST CPU NOW at Surabaya (read 12:30; 1 of 3 hosts have a current reading):', 'HIGHEST TEMPERATURE NOW at Surabaya (read 12:30; 1 of 3 hosts have a current reading):']);
  });

  it('gives the busiest hosts of the Dashboard when it asks for CPU or memory and names nothing', async () => {
    vi.mocked(topHostsView).mockResolvedValue({ generatedAt: NOW, metrics: [{ key: 'cpu', label: 'CPU utilisation', considered: 10, current: 9, rows: [{ hostid: '1', host: 'FW-A', itemid: '1', value: 91.2, clock: NOW }] }] } as never);
    const { blocks } = await buildDetails(everything({ question: 'host mana CPU-nya paling tinggi?' }));
    expect(blocks[0]).toContain("BUSIEST HOSTS NOW (the Dashboard's Top hosts, read 12:30;");
    expect(blocks[0]).toContain('FW-A 91.2 %');
    expect(readHostValues).not.toHaveBeenCalled();
  });

  it('leaves out the traffic of interfaces for a user without the network pages, and reads nothing for a metric it cannot give', async () => {
    await buildDetails(everything({ question: 'berapa trafik 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], can: only('latest', 'hosts') }));
    expect(readHostValues).not.toHaveBeenCalled();
    await buildDetails(everything({ question: 'berapa trafik dan CPU 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], can: only('latest', 'hosts') }));
    expect(readHostValues).toHaveBeenCalledWith(expect.anything(), ['cpu'], { network: false, now: NOW });
  });

  it('is not read for a user without the Latest data page', async () => {
    await buildDetails(everything({ question: 'berapa CPU 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], can: only('sites', 'hosts', 'problems') }));
    expect(readHostValues).not.toHaveBeenCalled();
  });

  it('says that the read failed', async () => {
    vi.mocked(readHostValues).mockRejectedValue(new Error('Zabbix did not answer'));
    const { blocks } = await buildDetails(everything({ question: 'berapa CPU 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA] }));
    expect(blocks[0]).toBe('VALUES NOW of 4.3.3 FPSO ARUBA 3: could not be read from Zabbix in time; nothing is known of them from this snapshot');
  });
});

describe('buildDetails: details and contacts', () => {
  const info = (over: Record<string, unknown> = {}) => ({ hostid: '41', name: '4.3.3 FPSO ARUBA 3', enabled: true, maintenance: null, interfaces: [{ ip: '10.9.8.7', dns: '', type: '2', port: '161', main: true }], groups: ['ARUBA'], templates: ['Generic by SNMP'], tags: [], description: '', inventory: {}, ...over });

  it('gives the details of the host the question named', async () => {
    vi.mocked(readHostInfo).mockResolvedValue([info()] as never);
    const { blocks, topics } = await buildDetails(everything({ question: 'apa IP address 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA] }));
    expect(topics).toEqual(['details']);
    expect(readHostInfo).toHaveBeenCalledWith(['41']);
    expect(blocks[0]).toContain('- Address: 10.9.8.7 (SNMP, port 161)');
    expect(blocks[0]).not.toContain('Contacts');
  });

  it('gives the contacts on record for a person asked for, and for a site the contacts of its hosts', async () => {
    vi.mocked(readHostInfo).mockResolvedValue([info({ inventory: { poc_1_name: 'Budi Santoso' } })] as never);
    const hostAsk = await buildDetails(everything({ question: 'siapa penanggung jawab 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA] }));
    expect(hostAsk.blocks[0]).toContain('- Contacts on record: Budi Santoso');
    const siteAsk = await buildDetails(everything({ question: 'siapa penanggung jawab di situs Surabaya?', sites: [SURABAYA_REF] }));
    expect(readHostInfo).toHaveBeenLastCalledWith(['21', '22', '23']);
    expect(siteAsk.blocks[0]).toContain('CONTACTS on record for the hosts of Surabaya');
  });

  it('keeps the contacts from a model outside this machine, and from a user without the Inventory page', async () => {
    vi.mocked(readHostInfo).mockResolvedValue([info({ inventory: { poc_1_name: 'Budi Santoso' } })] as never);
    const outside = await buildDetails(everything({ question: 'siapa penanggung jawab 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], external: true }));
    expect(outside.blocks[0]).toContain('not given to a model outside this machine');
    expect(outside.blocks[0]).not.toContain('Budi');
    const noInventory = await buildDetails(everything({ question: 'siapa penanggung jawab 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], can: only('hosts') }));
    // The model is on this machine: it is the person's pages that keep the contacts back, and the line says so (SC-65).
    expect(noInventory.blocks[0]).toContain('not given: this account does not have the Inventory page');
    expect(noInventory.blocks[0]).not.toContain('Budi');
  });

  it('keeps the address from a model outside this machine', async () => {
    vi.mocked(readHostInfo).mockResolvedValue([info()] as never);
    const { blocks } = await buildDetails(everything({ question: 'apa IP address 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], external: true }));
    expect(blocks[0]).toContain('- Address: not given to a model outside this machine');
    expect(blocks[0]).not.toContain('10.9.8.7');
  });

  it('needs a host or a site to be named, and a user with the Hosts or Devices page', async () => {
    await buildDetails(everything({ question: 'apa IP address-nya?' }));
    expect(readHostInfo).not.toHaveBeenCalled();
    await buildDetails(everything({ question: 'apa IP address 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], can: only('problems') }));
    expect(readHostInfo).not.toHaveBeenCalled();
  });
});

describe('buildDetails: the whole', () => {
  it('adds nothing for a question about the state of the estate', async () => {
    const got = await buildDetails(everything({ question: 'Ada yang down di Surabaya sekarang?', sites: [SURABAYA_REF] }));
    expect(got).toEqual({ topics: [], blocks: [], notGiven: null });
  });

  it('keeps its blocks within a total, dropping the last whole one rather than cutting a line', async () => {
    const info = (hostid: string, name: string) => ({ hostid, name, enabled: true, maintenance: null, interfaces: [], groups: Array.from({ length: 6 }, (_, i) => `GROUP-${i}-`.padEnd(38, 'x')), templates: [], tags: [], description: 'd'.repeat(110), inventory: { location: 'L'.repeat(70), vendor: 'V'.repeat(70), model: 'M'.repeat(70) } });
    vi.mocked(readHostInfo).mockResolvedValue([info('41', '4.3.3 FPSO ARUBA 3'), info('21', '2.1 BRAVO-FW01')] as never);
    const metrics = ['cpu', 'memory', 'temperature', 'disk', 'uptime'];
    vi.mocked(readHostValues).mockResolvedValue(['41', '21'].flatMap((id) => metrics.map((metric) => ({ hostid: id, host: id === '41' ? '4.3.3 FPSO ARUBA 3' : '2.1 BRAVO-FW01', metric, name: `${metric} item `.padEnd(58, 'x'), key: 'k', value: '42', units: '%', clock: NOW - 30, fresh: true }))) as never);
    vi.mocked(readPast).mockResolvedValue({ events: Array.from({ length: 40 }, (_, i) => ({ eventid: String(i), host: `HOST-${i}`, hostid: String(i), name: `Trigger ${i} with a long name`, severity: '4', start: at('2026-11-17T20:10:00'), end: at('2026-11-17T20:35:00') })), truncated: false });
    vi.mocked(readAcksIn).mockResolvedValue({ problems: Array.from({ length: 12 }, (_, i) => ({ eventid: String(i), host: `HOST-${i}`, name: `Trigger ${i} with a long name`, severity: 4, start: at('2026-11-17T20:10:00'), open: false, updates: [{ at: at('2026-11-17T21:00:00'), who: 'Citra Lestari', action: 6, message: 'w'.repeat(150) }] })), truncated: false });
    const ask = 'tadi malam apa IP address, CPU, memori, suhu, disk, uptime dan siapa yang acknowledge 4.3.3 FPSO ARUBA 3 dan 2.1 BRAVO-FW01?';
    const { blocks, topics } = await buildDetails(everything({ question: ask, hosts: [ARUBA, host('21', '2.1 BRAVO-FW01')] }));
    expect(blocks.join('\n\n').length).toBeLessThanOrEqual(DETAIL_TOTAL);
    expect(blocks.length).toBeGreaterThan(0);
    expect(topics.length).toBeLessThan(4);
  });
});

describe('buildDetails: acknowledgements', () => {
  const acked = (eventid: string, hostid: string, severity = '4') => ({ eventid, hostid, severity, acknowledged: '1', clock: '100', name: 'High packets loss', objectid: '9', object: '0' }) as never;
  const problem = (over: Record<string, unknown> = {}) => ({ eventid: '77', host: '4.3.3 FPSO ARUBA 3', name: 'High packets loss', severity: 4, start: NOW - 3 * 86_400, open: true, updates: [{ at: NOW - 3600, who: 'Citra Lestari', action: 6, message: 'sudah ditelepon vendor' }], ...over });

  it('reads the updates of the open problems that were acknowledged at the host the question named, whatever their age', async () => {
    vi.mocked(readAcks).mockResolvedValue([problem()] as never);
    const problems = [acked('77', '41'), acked('78', '22'), { ...(acked('79', '41') as object), acknowledged: '0' }] as never;
    const { blocks, topics } = await buildDetails(everything({ question: 'siapa yang acknowledge problem di 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], problems }));
    expect(topics).toEqual(['acks']);
    expect(readAcks).toHaveBeenCalledWith(['77']);
    expect(readAcksIn).not.toHaveBeenCalled();
    expect(blocks[0].split('\n')[0]).toBe('ACKNOWLEDGED PROBLEMS still open, at 4.3.3 FPSO ARUBA 3 (1 with updates; newest update first):');
    expect(blocks[0]).toContain('Citra Lestari acknowledged and commented');
    expect(blocks[0]).toContain('"sudah ditelepon vendor"');
  });

  it('reads the acknowledged problems of the window the question named, for the hosts of the site', async () => {
    const { blocks } = await buildDetails(everything({ question: 'tadi malam siapa yang acknowledge problem di Surabaya?', sites: [SURABAYA_REF] }));
    const window = windowOf('tadi malam', NOW, TZ)!;
    expect(readAcksIn).toHaveBeenCalledWith(expect.objectContaining({ from: window.from, to: window.to }), ['21', '22', '23']);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('ACKNOWLEDGED PROBLEMS that opened last night');
    expect(blocks[0]).toContain('- none: no problem in scope has been acknowledged');
  });

  it('gives a model outside this machine no name and no reason', async () => {
    vi.mocked(readAcks).mockResolvedValue([problem()] as never);
    const { blocks } = await buildDetails(everything({ question: 'siapa yang acknowledge problem di 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], problems: [acked('77', '41')], external: true }));
    expect(blocks[0]).toContain('who and why are not given to a model outside this machine');
    expect(blocks[0]).not.toContain('Citra');
    expect(blocks[0]).not.toContain('vendor');
  });

  it('is not read for a user without the Problems page', async () => {
    await buildDetails(everything({ question: 'siapa yang acknowledge problem di 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA], can: only('sites', 'hosts', 'latest') }));
    expect(readAcks).not.toHaveBeenCalled();
    expect(readAcksIn).not.toHaveBeenCalled();
  });

  it('says that the read failed', async () => {
    vi.mocked(readAcks).mockRejectedValue(new Error('Zabbix did not answer'));
    const { blocks } = await buildDetails(everything({ question: 'siapa yang acknowledge problem di 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA] }));
    expect(blocks[0]).toContain('ACKNOWLEDGED PROBLEMS: could not be read from Zabbix in time');
  });
});

describe('buildDetails: the SLA of a window', () => {
  const report = { target: 99, overall: { sli: 99.5, meeting: true, hosts: 120, withData: 118 }, sites: [], hosts: [] } as never;

  it('works out the SLA of a month the snapshot does not hold, and says which window it read', async () => {
    vi.mocked(readSlaWindow).mockResolvedValue(report);
    const { blocks, topics } = await buildDetails(everything({ question: 'berapa SLA bulan September?' }));
    expect(topics).toEqual(['sla']);
    expect(readSlaWindow).toHaveBeenCalledWith(expect.objectContaining({ from: at('2026-09-01T00:00:00'), to: at('2026-10-01T00:00:00'), label: 'September 2026', hours: null }), undefined);
    expect(blocks[0]).toMatch(/^SLA of September 2026, from Tue 1 Sep\w* 00:00 to Thu 1 Oct 00:00 \(Asia\/Jakarta\), by the strict method \(target 99%\)/);
  });

  it('counts only the hours the question names', async () => {
    vi.mocked(readSlaWindow).mockResolvedValue(report);
    const { blocks } = await buildDetails(everything({ question: 'SLA minggu lalu hanya jam kerja berapa?' }));
    expect(readSlaWindow).toHaveBeenCalledWith(expect.objectContaining({ label: 'last week', hours: { start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] } }), undefined);
    expect(blocks[0]).toContain(', counting only 08:00 to 17:00 on weekdays');
  });

  it('reads nothing for what the snapshot holds: last month over every hour, or no window at all', async () => {
    expect(await buildDetails(everything({ question: 'berapa SLA bulan lalu?' }))).toEqual({ topics: [], blocks: [], notGiven: null });
    expect(await buildDetails(everything({ question: 'berapa SLA sekarang?' }))).toEqual({ topics: [], blocks: [], notGiven: null });
    expect(readSlaWindow).not.toHaveBeenCalled();
  });

  it('says that a month not read before is still being worked out, and does not hold the question for it', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(readSlaWindow).mockReturnValue(new Promise(() => undefined));
      const pending = buildDetails(everything({ question: 'berapa SLA bulan September?' }));
      await vi.advanceTimersByTimeAsync(9_500);
      const { blocks } = await pending;
      expect(blocks[0]).toContain('SLA of September 2026');
      expect(blocks[0]).toContain('is still being worked out');
      expect(blocks[0]).toContain('minutes on HCML');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says why a window cannot be worked out, in the words of the SLA service', async () => {
    vi.mocked(readSlaWindow).mockRejectedValue(new BadRequestError('Zabbix keeps events for about a year; pick a later period.'));
    const { blocks } = await buildDetails(everything({ question: 'berapa SLA bulan Januari 2025?' }));
    expect(blocks[0]).toContain('cannot be worked out: Zabbix keeps events for about a year; pick a later period.');
  });

  it('says that the read failed for any other reason', async () => {
    vi.mocked(readSlaWindow).mockRejectedValue(new Error('Zabbix did not answer'));
    const { blocks } = await buildDetails(everything({ question: 'berapa SLA bulan September?' }));
    expect(blocks[0]).toContain('could not be read from Zabbix in time');
  });

  it('is not read for a user without the SLA page', async () => {
    await buildDetails(everything({ question: 'berapa SLA bulan September?', can: only('problems', 'sites') }));
    expect(readSlaWindow).not.toHaveBeenCalled();
  });
});

describe('buildDetails: every open problem, and the maintenance windows', () => {
  const open = (eventid: string, hostid: string, severity: string) => ({ eventid, hostid, host: `HOST-${hostid}`, severity, name: `Problem ${eventid}`, clock: String(NOW - 3600), acknowledged: '0', object: '0', objectid: eventid }) as never;
  const problems = [open('1', '21', '4'), open('2', '22', '2'), open('3', '23', '5'), open('4', '41', '5')];

  it('lists every open problem of the site the question named, from the list the pages keep, and reads nothing', async () => {
    const { blocks, topics } = await buildDetails(everything({ question: 'sebutkan semua problem di Surabaya', sites: [SURABAYA_REF], problems }));
    expect(topics).toEqual(['open']);
    expect(blocks[0].split('\n')[0]).toBe('OPEN PROBLEMS at Surabaya: 3 in all, worst first:');
    expect(blocks[0]).toContain('HOST-23');
    expect(blocks[0]).not.toContain('HOST-41');
  });

  it('keeps to the severity the question named', async () => {
    const { blocks } = await buildDetails(everything({ question: 'tampilkan semua problem High di Surabaya', sites: [SURABAYA_REF], problems }));
    expect(blocks[0].split('\n')[0]).toBe('OPEN PROBLEMS at Surabaya, High and above: 2 in all, worst first:');
  });

  it('counts the estate when nothing narrows the question, and lists it for a severity', async () => {
    const { blocks } = await buildDetails(everything({ question: 'sebutkan semua problem', problems }));
    expect(blocks[0]).toContain('OPEN PROBLEMS across the estate: 4 in all');
    const critical = await buildDetails(everything({ question: 'sebutkan semua problem critical', problems }));
    expect(critical.blocks[0].split('\n')[0]).toBe('OPEN PROBLEMS across the estate, Disaster and above: 2 in all, worst first:');
  });

  it('is not read for a user without the Problems page, and is not the answer to a question about a time that has gone', async () => {
    expect((await buildDetails(everything({ question: 'sebutkan semua problem di Surabaya', sites: [SURABAYA_REF], problems, can: only('sites', 'hosts') }))).notGiven).toBe(notGivenLine(['the full list of open problems']));
    const past = await buildDetails(everything({ question: 'sebutkan semua problem tadi malam di Surabaya', sites: [SURABAYA_REF], problems }));
    expect(past.topics).toEqual(['past']);
  });

  it('lists the maintenance windows that are valid now or later', async () => {
    vi.mocked(readMaintenance).mockResolvedValue([{ name: 'Core upgrade', from: at('2026-11-19T22:00:00'), to: at('2026-11-20T02:00:00'), collects: false, hosts: ['1.1 TANGO02FW01'], groups: [] }]);
    const { blocks, topics } = await buildDetails(everything({ question: 'ada maintenance terjadwal minggu ini?' }));
    expect(topics).toEqual(['maintenance']);
    expect(blocks[0]).toContain('- "Core upgrade": valid 19 Nov 22:00 to 20 Nov 02:00 (no data is collected); hosts: 1.1 TANGO02FW01');
  });

  it('says that none is planned when none is, and that the read failed when it did', async () => {
    expect((await buildDetails(everything({ question: 'ada maintenance?' }))).blocks[0]).toContain('- none: no maintenance window is valid now or later');
    vi.mocked(readMaintenance).mockRejectedValue(new Error('Zabbix did not answer'));
    expect((await buildDetails(everything({ question: 'ada maintenance?' }))).blocks[0]).toContain('MAINTENANCE WINDOWS: could not be read from Zabbix in time');
  });

  it('does not list maintenance windows for a user whose pages show no hosts, sites or SLA', async () => {
    await buildDetails(everything({ question: 'ada maintenance?', can: only('problems', 'latest') }));
    expect(readMaintenance).not.toHaveBeenCalled();
  });
});

describe('buildDetails: the WAN links and the web checks', () => {
  const link = (id: string, hostid: string, state: string, over: Record<string, unknown> = {}) => ({ id, hostid, host: `HOST-${hostid}`, target: '8.8.8.8', label: `Link ${id}`, state, ...over });
  const links = { links: [link('a', '21', 'degraded', { loss: 8, latency: 80 }), link('b', '41', 'down')], paths: [], summary: { total: 2, up: 0, degraded: 1, down: 1, unknown: 0 }, thresholds: { lossWarn: 5, lossCrit: 20 } } as never;
  const web = { generatedAt: NOW, total: 12, ok: 11, failed: 1, unknown: 0, failures: [{ hostid: '1', host: '1.1 TANGO02FW01', name: 'Portal HCML', itemid: '9', step: 2, clock: NOW - 120 }] } as never;

  it('gives the WAN links of the site the question named, worst first', async () => {
    vi.mocked(linksView).mockResolvedValue(links);
    const { blocks, topics } = await buildDetails(everything({ question: 'latency link WAN di Surabaya berapa?', sites: [SURABAYA_REF] }));
    expect(topics).toEqual(['links']);
    expect(blocks[0].split('\n')[0]).toContain('WAN LINKS at Surabaya (1: 0 up, 1 degraded, 0 down, 0 unknown;');
    expect(blocks[0]).toContain('- HOST-21 to 8.8.8.8 (Link a): degraded, loss 8 %, latency 80 ms');
    expect(blocks[0]).not.toContain('Link b');
    expect(readHostValues).not.toHaveBeenCalled();
  });

  it('gives all the links when no site or host is named', async () => {
    vi.mocked(linksView).mockResolvedValue(links);
    const { blocks } = await buildDetails(everything({ question: 'link WAN mana yang down?' }));
    expect(blocks[0].split('\n')[0]).toContain('WAN LINKS across the estate (2:');
    expect(blocks[0].split('\n')[1]).toContain('Link b');
  });

  it('gives the web checks that fail', async () => {
    vi.mocked(webMonitoringView).mockResolvedValue(web);
    const { blocks, topics } = await buildDetails(everything({ question: 'web check mana yang gagal?' }));
    expect(topics).toEqual(['web']);
    expect(blocks[0]).toContain('WEB CHECKS (12 scenarios: 11 ok, 1 failed, 0 without a current result');
    expect(blocks[0]).toContain('- 1.1 TANGO02FW01: Portal HCML failed at step 2');
  });

  it('says that a read failed', async () => {
    vi.mocked(linksView).mockRejectedValue(new Error('Zabbix did not answer'));
    vi.mocked(webMonitoringView).mockRejectedValue(new Error('Zabbix did not answer'));
    expect((await buildDetails(everything({ question: 'link WAN mana yang down?' }))).blocks[0]).toContain('WAN LINKS: could not be read from Zabbix in time');
    expect((await buildDetails(everything({ question: 'web check mana yang gagal?' }))).blocks[0]).toContain('WEB CHECKS: could not be read from Zabbix in time');
  });

  it('gives the links only to a user with the Links page and the web checks only to one with a page that shows them', async () => {
    await buildDetails(everything({ question: 'link WAN mana yang down?', can: only('problems', 'network') }));
    await buildDetails(everything({ question: 'web check mana yang gagal?', can: only('problems', 'links') }));
    expect(linksView).not.toHaveBeenCalled();
    expect(webMonitoringView).not.toHaveBeenCalled();
    await buildDetails(everything({ question: 'web check mana yang gagal?', can: only('hosts') }));
    expect(webMonitoringView).toHaveBeenCalledTimes(1);
  });
});

describe('buildDetails: the series behind a graph', () => {
  const cpu = { itemid: '5', hostid: '41', host: '4.3.3 FPSO ARUBA 3', metric: 'cpu', name: 'CPU utilization', key: 'system.cpu.util', value: '42', units: '%', clock: NOW - 30, fresh: true };
  const graph = { from: 0, to: 1, source: 'trend', series: [{ itemid: '5', name: 'CPU utilization', host: '4.3.3 FPSO ARUBA 3', units: '%', stats: { min: 2, avg: 6.4, max: 38, last: 7, lastClock: NOW }, coverage: { coveredSeconds: 86_400, firstClock: 0, lastClock: 0 }, points: [] }], latestClock: null, downsampled: false } as never;

  it('gives the lowest, average, highest and last of the host\'s item over the window the question named, instead of the plain value', async () => {
    vi.mocked(readHostValues).mockResolvedValue([cpu] as never);
    vi.mocked(getGraph).mockResolvedValue(graph);
    const { blocks, topics } = await buildDetails(everything({ question: 'rata-rata CPU 4.3.3 FPSO ARUBA 3 kemarin berapa?', hosts: [ARUBA] }));
    expect(topics).toEqual(['series']);
    const window = windowOf('kemarin', NOW, TZ)!;
    expect(getGraph).toHaveBeenCalledWith({ ids: ['5'], from: window.from, to: window.to, points: 12, now: NOW });
    expect(blocks[0].split('\n')[0]).toContain('SERIES of 4.3.3 FPSO ARUBA 3 over yesterday');
    expect(blocks[0]).toContain('lowest 2 %, average 6.4 %, highest 38 %, last 7 %');
  });

  it('reads the last 24 hours when the question names no time, and asks for a peak only beside a time', async () => {
    vi.mocked(readHostValues).mockResolvedValue([cpu] as never);
    vi.mocked(getGraph).mockResolvedValue(graph);
    await buildDetails(everything({ question: 'grafik CPU 4.3.3 FPSO ARUBA 3?', hosts: [ARUBA] }));
    expect(vi.mocked(getGraph).mock.calls[0][0]).toMatchObject({ from: NOW - 86_400, to: NOW });
    const peak = await buildDetails(everything({ question: 'CPU tertinggi 4.3.3 FPSO ARUBA 3 minggu ini?', hosts: [ARUBA] }));
    expect(peak.topics).toEqual(['series']);
    const now = await buildDetails(everything({ question: 'CPU tertinggi 4.3.3 FPSO ARUBA 3 sekarang?', hosts: [ARUBA] }));
    expect(now.topics).toEqual(['values']);
  });

  it('needs a host, and falls back to the plain value for a user without the Graphs page', async () => {
    vi.mocked(readHostValues).mockResolvedValue([cpu] as never);
    vi.mocked(topHostsView).mockResolvedValue({ generatedAt: NOW, metrics: [] });
    const nobody = await buildDetails(everything({ question: 'rata-rata CPU kemarin berapa?' }));
    expect(nobody.topics).toEqual([]);
    expect(getGraph).not.toHaveBeenCalled();
    const plain = await buildDetails(everything({ question: 'rata-rata CPU 4.3.3 FPSO ARUBA 3 kemarin?', hosts: [ARUBA], can: only('latest', 'hosts') }));
    expect(plain.topics).toEqual(['values']);
    expect(getGraph).not.toHaveBeenCalled();
  });

  it('says that no item of that kind was found, and that a read failed', async () => {
    vi.mocked(readHostValues).mockResolvedValue([]);
    expect((await buildDetails(everything({ question: 'rata-rata CPU 4.3.3 FPSO ARUBA 3 kemarin?', hosts: [ARUBA] }))).blocks[0]).toBe('SERIES of 4.3.3 FPSO ARUBA 3: no item of that kind was found on this host');
    vi.mocked(readHostValues).mockResolvedValue([cpu] as never);
    vi.mocked(getGraph).mockRejectedValue(new Error('Zabbix did not answer'));
    expect((await buildDetails(everything({ question: 'rata-rata CPU 4.3.3 FPSO ARUBA 3 kemarin?', hosts: [ARUBA] }))).blocks[0]).toContain('SERIES of 4.3.3 FPSO ARUBA 3: could not be read from Zabbix in time');
  });
});

describe('buildDetails: a single port', () => {
  const found = { rows: [{ index: 12, name: 'Gi1/0/12', alias: 'Uplink', operStatus: 'up', speed: 1e9, inBps: 1.2e7, outBps: 3e6, utilisation: 1.2, inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, lastclock: NOW - 120, itemids: {} }], total: 1 } as never;

  it('gives the port of the host the question named', async () => {
    vi.mocked(readPort).mockResolvedValue(found);
    const { blocks, topics } = await buildDetails(everything({ question: 'port Gi1/0/12 di 4.3.3 FPSO ARUBA 3 up atau down?', hosts: [ARUBA] }));
    expect(topics).toContain('port');
    expect(readPort).toHaveBeenCalledWith('41', 'Gi1/0/12');
    expect(blocks.find((b) => b.startsWith('PORT'))).toContain('- Gi1/0/12 (Uplink): up; speed 1 Gbps');
  });

  it('needs a host, and the network pages', async () => {
    await buildDetails(everything({ question: 'port Gi1/0/12 up atau down?' }));
    await buildDetails(everything({ question: 'port Gi1/0/12 di 4.3.3 FPSO ARUBA 3 up atau down?', hosts: [ARUBA], can: only('hosts', 'latest') }));
    expect(readPort).not.toHaveBeenCalled();
  });

  it('says that the read failed', async () => {
    vi.mocked(readPort).mockRejectedValue(new Error('Zabbix did not answer'));
    const { blocks } = await buildDetails(everything({ question: 'port Gi1/0/12 di 4.3.3 FPSO ARUBA 3 up atau down?', hosts: [ARUBA] }));
    expect(blocks.find((b) => b.startsWith('PORT'))).toContain('PORT Gi1/0/12 of 4.3.3 FPSO ARUBA 3: could not be read from Zabbix in time');
  });
});

describe('buildDetails: the report pages', () => {
  const capacity = { days: 7, metrics: [{ key: 'cpu', label: 'CPU utilisation', rows: [{ metric: 'cpu', label: 'cpu', itemid: '1', hostid: '1', host: 'A-FW1', name: 'n', units: '%', avg: 30, max: 95, source: 'trend' }] }] } as never;
  const noise = { from: 0, to: 1, windowSeconds: 7 * 86_400, minSeverity: 0, truncated: false, totalEvents: 100, distinctTriggers: 10, concentration: { topN: 5, percentOfEvents: 60 }, counts: { flapping: 1, unactioned: 2, chronic: 3 }, thresholds: { shortSeconds: 300, minCount: 5 }, total: 1, triggers: [{ objectid: '1', name: 'Link down', host: 'A-SW1', hostid: '1', severity: '3', count: 12, medianDuration: 120, shortLived: 1, ackRate: 0, totalDuration: 1, longest: 1, stillOpen: false, flags: ['flapping'] }] } as never;
  const triggers = { triggers: [{ objectid: '1', name: 'Unavailable by ICMP ping', severity: '4', host: 'A-FW1', count: 200 }], truncated: false, days: 7 } as never;
  const card = { dimensions: [{ key: 'owner', label: 'Owner', hint: '', present: 4, total: 140, pct: 3, scored: true }], overall: { hosts: 140, complete: 0, pct: 0 }, groups: [], gaps: [] } as never;

  it('reads the capacity report at the period the Capacity page offers that covers the question', async () => {
    vi.mocked(getCapacityReport).mockResolvedValue(capacity);
    const { blocks, topics } = await buildDetails(everything({ question: 'host mana yang kapasitasnya paling penuh?' }));
    expect(topics).toEqual(['capacity']);
    expect(getCapacityReport).toHaveBeenCalledWith(7, 10, undefined);
    expect(blocks[0]).toContain('- CPU utilisation: A-FW1 average 30 %, peak 95 %');
    await buildDetails(everything({ question: 'kapasitas CPU 20 hari terakhir' }));
    expect(getCapacityReport).toHaveBeenLastCalledWith(30, 10, undefined);
    // The bare word is also a link's bandwidth, so it waits for a metric or a host (BK-87).
    vi.mocked(getCapacityReport).mockClear();
    await buildDetails(everything({ question: 'kapasitas 20 hari terakhir' }));
    expect(getCapacityReport).not.toHaveBeenCalled();
  });

  it('reads the noise report and the top triggers for the days the question names, sharing the pages\' defaults otherwise', async () => {
    vi.mocked(getNoiseReport).mockResolvedValue(noise);
    vi.mocked(getTopTriggers).mockResolvedValue(triggers);
    const n = await buildDetails(everything({ question: 'alert apa yang paling berisik?' }));
    expect(getNoiseReport).toHaveBeenCalledWith(7, 0, 5, undefined);
    expect(n.blocks[0]).toContain('ALERT NOISE over the last 7 days: 100 alerts from 10 triggers');
    const t = await buildDetails(everything({ question: 'trigger paling sering muncul 14 hari terakhir?' }));
    // 14 days is not a period of the page: the next one it offers, 30, is read, so that the read is the page's own (BK-88).
    expect(getTopTriggers).toHaveBeenCalledWith(30, undefined);
    expect(t.blocks[0]).toContain('- [High] A-FW1: Unavailable by ICMP ping x200');
  });

  it('gives the inventory scorecard to an administrator and to no one else', async () => {
    vi.mocked(getScorecard).mockResolvedValue(card);
    const admin = await buildDetails(everything({ question: 'berapa persen host yang punya owner? scorecard inventory' }));
    expect(admin.blocks[0]).toContain('INVENTORY AND OWNERSHIP SCORECARD: 0 percent of 140 hosts');
    await buildDetails(everything({ question: 'scorecard inventory berapa?', admin: false }));
    expect(getScorecard).toHaveBeenCalledTimes(1);
  });

  it('gives each report only to a user who has its page', async () => {
    await buildDetails(everything({ question: 'kapasitas paling penuh?', can: only('problems') }));
    await buildDetails(everything({ question: 'alert paling berisik?', can: only('problems') }));
    await buildDetails(everything({ question: 'trigger paling sering muncul?', can: only('problems') }));
    expect(getCapacityReport).not.toHaveBeenCalled();
    expect(getNoiseReport).not.toHaveBeenCalled();
    expect(getTopTriggers).not.toHaveBeenCalled();
  });

  it('says that a report not read before is still being worked out, and that another failure is a failed read', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getCapacityReport).mockReturnValue(new Promise(() => undefined));
      const pending = buildDetails(everything({ question: 'kapasitas paling penuh?' }));
      await vi.advanceTimersByTimeAsync(9_500);
      expect((await pending).blocks[0]).toContain('CAPACITY: is still being worked out');
    } finally {
      vi.useRealTimers();
    }
    vi.mocked(getNoiseReport).mockRejectedValue(new Error('Zabbix did not answer'));
    expect((await buildDetails(everything({ question: 'alert paling berisik?' }))).blocks[0]).toContain('ALERT NOISE: could not be read from Zabbix in time');
  });
});

describe('buildDetails: the maps', () => {
  it('gives what the host the question named is linked to on the maps, as the user\'s pages allow', async () => {
    vi.mocked(readHostMaps).mockResolvedValue({ total: 3, scanned: 3, on: [{ map: 'FPSO', linkedTo: [{ name: '4.3.1 FPSO ARUBA 1', via: '10G' }] }] });
    const { blocks, topics } = await buildDetails(everything({ question: 'apa yang terhubung ke 4.3.3 FPSO ARUBA 3 di peta?', hosts: [ARUBA] }));
    expect(topics).toEqual(['maps']);
    expect(readHostMaps).toHaveBeenCalledWith('41', { network: true });
    expect(blocks[0]).toContain('- "FPSO": linked to 4.3.1 FPSO ARUBA 1 (10G)');
    await buildDetails(everything({ question: 'apa yang terhubung ke 4.3.3 FPSO ARUBA 3 di peta?', hosts: [ARUBA], can: only('maps', 'hosts') }));
    expect(readHostMaps).toHaveBeenLastCalledWith('41', { network: false });
  });

  it('lists the maps when it asks for them and names no host', async () => {
    vi.mocked(readMapNames).mockResolvedValue(['Jakarta core', 'Pasuruan']);
    const { blocks } = await buildDetails(everything({ question: 'peta apa saja yang ada?' }));
    expect(blocks[0].split('\n')).toEqual(['MAPS (2):', '- Jakarta core', '- Pasuruan']);
  });

  it('reads nothing for a question that is about connection but not about a map or a host, or for a user without the Maps page', async () => {
    expect((await buildDetails(everything({ question: 'siapa yang terhubung?' }))).blocks).toEqual([]);
    await buildDetails(everything({ question: 'peta apa saja yang ada?', can: only('problems') }));
    expect(readMapNames).not.toHaveBeenCalled();
  });

  it('says that the read failed', async () => {
    vi.mocked(readHostMaps).mockRejectedValue(new Error('Zabbix did not answer'));
    expect((await buildDetails(everything({ question: 'apa yang terhubung ke 4.3.3 FPSO ARUBA 3 di peta?', hosts: [ARUBA] }))).blocks[0]).toContain('MAPS: could not be read from Zabbix in time');
  });
});
