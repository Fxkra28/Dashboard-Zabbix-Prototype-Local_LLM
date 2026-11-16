import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SliReport } from '../sli/engine.js';

/** `windowSeconds` of the derived availability report is the span of its figures, not the length of a month that is still running (BK-65). */

const { monthly, computed } = vi.hoisted(() => ({ monthly: vi.fn(), computed: vi.fn() }));
vi.mock('../services/sli.js', () => ({ getMonthlySli: monthly }));
vi.mock('../sli/engine.js', async (original) => ({ ...(await original<typeof import('../sli/engine.js')>()), computeSli: computed }));

const NOON = 1_788_000_000; // a moment inside the month below
const MONTH_START = NOON - 10 * 86_400;
const MONTH_END = MONTH_START + 30 * 86_400;

const report = (over: Partial<SliReport>): SliReport =>
  ({
    source: 'derived',
    label: '',
    profile: 'availability',
    month: '2026-11',
    from: MONTH_START,
    to: MONTH_END,
    end: NOON,
    closed: false,
    hosts: [],
    categories: [],
    sites: [],
    gaps: [],
    noDataWindows: [],
    target: 99,
    overall: {},
    ...over,
  }) as unknown as SliReport;

beforeEach(() => {
  monthly.mockReset();
  computed.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOON * 1000);
});

describe('getDerivedAvailability: windowSeconds', () => {
  it('ends at the figures for a month still running, so that to - from is the window', async () => {
    monthly.mockResolvedValue(report({}));
    const { getDerivedAvailability } = await import('../services/availability.js');
    const out = await getDerivedAvailability({ days: 7, month: '2026-11', profile: 'availability', minSeverity: 2 });
    expect(out.to).toBe(NOON);
    expect(out.windowSeconds).toBe(out.to - out.from);
    expect(out.windowSeconds).toBe(10 * 86_400);
  });

  it('is the whole month once the month has closed', async () => {
    monthly.mockResolvedValue(report({ end: MONTH_END, closed: true }));
    const { getDerivedAvailability } = await import('../services/availability.js');
    const out = await getDerivedAvailability({ days: 7, month: '2026-11', profile: 'availability', minSeverity: 2 });
    expect(out.windowSeconds).toBe(30 * 86_400);
    expect(out.windowSeconds).toBe(out.to - out.from);
  });

  it('is the length of the days asked for a rolling window', async () => {
    computed.mockImplementation(async (o: { from: number; to: number }) => report({ month: null, from: o.from, to: o.to, end: o.to }));
    const { getDerivedAvailability } = await import('../services/availability.js');
    const out = await getDerivedAvailability({ days: 7, profile: 'availability', minSeverity: 2 });
    expect(out.windowSeconds).toBe(7 * 86_400);
    expect(out.windowSeconds).toBe(out.to - out.from);
  });
});
