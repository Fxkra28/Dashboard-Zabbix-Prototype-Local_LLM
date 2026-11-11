import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Capacity from './Capacity';
import type { CapacityReport, CapacityRow } from '../../types';

/**
 * A capacity row with no stored values reads as "no data" in its own row, not as 0.0 % with a green bar, and
 * the "from history" pill names the panel when any of its rows came from history, not only the first (FR-24).
 */
const row = (name: string, source: CapacityRow['source'], avg: number, max = avg): CapacityRow => ({
  metric: 'cpu', label: 'CPU', itemid: name, hostid: '1', host: `host-${name}`, name, units: '%', avg, max, source,
});
const report = (rows: CapacityRow[]): CapacityReport => ({ days: 7, metrics: [{ key: 'cpu', label: 'Busiest CPUs', rows }] });

beforeEach(() => {
  resetAuthProbe();
  window.history.replaceState(null, '', '/reports/capacity');
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

const show = async (rows: CapacityRow[]) => {
  vi.spyOn(api, 'capacity').mockResolvedValue(report(rows));
  render(<Capacity />, { wrapper: BrowserRouter });
  await screen.findByText('Busiest CPUs');
};
const rowOf = (name: string) => screen.getByText(`host-${name}`).closest('tr') as HTMLElement;

describe('the Capacity page', () => {
  it('says "from history" when any row of the panel was averaged from raw history, whichever row comes first', async () => {
    await show([row('a', 'trend', 40), row('b', 'history', 55)]);
    expect(screen.getByText('from history')).toBeInTheDocument();
  });

  it('says nothing about history when every row came from trends', async () => {
    await show([row('a', 'trend', 40), row('b', 'trend', 55)]);
    expect(screen.queryByText('from history')).toBeNull();
  });

  it('shows a row with no stored values as "no data", with no bar and no 0.0 %', async () => {
    await show([row('a', 'trend', 40, 61), row('quiet', 'none', 0)]);
    const quiet = rowOf('quiet');
    // One mark for the average and one for the peak.
    expect(within(quiet).getAllByText('No data', { selector: '.sr-only' })).toHaveLength(2);
    expect(quiet.querySelector('.score-bar')).toBeNull();
    expect(quiet).not.toHaveTextContent('0.0');
    // The row that has values is drawn as before.
    expect(rowOf('a').querySelector('.score-bar')).not.toBeNull();
    expect(rowOf('a')).toHaveTextContent('40.0%');
    expect(rowOf('a')).toHaveTextContent('61.0%');
  });

  it('keeps a measured zero as 0.0 %, since idle is an answer', async () => {
    await show([row('idle', 'trend', 0, 3)]);
    expect(rowOf('idle')).toHaveTextContent('0.0%');
    expect(rowOf('idle').querySelector('.score-bar')).not.toBeNull();
  });

  it('explains the "no data" marks in words that match them', async () => {
    await show([row('quiet', 'none', 0)]);
    const note = screen.getByText(/have no stored values for this period/);
    expect(note).toHaveTextContent('Rows marked “no data” have no stored values for this period: the host may not have been reporting.');
    expect(note).not.toHaveTextContent('Zeros below');
  });
});
