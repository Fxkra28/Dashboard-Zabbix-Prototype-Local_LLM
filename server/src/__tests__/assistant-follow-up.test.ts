import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../core/cache.js';
import { buildFocus } from '../services/assistant.js';
import { getProblems } from '../domain/queries.js';
import { getSites } from '../services/sites.js';
import { topHostsView } from '../services/topHosts.js';

/**
 * A follow-up that names no host and no site is about the one before it (BK-90): "dan CPU-nya?" after "Ada yang down di FPSO KAS3?" is about FPSO KAS3, not about the busiest hosts of the whole
 * estate. A message that names one is about that one, and a message that asks about no thing is about none.
 */
vi.mock('../domain/queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/queries.js')>();
  const { cached } = await import('../core/cache.js');
  const getProblems = vi.fn();
  return { ...actual, getProblems, cachedProblems: () => cached('problems', actual.PROBLEMS_TTL_MS, getProblems), withOpdata: async (problems: unknown[]) => problems };
});
vi.mock('../services/sites.js', async () => {
  const { cached } = await import('../core/cache.js');
  const getSites = vi.fn();
  return { getSites, sitesView: () => cached('sites', 15_000, getSites) };
});
vi.mock('../services/topHosts.js', () => ({ topHostsView: vi.fn() }));

const NOW = Math.floor(Date.now() / 1000);
const host = (over: Record<string, unknown> = {}) => ({ hostid: '1', name: '4.3.3 FPSO ARUBA 3', status: '0', availability: 'available', state: 'up', reason: 'ping', siteSource: 'name', problems: { total: 0, bySeverity: {} }, ...over });

beforeEach(() => {
  invalidate('');
  vi.mocked(getProblems).mockResolvedValue([]);
  vi.mocked(getSites).mockResolvedValue({
    sites: [
      { name: 'FPSO KAS3 & BD-WHP', total: 1, hosts: [host()] },
      { name: 'MOPU / MAC', total: 1, hosts: [host({ hostid: '2', name: '11.1 MOPU-SW01' })] },
    ],
    coverage: { hosts: 2, tag: 2, inventory: 0, group: 0 },
  } as never);
  vi.mocked(topHostsView).mockResolvedValue({ generatedAt: NOW, metrics: [{ key: 'cpu', label: 'CPU utilisation', considered: 2, current: 2, rows: [{ hostid: '1', host: '4.3.3 FPSO ARUBA 3', itemid: '1', value: 61, clock: NOW }, { hostid: '2', host: '11.1 MOPU-SW01', itemid: '2', value: 40, clock: NOW }] }] } as never);
});

describe('a follow-up with no name (BK-90)', () => {
  it('is about the site of the message before it', async () => {
    const focus = await buildFocus('dan CPU-nya?', null, { previous: 'Ada yang down di FPSO KAS3?' });
    expect(focus?.sites).toEqual(['FPSO KAS3 & BD-WHP']);
    expect(focus?.text).toContain('FOCUS: FPSO KAS3 & BD-WHP');
    expect(focus?.text).toContain('HIGHEST CPU NOW at FPSO KAS3 & BD-WHP');
    expect(focus?.text).not.toContain('BUSIEST HOSTS NOW');
  });

  it('is about the host of the message before it', async () => {
    const focus = await buildFocus('dan suhunya?', null, { previous: 'Bagaimana 11.1 MOPU-SW01 sekarang?' });
    expect(focus?.hosts).toEqual(['11.1 MOPU-SW01']);
  });

  it('is about the whole estate, and says that nothing was named, when the message before it names nothing either', async () => {
    const focus = await buildFocus('dan CPU-nya?', null, { previous: 'Apa kabar?' });
    expect(focus?.sites).toEqual([]);
    expect(focus?.text).toContain('BUSIEST HOSTS NOW');
    expect(focus?.text).toContain('no host or site was named in this question or the one before it');
  });

  it('is about the one it names, and not the one before it, when it names a host or a site', async () => {
    const host = await buildFocus('berapa CPU 4.3.3 FPSO ARUBA 3?', null, { previous: 'Ada yang down di MOPU?' });
    expect(host?.hosts).toEqual(['4.3.3 FPSO ARUBA 3']);
    expect(host?.text).not.toContain('MOPU');
    const site = await buildFocus('dan di MOPU?', null, { previous: 'Ada yang down di FPSO KAS3?' });
    expect(site?.sites).toEqual(['MOPU / MAC']);
  });

  it('is about none when it asks about no thing: thanks and greetings do not bring the focus back', async () => {
    expect(await buildFocus('terima kasih', null, { previous: 'Ada yang down di FPSO KAS3?' })).toBeNull();
    expect(await buildFocus('halo', null)).toBeNull();
  });
});
