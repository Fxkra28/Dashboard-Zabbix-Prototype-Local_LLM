import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import HostsView from './HostsView';
import { useHostsView } from './useHostsView';
import { devicesResponse, topHostsResponse, webMonitoringResponse } from '../../__tests__/hosts';

/** The Dashboard's Hosts view: whether the hosts answer, the kinds of device, and the busiest hosts. */

// Web monitoring is a request of its own; a test that is about something else has it answer, and one that is about it says what it answers.
beforeEach(() => {
  vi.spyOn(api, 'webMonitoring').mockResolvedValue(webMonitoringResponse());
});
afterEach(() => vi.restoreAllMocks());

/** The Dashboard holds the two requests (useHostsView.ts) and hands them to the view; so does this. */
function Held({ wall }: { wall: boolean }) {
  return <HostsView q={useHostsView()} wall={wall} />;
}
const show = (wall = false) =>
  render(
    <MemoryRouter>
      <Held wall={wall} />
    </MemoryRouter>,
  );
const card = (label: string) => screen.getByText(label, { selector: '.label' }).closest('.kpi') as HTMLElement;

function ready() {
  vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse());
  vi.spyOn(api, 'topHosts').mockResolvedValue(topHostsResponse());
}

describe('HostsView availability', () => {
  it('has a card for the monitored hosts and for each state, with the count and a few words', async () => {
    ready();
    show();
    await screen.findByText('Monitored hosts', { selector: '.label' });
    expect(within(card('Monitored hosts')).getByText('8')).toBeInTheDocument();
    expect(within(card('Monitored hosts')).getByText('1 in maintenance')).toBeInTheDocument();
    expect(within(card('Up')).getByText('4')).toBeInTheDocument();
    expect(within(card('Up')).getByText('50% of the monitored hosts')).toBeInTheDocument();
    expect(within(card('Degraded')).getByText('1')).toBeInTheDocument();
    expect(within(card('Down')).getByText('2')).toBeInTheDocument();
    expect(within(card('No data')).getByText('1')).toBeInTheDocument();
  });

  it('colours the left edge of a state by what it is, and leaves the total plain', async () => {
    ready();
    show();
    await screen.findByText('Monitored hosts', { selector: '.label' });
    const accent = (label: string) => card(label).style.getPropertyValue('--accent');
    expect(accent('Monitored hosts')).toBe('');
    expect(accent('Up')).toBe('var(--good)');
    expect(accent('Degraded')).toBe('var(--warn)');
    expect(accent('Down')).toBe('var(--danger)');
  });

  it('says the monitored hosts are enabled in Zabbix when none is in maintenance', async () => {
    vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse(devicesResponse().devices.filter((d) => d.maintenance_status !== '1')));
    vi.spyOn(api, 'topHosts').mockResolvedValue(topHostsResponse());
    show();
    await screen.findByText('Monitored hosts', { selector: '.label' });
    expect(within(card('Monitored hosts')).getByText('enabled in Zabbix')).toBeInTheDocument();
  });
});

describe('HostsView devices by kind', () => {
  it('has a tile for every kind, in order, with its count and what is wrong with it', async () => {
    ready();
    show();
    expect(await screen.findByRole('heading', { name: 'Devices by kind' })).toBeInTheDocument();
    const tiles = [...document.querySelectorAll('.kinds-panel .kind-tile')];
    expect(tiles.map((t) => t.querySelector('.kind-name')?.textContent)).toEqual([
      'Switches', 'Firewalls', 'Access points', 'Radio repeaters', 'Servers', 'WAN links', 'Web services', 'Other',
    ]);
    expect(tiles[0].textContent).toBe('Switches 2 1 with problems');
    expect(tiles[2].textContent).toBe('Access points 1 1 with problems · 1 down');
    expect(tiles[6].textContent).toBe('Web services 0 none');
  });

  it('makes a tile a link to that kind on the Devices page, except for a kind with no device', async () => {
    ready();
    show();
    await screen.findByRole('heading', { name: 'Devices by kind' });
    expect(screen.getByRole('link', { name: /^Switches 2/ })).toHaveAttribute('href', '/devices?type=switch');
    expect(screen.getByRole('link', { name: /^WAN links 1/ })).toHaveAttribute('href', '/devices?type=wan-link');
    expect(screen.queryByRole('link', { name: /^Web services/ })).toBeNull();
    expect(document.querySelector('.kinds-panel .kind-tile.empty')).toHaveTextContent('Web services');
  });

  it('draws no links on a wall, which has no one to click them', async () => {
    ready();
    show(true);
    await screen.findByRole('heading', { name: 'Devices by kind' });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(document.querySelectorAll('.kinds-panel .kind-tile')).toHaveLength(8);
  });
});

describe('HostsView busiest hosts', () => {
  it('lists the hosts busiest first with their figure, and a bar the colour of how hot', async () => {
    ready();
    show();
    const panel = (await screen.findByRole('heading', { name: 'Top hosts by CPU' })).closest('section') as HTMLElement;
    const rows = [...panel.querySelectorAll('.top-row')];
    expect(rows.map((r) => [r.querySelector('.top-host')?.textContent, r.querySelector('.top-value')?.textContent])).toEqual([
      ['3.1 SITE3-FW-01', '93%'],
      ['SERVER : DATABASE', '78%'],
      ['1.1 SITE1-CORESWITCH', '31%'],
    ]);
    const fill = (i: number) => rows[i].querySelector('.top-fill') as HTMLElement;
    expect(fill(0)).toHaveClass('hot');
    expect(fill(1)).toHaveClass('busy');
    expect(fill(2).className).toBe('top-fill');
    expect(fill(0).style.width).toBe('93.4%');
  });

  it('puts the warning colour from 75 percent and the critical one from 90, and none just under', async () => {
    vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse());
    const t = topHostsResponse();
    t.metrics[0].rows = [90, 89.9, 75, 74.9].map((value, i) => ({ hostid: String(i + 1), host: `H${i + 1}`, itemid: String(i + 1), value, clock: 1 }));
    vi.spyOn(api, 'topHosts').mockResolvedValue(t);
    show();
    const panel = (await screen.findByRole('heading', { name: 'Top hosts by CPU' })).closest('section') as HTMLElement;
    expect([...panel.querySelectorAll('.top-fill')].map((f) => f.className)).toEqual(['top-fill hot', 'top-fill busy', 'top-fill busy', 'top-fill']);
  });

  it('lists ten hosts on a page and the first eight on a wall, which cannot scroll', async () => {
    vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse());
    const t = topHostsResponse();
    t.metrics[0].rows = Array.from({ length: 10 }, (_, i) => ({ hostid: String(i + 1), host: `H${i + 1}`, itemid: String(i + 1), value: 90 - i, clock: 1 }));
    vi.spyOn(api, 'topHosts').mockResolvedValue(t);
    const { unmount } = show();
    let p = (await screen.findByRole('heading', { name: 'Top hosts by CPU' })).closest('section') as HTMLElement;
    expect(p.querySelectorAll('.top-row')).toHaveLength(10);
    unmount();
    show(true);
    p = (await screen.findByRole('heading', { name: 'Top hosts by CPU' })).closest('section') as HTMLElement;
    expect([...p.querySelectorAll('.top-host')].map((h) => h.textContent)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8']);
  });

  it('makes a host a link to the graph of that item, but not on a wall', async () => {
    ready();
    const { unmount } = show();
    expect(await screen.findByRole('link', { name: '3.1 SITE3-FW-01' })).toHaveAttribute('href', '/graphs?hostid=3&itemid=301');
    unmount();
    show(true);
    await screen.findByRole('heading', { name: 'Top hosts by CPU' });
    expect(screen.queryByRole('link', { name: '3.1 SITE3-FW-01' })).toBeNull();
    expect(screen.getByText('3.1 SITE3-FW-01')).toBeInTheDocument();
  });

  it('says why a list is empty instead of drawing nothing', async () => {
    ready();
    show();
    const panel = (await screen.findByRole('heading', { name: 'Top hosts by memory' })).closest('section') as HTMLElement;
    expect(within(panel).getByText('No current value: 6 hosts have the item, none collected it lately.')).toBeInTheDocument();
    expect(panel.querySelector('.top-list')).toBeNull();
  });

  it('keeps the bar inside its box whatever the figure', async () => {
    vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse());
    const t = topHostsResponse();
    t.metrics[0].rows = [
      { hostid: '1', host: 'A', itemid: '1', value: 140, clock: 1 },
      { hostid: '2', host: 'B', itemid: '2', value: -3, clock: 1 },
    ];
    vi.spyOn(api, 'topHosts').mockResolvedValue(t);
    show();
    await screen.findByRole('heading', { name: 'Top hosts by CPU' });
    const widths = [...document.querySelectorAll('.top-fill')].map((f) => (f as HTMLElement).style.width);
    expect(widths.slice(0, 2)).toEqual(['100%', '0%']);
  });
});

describe('HostsView web monitoring', () => {
  const panel = async () => (await screen.findByRole('heading', { name: 'Web monitoring' })).closest('section') as HTMLElement;

  it('counts the scenarios that pass, fail and have no current result, each with a few words', async () => {
    ready();
    show();
    const p = await panel();
    const tiles = [...p.querySelectorAll('.kind-tile')];
    expect(tiles.map((t) => t.textContent)).toEqual(['OK 5 every step passed', 'Failed 1 a step failed', 'Unknown 1 no current result']);
  });

  it('marks the failed count with the red edge only when something has failed', async () => {
    ready();
    const { unmount } = show();
    let p = await panel();
    expect(p.querySelectorAll('.kind-tile.alert')).toHaveLength(1);
    expect(p.querySelector('.kind-tile.alert')).toHaveTextContent('Failed');
    unmount();
    vi.spyOn(api, 'webMonitoring').mockResolvedValue(webMonitoringResponse({ ok: 7, failed: 0, unknown: 0, failures: [] }));
    show();
    p = await panel();
    await screen.findByText('every step passed');
    expect(p.querySelectorAll('.kind-tile.alert')).toHaveLength(0);
    expect(p.querySelector('.web-failures')).toBeNull();
  });

  it('lists the failed scenarios with the host, the step and the time, and the host is a link to the graph of its result', async () => {
    ready();
    show();
    const p = await panel();
    const row = p.querySelector('.web-failure') as HTMLElement;
    expect(row).toHaveTextContent(/^SITE-WEB · Checkout\s*failed at step 2, \d\d:\d\d:\d\d WIB$/);
    expect(within(row).getByRole('link', { name: 'SITE-WEB' })).toHaveAttribute('href', '/graphs?hostid=4&itemid=401');
  });

  it('draws no link on a wall', async () => {
    ready();
    show(true);
    const p = await panel();
    expect(within(p).queryAllByRole('link')).toHaveLength(0);
    expect(p.querySelector('.web-failure')).toHaveTextContent('SITE-WEB · Checkout');
  });

  it('says how many more have failed than the list holds', async () => {
    ready();
    vi.spyOn(api, 'webMonitoring').mockResolvedValue(webMonitoringResponse({ failed: 14, ok: 0, unknown: 0, total: 14 }));
    show();
    const p = await panel();
    expect(within(p).getByText('and 13 more')).toBeInTheDocument();
  });

  const failing = (n: number) => Array.from({ length: n }, (_, i) => ({ hostid: String(i + 1), host: `HOST ${i + 1}`, name: 'Home', itemid: String(500 + i), step: 1, clock: 1_800_000_000 }));

  it('lists every failure it is given on a page, and only three on a wall, which cannot scroll, with the rest counted', async () => {
    ready();
    vi.spyOn(api, 'webMonitoring').mockResolvedValue(webMonitoringResponse({ total: 9, ok: 1, failed: 8, unknown: 0, failures: failing(8) }));
    const { unmount } = show();
    let p = await panel();
    expect(p.querySelectorAll('.web-failure')).toHaveLength(8);
    expect(within(p).queryByText(/more$/)).toBeNull();
    unmount();
    show(true);
    p = await panel();
    expect(p.querySelectorAll('.web-failure')).toHaveLength(3);
    expect(within(p).getByText('and 5 more')).toBeInTheDocument();
  });

  it('says so when no scenario is monitored, and draws no tiles', async () => {
    ready();
    vi.spyOn(api, 'webMonitoring').mockResolvedValue(webMonitoringResponse({ total: 0, ok: 0, failed: 0, unknown: 0, failures: [] }));
    show();
    const p = await panel();
    expect(within(p).getByText('No web scenario is monitored.')).toBeInTheDocument();
    expect(p.querySelector('.kind-tile')).toBeNull();
  });

  it('shows a failure of its own request in its place, and the rest of the view stays', async () => {
    ready();
    vi.spyOn(api, 'webMonitoring').mockRejectedValue(new Error('The data source is not answering.'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('The data source is not answering.');
    expect(await screen.findByRole('heading', { name: 'Top hosts by CPU' })).toBeInTheDocument();
    expect(screen.getByText('Monitored hosts', { selector: '.label' })).toBeInTheDocument();
  });
});

describe('HostsView when a request fails or is awaited', () => {
  it('says it is loading, then shows each part as its own answer comes: a failed list does not take the counts with it', async () => {
    vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse());
    vi.spyOn(api, 'topHosts').mockRejectedValue(new Error('The data source is not answering. Tell an administrator and quote reference abc123.'));
    show();
    expect(await screen.findByText('Monitored hosts', { selector: '.label' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('The data source is not answering.');
  });

  it('shows the failure of the device list in its place, and still the busiest hosts', async () => {
    vi.spyOn(api, 'devices').mockRejectedValue(new Error('The data source is not answering.'));
    vi.spyOn(api, 'topHosts').mockResolvedValue(topHostsResponse());
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('The data source is not answering.');
    expect(await screen.findByRole('heading', { name: 'Top hosts by CPU' })).toBeInTheDocument();
  });

  it('says when the device list was updated', async () => {
    ready();
    show();
    expect(await screen.findByText(/^Updated \d\d:\d\d:\d\d WIB$/)).toBeInTheDocument();
  });
});
