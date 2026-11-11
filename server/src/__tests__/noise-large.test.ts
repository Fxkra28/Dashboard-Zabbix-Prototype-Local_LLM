import { describe, expect, it, vi } from 'vitest';
import type { Incident } from '../services/incidents.js';

/**
 * One trigger that flaps every minute for three months leaves over 125,000 incidents behind it.
 * Taking the longest of them with Math.max(...durations) throws RangeError at that size, and the
 * whole alert noise report answers 500 (BK-35).
 */
const { fetchIncidents } = vi.hoisted(() => ({ fetchIncidents: vi.fn() }));
vi.mock('../services/incidents.js', () => ({
  fetchIncidents,
  lastDays: (days: number) => ({ from: 1_000_000, to: 1_000_000 + days * 86_400 }),
}));

const { getNoise } = await import('../services/noise.js');

const FROM = 1_000_000;

function incident(i: number, over: Partial<Incident> = {}): Incident {
  const start = FROM + i * 10;
  return {
    eventid: String(i),
    objectid: '5001',
    host: 'sw-lt3',
    hostid: '10001',
    name: 'High ICMP ping loss',
    severity: '3',
    start,
    began: start,
    end: start + 5,
    resolved: true,
    acknowledged: false,
    ...over,
  };
}

describe('the alert noise report on a trigger with a very long list of incidents (BK-35)', () => {
  it('reports 200,000 incidents of one trigger, with the longest of them', async () => {
    const incidents = Array.from({ length: 200_000 }, (_, i) => incident(i));
    incidents[123_456] = incident(123_456, { end: FROM + 123_456 * 10 + 7_200 });
    fetchIncidents.mockResolvedValue({ incidents, from: FROM, to: FROM + 90 * 86_400, truncated: false });

    const report = await getNoise(90, 0);

    expect(report.totalEvents).toBe(200_000);
    expect(report.triggers).toHaveLength(1);
    const [trigger] = report.triggers;
    expect(trigger.count).toBe(200_000);
    expect(trigger.longest).toBe(7_200);
    expect(trigger.shortLived).toBe(199_999);
    expect(trigger.flags).toEqual(expect.arrayContaining(['flapping', 'unactioned']));
  });

  it('still finds the longest of a short list, and of one incident', async () => {
    fetchIncidents.mockResolvedValue({
      incidents: [incident(0), incident(1, { end: FROM + 10 + 90 }), incident(2, { objectid: '5002', end: FROM + 20 + 30 })],
      from: FROM,
      to: FROM + 86_400,
      truncated: false,
    });

    const report = await getNoise(1, 0);

    const byId = new Map(report.triggers.map((t) => [t.objectid, t]));
    expect(byId.get('5001')?.longest).toBe(90);
    expect(byId.get('5002')?.longest).toBe(30);
  });
});
