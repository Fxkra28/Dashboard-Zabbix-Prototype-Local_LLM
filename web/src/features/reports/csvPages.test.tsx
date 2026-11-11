import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import AlertNoise from './AlertNoise';
import Inventory from './Inventory';
import type { NoiseReport, NoisyTrigger, ScorecardResponse } from '../../types';

/** What the throwaway link was asked to save: its name and the text of the file. */
let saved: { name: string; text: Promise<string> }[];

beforeEach(() => {
  // The filters live in the address, and the address outlives a test.
  window.history.replaceState(null, '', '/');
  saved = [];
  let last: Blob | undefined;
  URL.createObjectURL = vi.fn((b: Blob) => ((last = b), 'blob:csv'));
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, text: last!.text() });
  });
});
afterEach(() => vi.restoreAllMocks());

const trigger = (name: string, host: string, flags: NoisyTrigger['flags']): NoisyTrigger => ({
  objectid: name,
  name,
  host,
  hostid: host,
  severity: '3',
  count: 12,
  medianDuration: 4,
  shortLived: 10,
  ackRate: 0,
  totalDuration: 50,
  longest: 9,
  stillOpen: false,
  flags,
});

const report = (triggers: NoisyTrigger[]): NoiseReport => ({
  from: 0,
  to: 604800,
  windowSeconds: 604800,
  minSeverity: 0,
  truncated: false,
  totalEvents: 30,
  distinctTriggers: triggers.length,
  concentration: { topN: 1, percentOfEvents: 50 },
  counts: { flapping: 1, unactioned: 1, chronic: 1 },
  thresholds: { shortSeconds: 60, minCount: 5 },
  total: triggers.length,
  triggers,
});

describe('the Alert noise CSV (FR-05)', () => {
  const triggers = [
    trigger('=HYPERLINK("http://evil","x")', 'sw-1', ['flapping']),
    trigger('Disk full', 'db-1', ['chronic']),
    trigger('\t+cmd', 'sw-2', []),
  ];
  beforeEach(() => void vi.spyOn(api, 'noise').mockResolvedValue(report(triggers)));

  it('exports the rows on screen, not everything the server sent', async () => {
    const user = userEvent.setup();
    render(<AlertNoise />, { wrapper: BrowserRouter });
    await screen.findByText('Disk full');
    await user.selectOptions(screen.getByLabelText('Show'), 'chronic');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(saved).toHaveLength(1);
    expect(saved[0].name).toMatch(/^hcml-alert-noise-7d-chronic-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await saved[0].text).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Disk full","db-1"');
  });

  it('exports the whole list, under the plain name, when nothing is filtered', async () => {
    const user = userEvent.setup();
    render(<AlertNoise />, { wrapper: BrowserRouter });
    await screen.findByText('Disk full');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(saved[0].name).toMatch(/^hcml-alert-noise-7d-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await saved[0].text).split('\n')).toHaveLength(4);
  });

  it('keeps a trigger name, a tab or a carriage return from running as a formula', async () => {
    const user = userEvent.setup();
    render(<AlertNoise />, { wrapper: BrowserRouter });
    await screen.findByText('Disk full');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    const text = await saved[0].text;
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(text).toContain(`"'\t+cmd"`);
    expect(text).not.toMatch(/^"=|,"=|\n"=/);
  });

  it('has nothing to download when the filter shows no rows', async () => {
    const user = userEvent.setup();
    render(<AlertNoise />, { wrapper: BrowserRouter });
    await screen.findByText('Disk full');
    await user.selectOptions(screen.getByLabelText('Show'), 'unactioned');
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  });

  it('names the file for the period and filter a link opened the page with (FR-14)', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/reports/noise?days=30&show=chronic');
    render(<AlertNoise />, { wrapper: BrowserRouter });
    await screen.findByText('Disk full');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(saved[0].name).toMatch(/^hcml-alert-noise-30d-chronic-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await saved[0].text).split('\n')).toHaveLength(2);
  });
});

const scorecard = (): ScorecardResponse => ({
  dimensions: [
    { key: 'naming', label: 'Naming', hint: '', present: 1, total: 3, pct: 33, scored: true },
    { key: 'owner', label: 'Owner', hint: '', present: 1, total: 3, pct: 33, scored: true },
  ],
  overall: { hosts: 3, complete: 0, pct: 0 },
  groups: [],
  gaps: [
    { hostid: '1', name: '=cmd|calc', site: 'JKT', groups: ['Core'], missing: ['owner'] },
    { hostid: '2', name: 'sw-2', site: 'BDG', groups: ['Edge', '@x'], missing: ['naming'] },
    { hostid: '3', name: '\r-2+3', site: 'SBY', groups: [], missing: ['owner', 'naming'] },
  ],
});

describe('the Inventory gap CSV (FR-05)', () => {
  beforeEach(() => void vi.spyOn(api, 'inventory').mockResolvedValue(scorecard()));

  it('exports the gaps on screen, not all of them', async () => {
    const user = userEvent.setup();
    render(<Inventory />, { wrapper: BrowserRouter });
    await screen.findByText('sw-2');
    await user.selectOptions(screen.getByLabelText('Show gaps of type'), 'naming');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(saved[0].name).toMatch(/^hcml-inventory-gaps-naming-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await saved[0].text).split('\n');
    expect(lines.map((l) => l.split(',')[0])).toEqual(['"host"', '"sw-2"', `"'\r-2+3"`]);
  });

  it('guards a leading tab or carriage return as well as = + - @', async () => {
    const user = userEvent.setup();
    render(<Inventory />, { wrapper: BrowserRouter });
    await screen.findByText('sw-2');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(saved[0].name).toMatch(/^hcml-inventory-gaps-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await saved[0].text;
    expect(text).toContain(`"'=cmd|calc"`);
    expect(text).toContain(`"'\r-2+3"`);
    expect(text).toContain(`"Edge | @x"`);
  });

  it('has nothing to download when the filter shows no gaps', async () => {
    const user = userEvent.setup();
    const none = scorecard();
    none.gaps = none.gaps.filter((g) => g.missing.includes('owner') && !g.missing.includes('naming'));
    vi.spyOn(api, 'inventory').mockResolvedValue(none);
    render(<Inventory />, { wrapper: BrowserRouter });
    await screen.findByText('=cmd|calc');
    await user.selectOptions(screen.getByLabelText('Show gaps of type'), 'naming');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled());
  });

  it('names the file for the gap type a link opened the page with, and not for one that is not offered (FR-14)', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/reports/inventory?gap=owner');
    const { unmount } = render(<Inventory />, { wrapper: BrowserRouter });
    await screen.findByText('=cmd|calc');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(saved[0].name).toMatch(/^hcml-inventory-gaps-owner-\d{4}-\d{2}-\d{2}\.csv$/);
    unmount();

    // The scorecard scores no criticality, so that filter reads as all gaps: the file must not claim it.
    window.history.replaceState(null, '', '/reports/inventory?gap=criticality');
    render(<Inventory />, { wrapper: BrowserRouter });
    await screen.findByText('=cmd|calc');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(saved[1].name).toMatch(/^hcml-inventory-gaps-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await saved[1].text).split('\n')).toHaveLength(4);
  });
});

describe('the day in the name of a CSV file (FR-24)', () => {
  afterEach(() => vi.useRealTimers());

  it('is the day in the report zone: at 03:00 on the 8th in Jakarta the file says the 8th, not the 7th that UTC still has', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 7, 20, 0, 0), toFake: ['Date'] });
    vi.spyOn(api, 'noise').mockResolvedValue(report([trigger('Disk full', 'db-1', ['chronic'])]));
    vi.spyOn(api, 'inventory').mockResolvedValue({
      dimensions: [{ key: 'site', label: 'Site mapping', hint: 'tag', present: 0, total: 1, pct: 0, scored: true }],
      overall: { hosts: 1, complete: 0, pct: 0 },
      groups: [],
      gaps: [{ hostid: '1', name: 'sw-1', site: 'Jakarta', groups: [], missing: ['site'] }],
    } as ScorecardResponse);
    const user = userEvent.setup({ advanceTimers: () => undefined });

    const first = render(<AlertNoise />, { wrapper: BrowserRouter });
    await screen.findByText('Disk full');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    first.unmount();
    render(<Inventory />, { wrapper: BrowserRouter });
    await user.click(await screen.findByRole('button', { name: 'Download CSV' }));

    expect(saved.map((s) => s.name)).toEqual(['hcml-alert-noise-7d-2026-10-08.csv', 'hcml-inventory-gaps-2026-10-08.csv']);
  });
});
