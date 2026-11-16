import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, configure } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Capacity from './Capacity';
import type { CapacityReport, CapacityRow } from '../../types';

// A page loads in steps and the test files run side by side, so the default second of waiting is too short on a busy machine.
configure({ asyncUtilTimeout: 5000 });

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

// UX-55: every panel named its table "Capacity by interface", so a screen reader's list of regions held the same name for each.
describe('the table of each Capacity panel', () => {
  const widths = (scroll: number, client: number) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scroll });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => client });
  };
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });

  it('is named by the panel it belongs to, once it scrolls and so becomes a region', async () => {
    widths(900, 300);
    vi.spyOn(api, 'capacity').mockResolvedValue({
      days: 7,
      metrics: [
        { key: 'cpu', label: 'Busiest CPUs', rows: [row('a', 'trend', 40)] },
        { key: 'ifutil', label: 'Interfaces', rows: [row('b', 'trend', 20)] },
        { key: 'memory', label: 'Fullest memory', rows: [row('c', 'trend', 70)] },
      ],
    });
    render(<Capacity />, { wrapper: BrowserRouter });
    await screen.findByText('Busiest CPUs');
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(['Busiest CPUs', 'Busiest interfaces', 'Fullest memory']);
    expect(names).not.toContain('Capacity by interface');
  });
});

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

// FR-55: the server keeps interface items from a viewer, so the Graph button on an interface row sent a viewer to a refusal that the Graphs page then misread.
describe('the Graph button on a Capacity row', () => {
  const asRole = async (role: 'viewer' | 'wall' | 'operator' | 'admin') => {
    vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role }, expiresIn: 3600 });
    vi.spyOn(api, 'capacity').mockResolvedValue({
      days: 7,
      metrics: [
        { key: 'cpu', label: 'Busiest CPUs', rows: [row('cpu1', 'trend', 40)] },
        { key: 'ifutil', label: 'Interfaces', rows: [{ ...row('port1', 'trend', 20), metric: 'ifutil', label: 'Interface utilisation' }] },
      ],
    });
    render(<Capacity />, { wrapper: BrowserRouter });
    await screen.findByText('Busiest CPUs');
    await screen.findByText('host-port1');
  };

  it.each([['wall'], ['operator'], ['admin']] as const)('is offered on an interface row to the %s role', async (role) => {
    await asRole(role);
    expect(within(rowOf('port1')).getByRole('link', { name: 'Graph' })).toHaveAttribute('href', '/graphs?hostid=1&itemid=port1');
  });

  it('is left off an interface row for a viewer, who is refused those items, and the row has no empty actions cell', async () => {
    await asRole('viewer');
    const interfaces = rowOf('port1').closest('table') as HTMLTableElement;
    expect(within(interfaces).queryByRole('link', { name: 'Graph' })).toBeNull();
    expect(rowOf('port1').querySelectorAll('td')).toHaveLength(4);
    expect(interfaces.querySelectorAll('thead th')).toHaveLength(4);
    expect(within(interfaces).queryByText('Actions')).toBeNull();
  });

  it.each([['viewer'], ['wall'], ['operator'], ['admin']] as const)('is always offered on a CPU row, for the %s role', async (role) => {
    await asRole(role);
    expect(within(rowOf('cpu1')).getByRole('link', { name: 'Graph' })).toBeInTheDocument();
  });
});
