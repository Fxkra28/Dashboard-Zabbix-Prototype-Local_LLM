import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/sli.js', () => ({ getMonthlySli: vi.fn() }));
vi.mock('../sli/tree.js', () => ({ getDerivedServices: vi.fn() }));
import { getMonthlySli } from '../services/sli.js';
import { getDerivedServices } from '../sli/tree.js';
import { derivedServiceLines, derivedSlaLines } from '../sli/summary.js';

// The assistant reads these lines out to people, so a missed figure must not read as the target.
const report = (sli: number | null, over: Record<string, unknown> = {}) => ({
  target: 99,
  overall: { sli, meeting: sli === null ? null : sli >= 99, withData: 3, hosts: 3 },
  sites: [{ name: 'JKT', sli }],
  hosts: [{ name: 'sw-1', sli, measured: true }],
  ...over,
});

beforeEach(() => vi.resetAllMocks());

describe('derivedSlaLines', () => {
  it('prints a missed 98.996 against 99 as 98.996, in every line it appears', async () => {
    vi.mocked(getMonthlySli).mockResolvedValue(report(98.996) as never);
    const text = (await derivedSlaLines()).join('\n');
    expect(text).toMatch(/: 98\.996% strict, missed/);
    expect(text).toMatch(/report method: 98\.996% \(/);
    expect(text).toMatch(/so far: 98\.996% strict/);
    expect(text).toContain('JKT 98.996%');
    expect(text).toContain('Worst devices');
    expect(text).toContain('sw-1 98.996%');
    expect(text).not.toContain('99.00%');
  });

  it('keeps two decimals for an ordinary figure and says no data for a missing one', async () => {
    vi.mocked(getMonthlySli).mockResolvedValue(report(99.384, { sites: [], hosts: [] }) as never);
    expect((await derivedSlaLines()).join('\n')).toContain('99.38% strict, met');

    vi.mocked(getMonthlySli).mockResolvedValue(report(null, { sites: [], hosts: [] }) as never);
    expect((await derivedSlaLines()).join('\n')).toContain('no data strict');
  });
});

describe('derivedServiceLines', () => {
  it('prints a missed service figure as it is, not as the target', async () => {
    vi.mocked(getDerivedServices).mockResolvedValue({
      target: 99,
      tree: [{ children: [{ name: 'Access', worst: 2, problems: [], sla: { sli: 98.996 } }] }],
    } as never);
    expect(await derivedServiceLines()).toEqual(['- Access: 98.996% this month']);
  });
});
