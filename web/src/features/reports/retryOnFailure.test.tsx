import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import AlertNoise from './AlertNoise';
import Capacity from './Capacity';
import TopTriggers from './TopTriggers';
import type { CapacityReport, NoiseReport, TopTriggersReport } from '../../types';

/**
 * The report pages do not poll, so a failed load must say how to try again, and the button must read again (UX-49). The Alert noise file is named from the
 * days of the report it holds, never from a selection that is still loading over it (FR-54).
 */

beforeEach(() => {
  resetAuthProbe();
  window.history.replaceState(null, '', '/');
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

const capacity: CapacityReport = {
  days: 7,
  metrics: [
    {
      key: 'cpu',
      label: 'Busiest CPUs',
      rows: [{ metric: 'cpu', label: 'CPU', itemid: '1', hostid: '1', host: 'host-a', name: 'a', units: '%', avg: 40, max: 50, source: 'trend' }],
    },
  ],
};
const top: TopTriggersReport = { triggers: [], truncated: false, days: 7 };
const noise = (windowSeconds = 7 * 86_400): NoiseReport => ({
  from: 0,
  to: windowSeconds,
  windowSeconds,
  minSeverity: 0,
  truncated: false,
  totalEvents: 3,
  distinctTriggers: 1,
  concentration: { topN: 1, percentOfEvents: 100 },
  counts: { flapping: 0, unactioned: 0, chronic: 0 },
  thresholds: { shortSeconds: 60, minCount: 5 },
  total: 1,
  triggers: [
    {
      objectid: '1', name: 'Disk full', host: 'db-1', hostid: '1', severity: '3', count: 3, medianDuration: 4, shortLived: 0, ackRate: 0, totalDuration: 9, longest: 9, stillOpen: false, flags: [],
    },
  ],
});

/** A page whose first read fails with `Failed to fetch` and whose next one gives `report`: it shows the alert, and Try again reads again. */
async function retries<T>(spy: { mockRejectedValueOnce: (e: Error) => unknown; mockResolvedValue: (r: T) => unknown }, report: T, page: React.ReactElement, shown: string, calls: () => number) {
  spy.mockRejectedValueOnce(new Error('Failed to fetch'));
  spy.mockResolvedValue(report);
  render(page, { wrapper: BrowserRouter });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Failed to fetch');
  expect(calls()).toBe(1);
  await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
  await screen.findByText(shown);
  expect(calls()).toBe(2);
  expect(screen.queryByRole('alert')).toBeNull();
}

describe('Try again on the report pages (UX-49)', () => {
  it('reads Capacity again', async () => {
    const spy = vi.spyOn(api, 'capacity');
    await retries(spy as never, capacity, <Capacity />, 'Busiest CPUs', () => spy.mock.calls.length);
  });

  it('reads Top triggers again', async () => {
    const spy = vi.spyOn(api, 'topTriggers');
    await retries(spy as never, top, <TopTriggers />, 'Top 100 triggers by number of problems', () => spy.mock.calls.length);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads Alert noise again', async () => {
    const spy = vi.spyOn(api, 'noise');
    await retries(spy as never, noise(), <AlertNoise />, 'Disk full', () => spy.mock.calls.length);
  });
});

describe('the Alert noise file while a new period loads (FR-54)', () => {
  let saved: string[];
  beforeEach(() => {
    saved = [];
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
  });

  it('is named by the days of the rows it holds, not by the days just chosen', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'noise');
    spy.mockResolvedValueOnce(noise(7 * 86_400));
    spy.mockReturnValueOnce(new Promise(() => undefined));
    render(<AlertNoise />, { wrapper: BrowserRouter });
    await screen.findByText('Disk full');
    await user.selectOptions(screen.getByLabelText('Period'), '30');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^hcml-alert-noise-7d-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('keeps the chosen days in the name once the rows for them are in', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'noise').mockImplementation(async (days) => noise((days ?? 7) * 86_400));
    render(<AlertNoise />, { wrapper: BrowserRouter });
    await screen.findByText('Disk full');
    await user.selectOptions(screen.getByLabelText('Period'), '30');
    await waitFor(() => expect(document.querySelector('.stale')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(saved[0]).toMatch(/^hcml-alert-noise-30d-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
