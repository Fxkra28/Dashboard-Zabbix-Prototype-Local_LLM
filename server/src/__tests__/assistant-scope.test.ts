import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../core/cache.js';
import { ALL_SECTIONS, buildFocus, buildSnapshot, chatSystem, getSnapshot, mayFocus, mayInternet, SECTION_MODULES, sectionsFor, SNAPSHOT_CHAR_CAP, withheldLine } from '../services/assistant.js';
import { MODULE_IDS, presetFor, type ModuleId } from '../security/modules.js';
import { getProblems } from '../domain/queries.js';
import { getSites } from '../services/sites.js';
import { getSlas, getSli } from '../services/sla.js';
import { getServiceTree } from '../services/services.js';
import { derivedServiceLines, derivedSlaLines } from '../sli/summary.js';
import { readInternet } from '../services/assistantInternet.js';

/**
 * The Assistant follows the grants (ADR-0017): the model is handed the parts of the estate that a user's own pages show, and nothing else, so a question cannot
 * bring out what a user was never given. Each kind of fact carries a marker that no other has, and a user must meet only the markers of the pages they hold.
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
// Only the read of the gauges is stood in for: the lines are the real ones.
vi.mock('../services/assistantInternet.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantInternet.js')>()), readInternet: vi.fn() }));

const NOW = Math.floor(Date.now() / 1000);

/** What each part of the text says that no other part does. */
const MARKER = {
  estate: 'ESTATE: 3 hosts at 1 sites',
  whole: 'OPEN PROBLEMS, COUNTED',
  sites: 'SITES (1, worst first',
  recent: 'NEW IN LAST 24 H',
  unreachable: 'MARKER-UNREACHABLE-HOST',
  internet: 'MARKER-INTERNET-LINK',
  sla: 'MARKER-SLA-FIGURE',
  services: 'MARKER-DEGRADED-SERVICE',
  problems: 'MARKER-OPEN-PROBLEM-NAME',
} as const;

/** One gauge of the Internet view, with a title no other part of the text carries. */
const gauge = (over: Record<string, unknown> = {}) => ({
  id: '1', title: 'MARKER-INTERNET-LINK', page: 'Global view', host: '4.1 FG60F-FPSO-01', hostid: '9', item: 'Interface wan1(): Bits received', itemid: '90', direction: 'in', link: 'up',
  other: { direction: 'out', itemid: '91', value: 1_000_000, clock: NOW, fraction: 0.02, zone: 'low' }, units: 'bps', value: 12_000_000, clock: NOW, min: 0, max: 50_000_000, zones: [], fraction: 0.24, zone: 'low', state: 'ok', ...over,
});

const host = (over: Record<string, unknown> = {}) => ({ hostid: '1', name: '4.3.3 FPSO ARUBA 3', status: '0', availability: 'available', state: 'up', reason: 'ping', siteSource: 'name', problems: { total: 0, bySeverity: {} }, ...over });

beforeEach(() => {
  invalidate('');
  vi.mocked(getProblems).mockResolvedValue([
    { eventid: '180', objectid: '1', object: '0', name: 'MARKER-OPEN-PROBLEM-NAME', severity: '3', clock: String(NOW - 3600), r_eventid: '0', acknowledged: '0', opdata: '', tags: [], host: '4.3.3 FPSO ARUBA 3', hostid: '1' },
  ] as never);
  vi.mocked(getSites).mockResolvedValue({
    sites: [{ name: 'FPSO KAS3 & BD-WHP', total: 3, available: 2, unavailable: 1, unknown: 0, up: 2, down: 1, degraded: 0, nodata: 0, maintenance: 0, disabled: 0, problems: 1, unacknowledged: 1, bySeverity: { '3': 1 }, worst: 3, hosts: [host(), host({ hostid: '2', name: '4.3.4 MARKER-UNREACHABLE-HOST', state: 'down', availability: 'unavailable' }), host({ hostid: '3', name: '4.3.5 FPSO ARUBA 5' })] }],
    coverage: { hosts: 3, tag: 3, inventory: 0, group: 0 },
  } as never);
  vi.mocked(getSlas).mockResolvedValue([]);
  vi.mocked(getSli).mockResolvedValue([]);
  vi.mocked(getServiceTree).mockResolvedValue({ tree: [], total: 0, degraded: 0, worst: -1 } as never);
  vi.mocked(derivedSlaLines).mockResolvedValue(['- Estate: 97.00% MARKER-SLA-FIGURE']);
  vi.mocked(derivedServiceLines).mockResolvedValue(['- MARKER-DEGRADED-SERVICE: High']);
  vi.mocked(readInternet).mockResolvedValue({ status: 'ok', meters: [gauge()], generatedAt: NOW } as never);
});

const met = (text: string) => (Object.keys(MARKER) as (keyof typeof MARKER)[]).filter((k) => text.includes(MARKER[k]));

describe('which parts of the estate a user is given', () => {
  it('gives an administrator, and a portal with sign-in off, every part, as before', async () => {
    const { text, meta } = await buildSnapshot();
    expect(met(text)).toEqual([...ALL_SECTIONS]);
    expect(meta).toMatchObject({ hosts: 3, sites: 1, problems: 1, unacknowledged: 1 });
    expect(meta.shown).toBeUndefined();
  });

  it('gives each user the parts of the modules they hold and no other part, whichever module it is', async () => {
    for (const id of MODULE_IDS) {
      const { text } = await buildSnapshot(sectionsFor(new Set<ModuleId>([id])));
      const owned = ALL_SECTIONS.filter((k) => (SECTION_MODULES[k] as readonly string[]).includes(id));
      expect(met(text), `only ${id}`).toEqual(owned);
    }
  });

  it('gives a user with no module that feeds the model nothing at all', async () => {
    const { text, meta } = await buildSnapshot(sectionsFor(new Set<ModuleId>(['assistant', 'graphs', 'maps', 'capacity'])));
    expect(text).toBe('');
    expect(met(text)).toEqual([]);
    expect(meta).toMatchObject({ hosts: 0, sites: 0, problems: 0, unacknowledged: 0, slas: 0, degradedServices: 0, shown: [] });
  });

  it('keeps what a part says out of the parts a user does not hold, in the counts of the context too', async () => {
    // Only the SLA: no problem, host, site or unreachable name, and no count of them in what the page is told.
    const { text, meta } = await buildSnapshot(sectionsFor(new Set<ModuleId>(['sla'])));
    expect(text).toContain(MARKER.sla);
    for (const secret of ['MARKER-OPEN-PROBLEM-NAME', 'MARKER-UNREACHABLE-HOST', 'MARKER-INTERNET-LINK', 'FPSO KAS3', 'FPSO ARUBA', 'ESTATE:']) expect(text, secret).not.toContain(secret);
    expect(meta).toMatchObject({ hosts: 0, sites: 0, problems: 0, unacknowledged: 0, shown: ['sla', 'services'] });
    // Only the problems: no host, site or SLA text, and no count of them.
    const problems = await buildSnapshot(sectionsFor(new Set<ModuleId>(['problems'])));
    expect(met(problems.text)).toEqual(['whole', 'recent', 'problems']);
    expect(problems.text).not.toContain('FPSO KAS3');
    expect(problems.text).not.toContain('MARKER-INTERNET-LINK');
    expect(problems.meta).toMatchObject({ hosts: 0, sites: 0, slas: 0, degradedServices: 0 });
    expect(problems.meta.problems).toBe(1);
  });

  it('gives the preset of each role the parts that role is meant to read', () => {
    // A guest has no network pages, so no Internet view and no internet links in what the model is given (ADR-0017).
    expect(sectionsFor(new Set(presetFor('guest')))).toEqual(ALL_SECTIONS.filter((k) => k !== 'internet'));
    expect(sectionsFor(new Set(presetFor('operator')))).toEqual([...ALL_SECTIONS]);
  });

  it('gives the internet links only to a user whose pages show the Internet view', async () => {
    const network = await buildSnapshot(sectionsFor(new Set<ModuleId>(['network'])));
    expect(met(network.text)).toEqual(['internet']);
    expect(network.text.split('\n')[0]).toMatch(/^INTERNET LINKS \(1 gauge on the Zabbix dashboard, read \d\d:\d\d: 1 with a reading, none High or Critical, 0 without one;/);
    for (const id of MODULE_IDS.filter((m) => m !== 'network')) {
      expect((await buildSnapshot(sectionsFor(new Set<ModuleId>([id])))).text, id).not.toContain('MARKER-INTERNET-LINK');
    }
    expect(mayInternet(new Set<string>(['network']))).toBe(true);
    expect(mayInternet(new Set<string>(['sites', 'hosts', 'dashboard', 'sla']))).toBe(false);
  });

  it('allows the focus on a site or a host only to a user whose pages show sites or hosts', () => {
    expect(mayFocus(new Set<string>(['sites']))).toBe(true);
    expect(mayFocus(new Set<string>(['hosts']))).toBe(true);
    expect(mayFocus(new Set<string>(['devices']))).toBe(true);
    expect(mayFocus(new Set<string>(['problems', 'sla', 'dashboard']))).toBe(false);
  });
});

describe('the copies kept for them', () => {
  it('keeps one for the whole text and one for each cut-down text, so that two users with the same pages share one and the others never see it', async () => {
    const whole = await getSnapshot();
    const sla = await getSnapshot(sectionsFor(new Set<ModuleId>(['sla'])));
    const again = await getSnapshot(sectionsFor(new Set<ModuleId>(['services'])));
    expect(met(whole.text)).toEqual([...ALL_SECTIONS]);
    expect(met(sla.text)).toEqual(['sla', 'services']);
    // `services` and `sla` own the same parts, so they are one copy, and it was built once.
    expect(again.text).toBe(sla.text);
    expect(again.frozen).toBe(true);
    // The whole copy is not handed to a user cut down, nor the other way round.
    expect(await getSnapshot()).toMatchObject({ text: whole.text, frozen: true });
    expect(met((await getSnapshot(sectionsFor(new Set<ModuleId>(['problems'])))).text)).toEqual(['whole', 'recent', 'problems']);
  });
});

describe('the internet links in the snapshot', () => {
  it('does not keep a snapshot built while the gauges were still being read, and builds it again with them', async () => {
    vi.mocked(readInternet).mockResolvedValue({ status: 'pending' });
    const early = await getSnapshot();
    expect(early.text).not.toContain('MARKER-INTERNET-LINK');
    expect(early.frozen).toBe(false);
    vi.mocked(readInternet).mockResolvedValue({ status: 'ok', meters: [gauge()], generatedAt: NOW } as never);
    const later = await getSnapshot();
    expect(later.text).toContain('MARKER-INTERNET-LINK');
    // The early one was never stored; this one is, and the next question is answered from it.
    expect(await getSnapshot()).toMatchObject({ text: later.text, frozen: true });
  });

  it('leaves the part out and keeps the snapshot when there is no gauge to read, instead of waiting for one that will not come', async () => {
    vi.mocked(readInternet).mockResolvedValue({ status: 'none' });
    const first = await getSnapshot();
    expect(met(first.text)).toEqual(ALL_SECTIONS.filter((k) => k !== 'internet'));
    expect((await getSnapshot()).frozen).toBe(true);
  });

  it('is not asked for at all by a user whose pages do not show it', async () => {
    vi.mocked(readInternet).mockClear();
    await buildSnapshot(sectionsFor(new Set<ModuleId>(['sla'])));
    expect(readInternet).not.toHaveBeenCalled();
  });

  it('stays within its own budget and within the cap, however many gauges there are', async () => {
    const many = Array.from({ length: 40 }, (_, i) => gauge({ id: String(i), title: `MARKER-INTERNET-LINK ${i}`, fraction: i / 40, value: i * 1_000_000 }));
    vi.mocked(readInternet).mockResolvedValue({ status: 'ok', meters: many, generatedAt: NOW } as never);
    const { sizes, meta, text } = await buildSnapshot();
    expect(sizes.internet).toBeLessThanOrEqual(700);
    expect(text.length).toBeLessThanOrEqual(SNAPSHOT_CHAR_CAP);
    expect(text).toContain('- …and more links, not listed here (a question naming their site lists them)');
    expect(meta.truncated).toBe(true);
  });
});

describe('the focus of a user whose pages show no problem lines (SC-65)', () => {
  const sitesOnly = new Set<ModuleId>(['sites', 'hosts', 'devices']);

  it('gives a site the count of its problems and not their names, to Sites, Hosts and Devices, and the lines to a user who holds Problems or the Dashboard, or to an administrator', async () => {
    const question = 'Ada yang down di FPSO KAS3?';
    const counts = await buildFocus(question, sitesOnly);
    expect(counts?.text).toContain('Open problems here: 1');
    expect(counts?.text).not.toContain('MARKER-OPEN-PROBLEM-NAME');
    expect(counts?.text).not.toContain('worst first');
    for (const modules of [new Set<ModuleId>(['sites', 'problems']), new Set<ModuleId>(['sites', 'dashboard']), null]) {
      expect((await buildFocus(question, modules))?.text, JSON.stringify(modules && [...modules])).toContain('MARKER-OPEN-PROBLEM-NAME');
    }
  });

  it('does the same for a host the question names', async () => {
    const question = 'berapa problem di 4.3.3 FPSO ARUBA 3?';
    const counts = await buildFocus(question, sitesOnly);
    expect(counts?.text).toContain('Open problems on this host: 1');
    expect(counts?.text).not.toContain('MARKER-OPEN-PROBLEM-NAME');
    expect((await buildFocus(question, new Set<ModuleId>(['hosts', 'problems'])))?.text).toContain('MARKER-OPEN-PROBLEM-NAME');
  });
});

describe('the line for the parts a user is not given (BK-84)', () => {
  it('names the parts that the pages of the user leave out, and none that they hold', () => {
    const line = withheldLine(sectionsFor(new Set<ModuleId>(['sla'])))!;
    expect(line).toMatch(/^NOT GIVEN TO THIS USER: /);
    expect(line).toContain('the open problems');
    expect(line).toContain('the sites');
    expect(line).not.toContain('the SLA figures');
    expect(line).toMatch(/never answer none or no/);
  });

  it('is none for a user who is shown every part', () => {
    expect(withheldLine(ALL_SECTIONS)).toBeNull();
    expect(withheldLine(sectionsFor(new Set<ModuleId>(MODULE_IDS)))).toBeNull();
  });

  it('goes into the system text after the snapshot and before the focus', () => {
    const system = chatSystem('SNAPSHOT TEXT', 'Ada masalah?', { focus: 'FOCUS TEXT', withheld: 'NOT GIVEN TO THIS USER: x', language: null });
    expect(system.indexOf('SNAPSHOT TEXT')).toBeLessThan(system.indexOf('NOT GIVEN TO THIS USER: x'));
    expect(system.indexOf('NOT GIVEN TO THIS USER: x')).toBeLessThan(system.indexOf('FOCUS TEXT'));
    expect(chatSystem('SNAPSHOT TEXT', 'Ada masalah?', { language: null })).not.toContain('NOT GIVEN');
  });
});
