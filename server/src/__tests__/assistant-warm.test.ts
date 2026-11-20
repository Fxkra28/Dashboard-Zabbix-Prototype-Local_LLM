import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmFor } from '../services/assistantFocus.js';
import { readInternet } from '../services/assistantInternet.js';
import { linksView } from '../services/links.js';
import { sitesView } from '../services/sites.js';
import { topHostsView } from '../services/topHosts.js';
import { webMonitoringView } from '../services/webMonitoring.js';

vi.mock('../services/assistantInternet.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/assistantInternet.js')>()), readInternet: vi.fn() }));
vi.mock('../services/sites.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/sites.js')>()), sitesView: vi.fn() }));
vi.mock('../services/topHosts.js', () => ({ topHostsView: vi.fn() }));
vi.mock('../services/links.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/links.js')>()), linksView: vi.fn() }));
vi.mock('../services/webMonitoring.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/webMonitoring.js')>()), webMonitoringView: vi.fn() }));

/**
 * The first question after a quiet spell. HCML's Zabbix takes 15 to 45 seconds to build the gauges and the list of busiest hosts, and the portal keeps each for ten minutes after the last request, so a
 * question that needs one waits for it, and an answer is never written as if the data were not there. A question that needs neither waits for nothing.
 */

const SITES = { sites: [{ name: 'Surabaya', hosts: [{ hostid: '22', name: '2.2.1 BRAVO-SW01' }] }] } as never;
const everything = null;
const only = (...ids: string[]) => new Set(ids);

beforeEach(() => {
  vi.mocked(readInternet).mockReset().mockResolvedValue({ status: 'ok', meters: [], generatedAt: 0 } as never);
  vi.mocked(topHostsView).mockReset().mockResolvedValue({ generatedAt: 0, metrics: [] });
  vi.mocked(sitesView).mockReset().mockResolvedValue(SITES);
  vi.mocked(linksView).mockReset().mockResolvedValue({ links: [], paths: [], summary: { total: 0, up: 0, degraded: 0, down: 0, unknown: 0 }, thresholds: { lossWarn: 5, lossCrit: 20 } });
  vi.mocked(webMonitoringView).mockReset().mockResolvedValue({ generatedAt: 0, total: 0, ok: 0, failed: 0, unknown: 0, failures: [] });
});
afterEach(() => vi.useRealTimers());

describe('warmFor', () => {
  it('waits for the internet gauges when the question is about the links', async () => {
    await warmFor('berapa kecepatan internet di surabaya?', everything);
    expect(readInternet).toHaveBeenCalledWith(50_000);
    expect(topHostsView).not.toHaveBeenCalled();
  });

  it('does not touch the gauges for a user without the network pages', async () => {
    await warmFor('berapa kecepatan internet di surabaya?', only('problems', 'sites'));
    expect(readInternet).not.toHaveBeenCalled();
  });

  it('waits for the list of busiest hosts when the question is about the CPU or the memory of a site or of nothing in particular', async () => {
    await warmFor('CPU tertinggi di surabaya berapa?', everything);
    expect(topHostsView).toHaveBeenCalledWith(Number.POSITIVE_INFINITY);
    await warmFor('host mana memorinya paling penuh?', everything);
    expect(topHostsView).toHaveBeenCalledTimes(2);
  });

  it('does not wait for the list when a host is named, which is read by its own items', async () => {
    await warmFor('berapa CPU 2.2.1 BRAVO-SW01?', everything);
    expect(topHostsView).not.toHaveBeenCalled();
  });

  it('waits for the WAN links for a question about them and for the web checks for a question about those, for the users who have those pages', async () => {
    await warmFor('link WAN mana yang down?', everything);
    expect(linksView).toHaveBeenCalledTimes(1);
    await warmFor('web check mana yang gagal?', everything);
    expect(webMonitoringView).toHaveBeenCalledTimes(1);
    await warmFor('link WAN mana yang down?', only('problems', 'network'));
    await warmFor('web check mana yang gagal?', only('problems', 'links'));
    expect(linksView).toHaveBeenCalledTimes(1);
    expect(webMonitoringView).toHaveBeenCalledTimes(1);
  });

  it('does not read the list for a user without the Latest data page', async () => {
    await warmFor('CPU tertinggi di surabaya berapa?', only('problems', 'sites'));
    expect(topHostsView).not.toHaveBeenCalled();
  });

  it('waits for nothing when the question needs neither', async () => {
    await warmFor('apa yang perlu diperhatikan sekarang?', everything);
    expect(readInternet).not.toHaveBeenCalled();
    expect(topHostsView).not.toHaveBeenCalled();
    expect(sitesView).not.toHaveBeenCalled();
  });

  it('does not hold a question past the wait when a read takes longer, and the read goes on', async () => {
    vi.useFakeTimers();
    vi.mocked(topHostsView).mockReturnValue(new Promise(() => undefined));
    let done = false;
    const waiting = warmFor('CPU tertinggi di surabaya berapa?', everything).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(49_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await waiting;
    expect(done).toBe(true);
  });

  it('never throws, whatever fails', async () => {
    vi.mocked(readInternet).mockRejectedValue(new Error('Zabbix did not answer'));
    vi.mocked(topHostsView).mockRejectedValue(new Error('Zabbix did not answer'));
    vi.mocked(sitesView).mockRejectedValue(new Error('Zabbix did not answer'));
    await expect(warmFor('CPU dan kecepatan internet di surabaya?', everything)).resolves.toBeUndefined();
  });
});
