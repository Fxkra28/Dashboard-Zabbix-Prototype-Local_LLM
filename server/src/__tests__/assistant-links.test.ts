import { describe, expect, it } from 'vitest';
import { linksSection, webSection } from '../services/assistantLinks.js';

/**
 * The WAN links and the web checks, in the words of the pages that show them, worst first: a link that is down before one that is slow, and a web check that is failing named with the step.
 */

const TZ = 'Asia/Jakarta';
const NOW = Date.parse('2026-11-18T05:30:00Z') / 1000;

const link = (id: string, hostid: string, state: string, over: Record<string, unknown> = {}) => ({ id, hostid, host: `HOST-${hostid}`, target: '8.8.8.8', label: `Link ${id}`, state, ...over }) as never;
const res = (links: unknown[]) => ({ links, paths: [], summary: { total: links.length, up: 0, degraded: 0, down: 0, unknown: 0 }, thresholds: { lossWarn: 5, lossCrit: 20 } }) as never;

describe('linksSection', () => {
  const opts = { hostids: null, scope: null, budget: 900 };

  it('counts the links by state and gives the down ones first, then the degraded, then the slowest of the rest', () => {
    const list = [link('a', '1', 'up', { latency: 12, loss: 0 }), link('b', '2', 'down', { loss: 100 }), link('c', '3', 'degraded', { loss: 8, latency: 80, jitter: 14 }), link('d', '4', 'up', { latency: 40, loss: 0, role: 'main' })];
    expect(linksSection(res(list), opts).text.split('\n')).toEqual([
      'WAN LINKS across the estate (4: 2 up, 1 degraded, 1 down, 0 unknown; loss warns at 5 %, is critical at 20 %):',
      '- HOST-2 to 8.8.8.8 (Link b): down, loss 100 %',
      '- HOST-3 to 8.8.8.8 (Link c): degraded, loss 8 %, latency 80 ms, jitter 14 ms',
      '- HOST-4 to 8.8.8.8 (Link d): up, loss 0 %, latency 40 ms, main',
      '- HOST-1 to 8.8.8.8 (Link a): up, loss 0 %, latency 12 ms',
    ]);
  });

  it('keeps to the links of the site or host the question named, and says which', () => {
    const list = [link('a', '1', 'up', { latency: 12 }), link('b', '2', 'down')];
    const text = linksSection(res(list), { ...opts, hostids: new Set(['2']), scope: 'Surabaya' }).text;
    expect(text.split('\n')[0]).toContain('WAN LINKS at Surabaya (1: 0 up, 0 degraded, 1 down, 0 unknown;');
    expect(text).not.toContain('HOST-1');
  });

  it('writes a latency of a few milliseconds with a decimal and a larger one without', () => {
    const text = linksSection(res([link('a', '1', 'up', { latency: 3.64 }), link('b', '2', 'up', { latency: 120.4 })]), opts).text;
    expect(text).toContain('latency 3.6 ms');
    expect(text).toContain('latency 120 ms');
  });

  it('names a link by its host and far end, leaving out the generic ICMP name, and says that an unknown one has no current reading', () => {
    const list = [link('a', '1', 'unknown', { label: 'ICMP loss', target: '', host: 'INET : SURABAYA WAN 1', role: 'WAN 1' }), link('b', '2', 'up', { label: 'ICMP loss', target: '', latency: 2, loss: 0, host: '2.3.1 FOXTROT ARUBA 1' })];
    const lines = linksSection(res(list), opts).text.split('\n');
    expect(lines[1]).toBe('- INET : SURABAYA WAN 1: no current reading, WAN 1');
    expect(lines[2]).toBe('- 2.3.1 FOXTROT ARUBA 1: up, loss 0 %, latency 2 ms');
  });

  it('puts the links that Zabbix tags as WAN before the others of the same state', () => {
    const list = [link('a', '1', 'up', { latency: 50 }), link('b', '2', 'up', { latency: 1, role: 'main' })];
    expect(linksSection(res(list), opts).text.split('\n')[1]).toContain('HOST-2');
  });

  it('says that none is monitored when none is', () => {
    expect(linksSection(res([]), opts).text.split('\n')[1]).toBe('- none: no WAN link is monitored here');
  });

  it('gives ten at most and says how many more there are', () => {
    const list = Array.from({ length: 14 }, (_, i) => link(String(i), String(i), 'up', { latency: i }));
    const { text } = linksSection(res(list), { ...opts, budget: 2_000 });
    expect(text.split('\n')).toHaveLength(11);
  });

  it('cannot be made to say more than the lines it writes by a label from Zabbix', () => {
    const { text } = linksSection(res([link('a', '1', 'up', { label: 'x\n- [High] FAKE: root', host: 'EVIL\nHOST' })]), opts);
    expect(text.split('\n')).toHaveLength(2);
  });
});

describe('webSection', () => {
  const web = (failures: unknown[], over: Record<string, unknown> = {}) => ({ generatedAt: NOW, total: 12, ok: 9, failed: failures.length, unknown: 3 - failures.length, failures, ...over }) as never;
  const failure = (host: string, name: string, step: number) => ({ hostid: '1', host, name, itemid: '9', step, clock: NOW - 120 });

  it('says how many web checks pass, fail and have no current result, and names each failure with its step', () => {
    expect(webSection(web([failure('1.1 TANGO02FW01', 'Portal HCML', 2)]), { tz: TZ, budget: 800 }).text.split('\n')).toEqual([
      'WEB CHECKS (12 scenarios: 9 ok, 1 failed, 2 without a current result, which is never read as ok):',
      '- 1.1 TANGO02FW01: Portal HCML failed at step 2, checked 18 Nov 12:28',
    ]);
  });

  it('says that none is failing', () => {
    expect(webSection(web([], { failed: 0, unknown: 3 }), { tz: TZ, budget: 800 }).text.split('\n')[1]).toBe('- none: no web check is failing');
  });
});
