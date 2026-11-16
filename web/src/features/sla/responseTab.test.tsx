import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Sla from './Sla';
import { lastClosedMonth } from './Sli';
import type { AgingReport, SlaSource } from '../../types';

// The Response tab holds what the Availability & response page showed under its figures: the problems nobody has acknowledged, by age.

const aging = (over: Partial<AgingReport> = {}): AgingReport => ({
  buckets: [
    { label: 'Under 1h', count: 4 },
    { label: '1–4h', count: 9 },
    { label: '4–24h', count: 20 },
    { label: 'Over 24h', count: 642 },
  ],
  unacknowledged: 675,
  total: 680,
  oldest: [
    { eventid: '1', name: 'Interface Gi1/0/3: Link down', host: '1.2 SW-02', severity: '3', clock: '0', ageSeconds: 76_000_000 },
    { eventid: '2', name: 'No SNMP data collection', host: '', severity: '2', clock: '0', ageSeconds: 75_000_000 },
  ],
  ...over,
});

const never = () => new Promise<never>(() => undefined);

const open = (search = '', source: SlaSource = { real: false, slas: 0, services: 0 }) => {
  window.history.replaceState(null, '', `/sla${search}`);
  vi.spyOn(api, 'slaSource').mockResolvedValue(source);
  return render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
};

beforeEach(() => {
  window.history.replaceState(null, '', '/sla');
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 0, ai: false, writeBack: false });
  vi.spyOn(api, 'sli').mockImplementation(never);
  vi.spyOn(api, 'sla').mockImplementation(never);
  vi.spyOn(api, 'aging').mockResolvedValue(aging());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the Response tab', () => {
  it('opens from the address, beside the derived SLA', async () => {
    open('?tab=response');
    const tab = await screen.findByRole('tab', { name: 'Response' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Response');
    // The monthly report is not asked for while another tab is in view.
    expect(api.sli).not.toHaveBeenCalled();
    expect(api.aging).toHaveBeenCalledTimes(1);
  });

  it('is reached with a click, and writes itself into the address', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('tab', { name: 'Response' }));
    // The derived view the page opened on wrote its month into the address (FR-53), and the month stays as the tab changes.
    expect(window.location.search).toBe(`?month=${lastClosedMonth()}&tab=response`);
    expect(await screen.findByText('Unacknowledged, by age')).toBeInTheDocument();
  });

  it('says that it is about now, and not about a month', async () => {
    open('?tab=response');
    expect(await screen.findByText(/about now, not about a month/)).toBeInTheDocument();
  });

  it('shows how many problems wait in each age, and how many have not been acknowledged', async () => {
    open('?tab=response');
    expect(await screen.findByText('Not acknowledged: 675 of 680 active problems.')).toBeInTheDocument();
    const rows = [...document.querySelectorAll('.aging-row')].map((r) => [r.querySelector('.aging-label')?.textContent, r.querySelector('.aging-count')?.textContent]);
    expect(rows).toEqual([
      ['Under 1h', '4'],
      ['1–4h', '9'],
      ['4–24h', '20'],
      ['Over 24h', '642'],
    ]);
  });

  // UX-48: the bars took their colour from a token that was removed on 23 September, so they were empty tracks beside their numbers.
  it('draws each bar in a colour the stylesheet defines: the mid tone for the ages that wait, and the danger tone for the oldest', async () => {
    open('?tab=response');
    await screen.findByText('Not acknowledged: 675 of 680 active problems.');
    const bars = [...document.querySelectorAll<HTMLElement>('.aging-track > span')].map((b) => b.style.background);
    expect(bars).toEqual(['var(--mid)', 'var(--mid)', 'var(--mid)', 'var(--danger)']);
    for (const background of bars) expect(background).toMatch(/^var\(--(mid|danger)\)$/);
  });

  it('lists the problems that wait longest, with a stand-in where the host is not known', async () => {
    open('?tab=response');
    expect(await screen.findByText('Waiting longest')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Interface Gi1/0/3: Link down')).toBeInTheDocument();
    expect(within(table).getByText('1.2 SW-02')).toBeInTheDocument();
    const second = within(table).getByText('No SNMP data collection').closest('tr') as HTMLElement;
    expect(second).toHaveTextContent('No data');
  });

  it('leaves out the list when nothing waits', async () => {
    vi.spyOn(api, 'aging').mockResolvedValue(aging({ unacknowledged: 0, total: 0, oldest: [], buckets: [] }));
    open('?tab=response');
    expect(await screen.findByText('Not acknowledged: 0 of 0 active problems.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting longest')).toBeNull();
  });

  it('says why when the report cannot be read', async () => {
    vi.spyOn(api, 'aging').mockRejectedValue(new Error('Zabbix did not answer.'));
    open('?tab=response');
    expect(await screen.findByText(/Zabbix did not answer/)).toBeInTheDocument();
  });

  it('asks again every 30 seconds while it is in view', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    open('?tab=response');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.aging).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.aging).toHaveBeenCalledTimes(2);
  });

  it('says one problem in the singular', async () => {
    vi.spyOn(api, 'aging').mockResolvedValue(aging({ unacknowledged: 1, total: 1, oldest: [], buckets: [{ label: 'Over 24h', count: 1 }] }));
    open('?tab=response');
    expect(await screen.findByText('Not acknowledged: 1 of 1 active problem.')).toBeInTheDocument();
  });

  it('stops asking when another tab is in view, and asks again when it is shown again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    open('?tab=response');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.aging).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Derived SLA' }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.aging).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Response' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.aging).toHaveBeenCalledTimes(3);
  });

  it('does not carry the note about Zabbix having no SLAs, which explains the derived tab only', async () => {
    open('?tab=response');
    await screen.findByText('Unacknowledged, by age');
    // The source has answered by now: the note would be here if it were going to be.
    await vi.waitFor(() => expect(api.slaSource).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByText(/so this page shows the SLA derived in the portal/)).toBeNull();
  });

  it('is not asked for at all while the derived SLA is in view', async () => {
    open('?tab=derived');
    await screen.findByRole('tab', { name: 'Derived SLA' });
    // The derived panel has mounted and asked for its report: a Response tab that fetched on mount would have asked too.
    await vi.waitFor(() => expect(api.sli).toHaveBeenCalled());
    expect(api.aging).not.toHaveBeenCalled();
  });
});
