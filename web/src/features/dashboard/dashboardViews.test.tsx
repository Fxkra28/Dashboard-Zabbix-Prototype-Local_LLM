import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import type { Me, Role } from '../../types';
import { meter, other, response } from '../../__tests__/meters';
import { devicesResponse, topHostsResponse, webMonitoringResponse } from '../../__tests__/hosts';

/** The Dashboard's two views: the Overview and, for operators and admins (interface data), the internet traffic meters. */

const stream = vi.hoisted(() => ({ current: { data: null, updatedAt: null, connected: false, error: null } as Record<string, unknown> }));
vi.mock('../../shared/hooks/useSSE', () => ({ STREAM_SILENT_MS: 45_000, useSSE: () => stream.current }));
const { default: Overview } = await import('./Overview');

const never = () => new Promise<never>(() => undefined);

function signedInAs(role: Role | null) {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockImplementation(() =>
    role
      ? Promise.resolve({ authEnabled: true, user: { name: 'x', role }, expiresIn: 3600, pages: {} } as unknown as Me)
      : Promise.reject(new Error('The BFF did not answer')),
  );
}

function open(url = '/', wall = false) {
  window.history.replaceState(null, '', url);
  return render(
    <BrowserRouter>
      <Routes>
        <Route element={<Outlet context={{ wall, exitWall: () => undefined }} />}>
          <Route index element={<Overview />} />
        </Route>
      </Routes>
    </BrowserRouter>,
  );
}

beforeEach(() => {
  stream.current = { data: null, updatedAt: null, connected: false, error: null };
  vi.spyOn(api, 'stats').mockResolvedValue({ hosts: 24, items: 1000, triggers: 300, groups: 8, problems: 0, unacknowledged: 0, bySeverity: {} });
  vi.spyOn(api, 'problemsByGroup').mockResolvedValue([]);
  vi.spyOn(api, 'freshness').mockResolvedValue({ lastCollectedAt: Math.floor(Date.now() / 1000) - 30, ageSeconds: 30, stale: false, staleAfterSeconds: 600, pinged: 0, answering: 0, reachLost: false });
  vi.spyOn(api, 'problems').mockImplementation(never);
  vi.spyOn(api, 'netMeters').mockResolvedValue(response([meter(), meter({ id: 'item-2', title: 'SITE TWO INTERNET 1' })]));
  vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse());
  vi.spyOn(api, 'topHosts').mockResolvedValue(topHostsResponse());
  vi.spyOn(api, 'webMonitoring').mockResolvedValue(webMonitoringResponse());
});
afterEach(() => vi.restoreAllMocks());

const overviewShown = () => screen.queryByText('Open problems', { selector: '.label' }) !== null;

describe('the Dashboard views', () => {
  it('shows an operator the three views, on the Overview to begin with, and has asked for the meters once, as the card needs them', async () => {
    signedInAs('operator');
    open();
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Hosts', 'Internet traffic']);
    expect(screen.getByRole('tab', { name: 'Internet traffic' })).toHaveAttribute('aria-selected', 'false');
    expect(overviewShown()).toBe(true);
    await waitFor(() => expect(api.netMeters).toHaveBeenCalledTimes(1));
  });

  it('shows a wall screen\'s account the three views and the meters, as an operator sees them (MT-06)', async () => {
    signedInAs('wall');
    open();
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Hosts', 'Internet traffic']);
    await waitFor(() => expect(api.netMeters).toHaveBeenCalledTimes(1));
  });

  it('asks for the meters once for both views: the tab shows what the card was given', async () => {
    const user = userEvent.setup();
    signedInAs('operator');
    open();
    await waitFor(() => expect(api.netMeters).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('tab', { name: 'Internet traffic' }));
    expect(await screen.findAllByRole('meter')).toHaveLength(2);
    expect(api.netMeters).toHaveBeenCalledTimes(1);
  });

  it('opens the meters in place of the Overview when the second tab is chosen, and keeps that in the address', async () => {
    const user = userEvent.setup();
    signedInAs('operator');
    open();
    await user.click(await screen.findByRole('tab', { name: 'Internet traffic' }));

    expect(await screen.findByRole('heading', { name: 'Internet traffic' })).toBeInTheDocument();
    expect(await screen.findAllByRole('meter')).toHaveLength(2);
    expect(overviewShown()).toBe(false);
    expect(new URLSearchParams(window.location.search).get('view')).toBe('internet');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Internet traffic');
  });

  it('goes back to the Overview, and out of the address', async () => {
    const user = userEvent.setup();
    signedInAs('admin');
    open('/?view=internet');
    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    expect(overviewShown()).toBe(true);
    expect(window.location.search).toBe('');
  });

  it('opens on the meters from a link to them, for an admin as for an operator', async () => {
    signedInAs('admin');
    open('/?view=internet');
    expect(await screen.findAllByRole('meter')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Internet traffic' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a viewer the Overview and the Hosts, and no meters: no tab for them, and no request for interface data', async () => {
    signedInAs('viewer');
    open();
    expect(await screen.findByText('Open problems', { selector: '.label' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Hosts']);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Overview');
    expect(api.netMeters).not.toHaveBeenCalled();
  });

  it('opens the Hosts in place of the Overview when its tab is chosen, for a viewer, and keeps that in the address', async () => {
    const user = userEvent.setup();
    signedInAs('viewer');
    open();
    await user.click(await screen.findByRole('tab', { name: 'Hosts' }));
    expect(await screen.findByText('Monitored hosts', { selector: '.label' })).toBeInTheDocument();
    expect(overviewShown()).toBe(false);
    expect(new URLSearchParams(window.location.search).get('view')).toBe('hosts');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Hosts');
  });

  it('opens on the Hosts from a link to them', async () => {
    signedInAs('operator');
    open('/?view=hosts');
    expect(await screen.findByText('Monitored hosts', { selector: '.label' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hosts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a viewer on the Overview even from a link to the meters', async () => {
    signedInAs('viewer');
    open('/?view=internet');
    expect(await screen.findByText('Open problems', { selector: '.label' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Internet traffic' })).toBeNull();
    expect(api.netMeters).not.toHaveBeenCalled();
  });

  it('shows the Overview and the Hosts, and no meters, until it knows who is signed in, and when it cannot find out', async () => {
    signedInAs(null);
    open('/?view=internet');
    expect(await screen.findByText('Open problems', { selector: '.label' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Hosts']);
    expect(api.netMeters).not.toHaveBeenCalled();
  });

  it('reads an address it does not know as the Overview', async () => {
    signedInAs('operator');
    open('/?view=nonsense');
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(overviewShown()).toBe(true);
  });

  it('keeps the tabs on the wall screen too, so a wall can be sent to the meters by its address', async () => {
    signedInAs('operator');
    open('/?view=internet', true);
    expect(await screen.findByRole('tablist', { name: 'Dashboard view' })).toBeInTheDocument();
    expect(await screen.findAllByRole('meter')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Exit wall mode' })).toBeInTheDocument();
  });
});

/** The card on the Overview: the internet links in one number, so the first view does not hide what the second shows. */
describe('the Internet links card', () => {
  const card = () => screen.getByText('Internet links', { selector: '.label' }).closest('.kpi') as HTMLElement;

  it('counts the links that need someone to look and says which way, once each', async () => {
    vi.spyOn(api, 'netMeters').mockResolvedValue(
      response([
        meter({ link: 'down', zone: 'low' }),
        meter({ id: 'b', zone: 'critical' }),
        meter({ id: 'c', zone: 'warn', other: other({ zone: 'critical' }) }),
        meter({ id: 'd' }),
      ]),
    );
    signedInAs('operator');
    open();
    await waitFor(() => expect(within(card()).getByText('3')).toBeInTheDocument());
    expect(within(card()).getByText('1 down, 1 critical, 1 high, 1 other direction')).toBeInTheDocument();
  });

  it('is red when a link is down or critical, orange when the worst is high, and plain when none is', async () => {
    signedInAs('operator');
    const accent = () => card().style.getPropertyValue('--accent');
    vi.spyOn(api, 'netMeters').mockResolvedValue(response([meter({ link: 'down' })]));
    const first = open();
    await waitFor(() => expect(within(card()).getByText('1 down')).toBeInTheDocument());
    const red = accent();
    expect(red).not.toBe('');
    first.unmount();

    vi.spyOn(api, 'netMeters').mockResolvedValue(response([meter({ zone: 'warn' })]));
    const second = open();
    await waitFor(() => expect(within(card()).getByText('1 high')).toBeInTheDocument());
    expect(accent()).not.toBe('');
    expect(accent()).not.toBe(red);
    second.unmount();

    vi.spyOn(api, 'netMeters').mockResolvedValue(response([meter()]));
    open();
    await waitFor(() => expect(within(card()).getByText('None high or critical, of 1')).toBeInTheDocument());
    expect(accent()).toBe('');
  });

  it('does not say all is well when no reading is current', async () => {
    vi.spyOn(api, 'netMeters').mockResolvedValue(response([meter({ state: 'stale' }), meter({ id: 'b', state: 'stale' })]));
    signedInAs('admin');
    open();
    await waitFor(() => expect(within(card()).getByText('2 links, none with a current reading')).toBeInTheDocument());
    expect(within(card()).getByText('0')).toBeInTheDocument();
  });

  it('shows a dash while the answer is awaited, and says it could not be read when it fails', async () => {
    signedInAs('operator');
    vi.spyOn(api, 'netMeters').mockImplementation(never);
    const waiting = open();
    expect(await screen.findByText('Internet links', { selector: '.label' })).toBeInTheDocument();
    expect(within(card()).getByText('…')).toBeInTheDocument();
    waiting.unmount();

    vi.spyOn(api, 'netMeters').mockRejectedValue(new Error('The data source is not answering.'));
    open();
    await waitFor(() => expect(within(card()).getByText('Could not be read')).toBeInTheDocument());
  });

  it('is not shown to a viewer, who asks for no interface data either', async () => {
    signedInAs('viewer');
    open();
    expect(await screen.findByText('Open problems', { selector: '.label' })).toBeInTheDocument();
    expect(screen.queryByText('Internet links')).toBeNull();
    expect(api.netMeters).not.toHaveBeenCalled();
  });

  it('is on the wall\'s Overview too', async () => {
    signedInAs('operator');
    open('/', true);
    expect(await screen.findByText('Internet links', { selector: '.label' })).toBeInTheDocument();
  });
});

/** A wall has no one to click it, so it turns by itself between its views and says how to stop it. */
describe('the wall screen turning by itself', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
  const tabShown = () => screen.getByRole('tab', { selected: true }).textContent;
  /** Open a wall and wait for the Overview and the meters to have arrived. */
  async function wall(url = '/') {
    open(url, true);
    await screen.findByRole('tablist', { name: 'Dashboard view' });
    await waitFor(() => expect(api.netMeters).toHaveBeenCalled());
    await act(async () => undefined);
  }

  it('shows the Overview, then the Hosts after 30 seconds, then the meters, then the Overview again', async () => {
    signedInAs('operator');
    await wall();
    expect(tabShown()).toBe('Overview');
    expect(overviewShown()).toBe(true);
    await advance(29_999);
    expect(tabShown()).toBe('Overview');
    await advance(1);
    expect(tabShown()).toBe('Hosts');
    expect(await screen.findByText('Monitored hosts', { selector: '.label' })).toBeInTheDocument();
    expect(overviewShown()).toBe(false);
    await advance(30_000);
    expect(tabShown()).toBe('Internet traffic');
    expect(await screen.findAllByRole('meter')).toHaveLength(2);
    await advance(30_000);
    expect(tabShown()).toBe('Overview');
    expect(overviewShown()).toBe(true);
  });

  it('turns without anyone writing view= in the address', async () => {
    signedInAs('operator');
    await wall();
    await advance(30_000);
    expect(window.location.search).toBe('');
  });

  it('writes the clock and the name of its zone as two words, so a screen reader does not read "05WIB"', async () => {
    signedInAs('operator');
    await wall();
    const clock = document.querySelector('.wall-stamp .wall-time');
    expect(clock?.textContent).toMatch(/^\d{2}:\d{2}:\d{2} WIB$/);
  });

  it('takes the seconds from the address', async () => {
    signedInAs('operator');
    await wall('/?rotate=10');
    await advance(9_999);
    expect(tabShown()).toBe('Overview');
    await advance(1);
    expect(tabShown()).toBe('Hosts');
  });

  it('holds at 10 seconds for anything shorter, and reads a value it cannot read as 30', async () => {
    signedInAs('operator');
    const first = open('/?rotate=2', true);
    await waitFor(() => expect(api.netMeters).toHaveBeenCalled());
    await advance(9_999);
    expect(tabShown()).toBe('Overview');
    await advance(1);
    expect(tabShown()).toBe('Hosts');
    first.unmount();

    open('/?rotate=soon', true);
    await screen.findByRole('tablist', { name: 'Dashboard view' });
    await advance(29_999);
    expect(tabShown()).toBe('Overview');
    await advance(1);
    expect(tabShown()).toBe('Hosts');
  });

  it('stands still on the Overview with rotate=0, and offers nothing to pause', async () => {
    signedInAs('operator');
    await wall('/?rotate=0');
    await advance(300_000);
    expect(tabShown()).toBe('Overview');
    expect(screen.queryByRole('button', { name: /rotation$/ })).toBeNull();
  });

  it('holds the view the address names, and offers nothing to pause', async () => {
    signedInAs('operator');
    await wall('/?view=internet');
    await advance(300_000);
    expect(tabShown()).toBe('Internet traffic');
    expect(screen.queryByRole('button', { name: /rotation$/ })).toBeNull();
  });

  it('holds the Overview when the address names it, and the Hosts too', async () => {
    signedInAs('operator');
    await wall('/?view=overview');
    await advance(300_000);
    expect(tabShown()).toBe('Overview');
    cleanup();
    await wall('/?view=hosts');
    await advance(300_000);
    expect(tabShown()).toBe('Hosts');
  });

  it('stops at Pause, where it is, and goes on at Resume', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    signedInAs('operator');
    await wall();
    await advance(30_000);
    expect(tabShown()).toBe('Hosts');

    await user.click(screen.getByRole('button', { name: 'Pause rotation' }));
    expect(screen.getByRole('button', { name: 'Resume rotation' })).toBeInTheDocument();
    await advance(300_000);
    expect(tabShown()).toBe('Hosts');

    await user.click(screen.getByRole('button', { name: 'Resume rotation' }));
    expect(screen.getByRole('button', { name: 'Pause rotation' })).toBeInTheDocument();
    await advance(30_000);
    expect(tabShown()).toBe('Internet traffic');
  });

  it('stops when a tab is chosen, keeps that view, and says so in the address', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    signedInAs('operator');
    await wall();
    await user.click(screen.getByRole('tab', { name: 'Internet traffic' }));
    expect(tabShown()).toBe('Internet traffic');
    expect(new URLSearchParams(window.location.search).get('view')).toBe('internet');
    await advance(300_000);
    expect(tabShown()).toBe('Internet traffic');
    expect(screen.getByRole('button', { name: 'Resume rotation' })).toBeInTheDocument();
  });

  it('names the Overview in the address too when it is chosen, which it would leave out anywhere but a wall', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    signedInAs('operator');
    await wall();
    await advance(30_000);
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(tabShown()).toBe('Overview');
    expect(new URLSearchParams(window.location.search).get('view')).toBe('overview');
    await advance(300_000);
    expect(tabShown()).toBe('Overview');
  });

  it('turns again from the Overview at Resume, and takes the view out of the address', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    signedInAs('operator');
    await wall();
    await user.click(screen.getByRole('tab', { name: 'Internet traffic' }));
    await user.click(screen.getByRole('button', { name: 'Resume rotation' }));
    expect(window.location.search).toBe('');
    expect(tabShown()).toBe('Overview');
    await advance(30_000);
    expect(tabShown()).toBe('Hosts');
  });

  it('turns again when the wall is left and entered again, whatever was paused', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    signedInAs('operator');
    window.history.replaceState(null, '', '/');
    const tree = (wallOn: boolean) => (
      <BrowserRouter>
        <Routes>
          <Route element={<Outlet context={{ wall: wallOn, exitWall: () => undefined }} />}>
            <Route index element={<Overview />} />
          </Route>
        </Routes>
      </BrowserRouter>
    );
    const { rerender } = render(tree(true));
    await screen.findByRole('tablist', { name: 'Dashboard view' });
    await waitFor(() => expect(api.netMeters).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Pause rotation' }));
    expect(screen.getByRole('button', { name: 'Resume rotation' })).toBeInTheDocument();

    rerender(tree(false));
    expect(screen.queryByRole('button', { name: /rotation$/ })).toBeNull();
    rerender(tree(true));
    expect(await screen.findByRole('button', { name: 'Pause rotation' })).toBeInTheDocument();
  });

  it('turns a viewer\'s wall between the Overview and the Hosts, with no meters and no request for interface data', async () => {
    signedInAs('viewer');
    open('/', true);
    expect(await screen.findByText('Open problems', { selector: '.label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause rotation' })).toBeInTheDocument();
    await advance(30_000);
    expect(tabShown()).toBe('Hosts');
    await advance(30_000);
    expect(tabShown()).toBe('Overview');
    expect(screen.queryByRole('tab', { name: 'Internet traffic' })).toBeNull();
    expect(api.netMeters).not.toHaveBeenCalled();
  });

  it('does not turn a Dashboard that is not on a wall', async () => {
    signedInAs('operator');
    open('/');
    await screen.findByRole('tablist', { name: 'Dashboard view' });
    await advance(300_000);
    expect(tabShown()).toBe('Overview');
    expect(screen.queryByRole('button', { name: /rotation$/ })).toBeNull();
  });

  it('gives the meters as many slides as they need, an even share on each, and says which page it is', async () => {
    const many = Array.from({ length: 40 }, (_, i) => meter({ id: `item-${i}`, title: `SITE ${i + 1} INTERNET` }));
    vi.spyOn(api, 'netMeters').mockResolvedValue(response(many));
    signedInAs('operator');
    await wall();
    expect(tabShown()).toBe('Overview');
    await advance(60_000);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(await screen.findAllByRole('meter')).toHaveLength(20);
    await advance(30_000);
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getAllByRole('meter')).toHaveLength(20);
    expect(tabShown()).toBe('Internet traffic');
    await advance(30_000);
    expect(tabShown()).toBe('Overview');
  });

  it('shows every meter at once, with no page, on a Dashboard that is not a wall', async () => {
    const many = Array.from({ length: 40 }, (_, i) => meter({ id: `item-${i}`, title: `SITE ${i + 1} INTERNET` }));
    vi.spyOn(api, 'netMeters').mockResolvedValue(response(many));
    signedInAs('operator');
    open('/?view=internet');
    expect(await screen.findAllByRole('meter')).toHaveLength(40);
    expect(screen.queryByText(/^Page \d/)).toBeNull();
  });

  it('says the items are still being counted, and shows the counts that are in', async () => {
    signedInAs('viewer');
    vi.spyOn(api, 'stats').mockResolvedValue({ hosts: 24, items: null, triggers: 300, groups: 8, problems: 0, unacknowledged: 0, bySeverity: {} });
    open();
    const card = async (label: string) => (await screen.findByText(label, { selector: '.label' })).closest('.kpi');
    await waitFor(async () => expect(await card('Items')).toHaveTextContent('counting'));
    expect(await card('Items')).toHaveTextContent('…');
    expect(await card('Hosts')).toHaveTextContent('24');
  });

  it('says the triggers are still being counted too, which took HCML\'s Zabbix 74 s', async () => {
    signedInAs('viewer');
    vi.spyOn(api, 'stats').mockResolvedValue({ hosts: 24, items: 33226, triggers: null, groups: 8, problems: 0, unacknowledged: 0, bySeverity: {} });
    open();
    const card = async (label: string) => (await screen.findByText(label, { selector: '.label' })).closest('.kpi');
    await waitFor(async () => expect(await card('Triggers')).toHaveTextContent('counting'));
    expect(await card('Triggers')).toHaveTextContent('…');
    expect(await card('Items')).toHaveTextContent('33226');
  });
});
