import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Devices from './Devices';
import type { Device, DevicesResponse, Role } from '../../types';

/** The Devices page: a tile for each kind of device that is also the filter of the list under it. Read-only: a device is added in Zabbix. */

const CLASSES: DevicesResponse['classes'] = [
  { key: 'switch', label: 'Switches' },
  { key: 'firewall', label: 'Firewalls' },
  { key: 'access-point', label: 'Access points' },
  { key: 'repeater', label: 'Radio repeaters' },
  { key: 'server', label: 'Servers' },
  { key: 'wan-link', label: 'WAN links' },
  { key: 'web', label: 'Web services' },
  { key: 'other', label: 'Other' },
];

const device = (hostid: string, name: string, kind: Device['class'], over: Partial<Device> = {}): Device => ({
  hostid,
  name,
  status: '0',
  maintenance_status: '0',
  interfaces: [{ ip: `10.0.0.${hostid}`, type: '2', available: '1' }],
  site: { code: 1, name: 'Jakarta' },
  state: 'up',
  reason: 'ping',
  problems: { total: 0, bySeverity: {} },
  class: kind,
  category: 'Cisco IOS by SNMP',
  ...over,
});

const DEVICES: Device[] = [
  device('1', '1.1 CORESWITCH', 'switch', { problems: { total: 2, bySeverity: { '4': 2 } } }),
  device('2', '1.2 EDGESWITCH', 'switch'),
  device('3', '3.1 SITE3-FW-01', 'firewall', { site: { code: 3, name: 'Site Three' }, category: 'FortiGate by SNMP', state: 'down', reason: 'ping' }),
  device('4', 'SERVER : DATABASE', 'server', { site: null, category: 'Other', interfaces: [] }),
  device('5', '2.1.1 ARUBA AP 3', 'access-point', { site: { code: 2, name: 'Surabaya' }, category: 'Generic by SNMP' }),
];

const response = (devices = DEVICES): DevicesResponse => ({ classes: CLASSES, devices });

function signedInAs(role: Role) {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role }, expiresIn: 3600, pages: {} } as never);
}
function open(url = '/devices') {
  window.history.replaceState(null, '', url);
  return render(
    <BrowserRouter>
      <Devices />
    </BrowserRouter>,
  );
}

beforeEach(() => {
  signedInAs('viewer');
  vi.spyOn(api, 'devices').mockResolvedValue(response());
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

const tile = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}\\b`) });
const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);

describe('the kind tiles', () => {
  it('has one for every kind and one for all, each with how many there are', async () => {
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(tile('All devices')).toHaveTextContent('5');
    expect(tile('Switches')).toHaveTextContent('2');
    expect(tile('Firewalls')).toHaveTextContent('1');
    expect(tile('Servers')).toHaveTextContent('1');
    expect(tile('Access points')).toHaveTextContent('1');
  });

  it('says what is wrong with the devices of a kind, or that nothing is', async () => {
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(tile('Switches')).toHaveTextContent('1 with problems');
    expect(tile('Firewalls')).toHaveTextContent('no problems · 1 down');
    expect(tile('Servers')).toHaveTextContent('no problems');
    expect(tile('All devices')).toHaveTextContent('1 with problems · 1 down');
  });

  it('turns off a kind that has no devices, and says none', async () => {
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(tile('Radio repeaters')).toBeDisabled();
    expect(tile('Radio repeaters')).toHaveTextContent('none');
    expect(tile('Switches')).toBeEnabled();
  });

  it('lists the kinds in the order the server gave them', async () => {
    open();
    const group = await screen.findByRole('group', { name: 'Kind of device' });
    const labels = within(group).getAllByRole('button').map((b) => b.querySelector('.type-name')?.textContent);
    expect(labels).toEqual(['All devices', ...CLASSES.map((c) => c.label)]);
  });
});

describe('choosing a kind', () => {
  it('lists the devices of that kind alone, names it, and presses its tile', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(names()).toHaveLength(5);

    await user.click(tile('Switches'));
    expect(names()).toEqual(['1.1 CORESWITCH', '1.2 EDGESWITCH']);
    expect(screen.getByRole('heading', { name: 'Switches' })).toBeInTheDocument();
    expect(tile('Switches')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('All devices')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('2 devices')).toBeInTheDocument();
  });

  it('keeps the kind in the address, so Back and a link find it again, and takes it out for "All devices"', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    await user.click(tile('Firewalls'));
    expect(new URLSearchParams(window.location.search).get('type')).toBe('firewall');
    await user.click(tile('All devices'));
    expect(window.location.search).toBe('');
  });

  it('opens on the kind a link names', async () => {
    open('/devices?type=server');
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(names()).toEqual(['SERVER : DATABASE']);
    expect(tile('Servers')).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads a kind it does not know as all devices', async () => {
    open('/devices?type=toaster');
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(names()).toHaveLength(5);
    expect(tile('All devices')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the list', () => {
  it('has the columns of the Hosts page, and the site and the template', async () => {
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Host',
      'Site',
      'Interface',
      'Availability',
      'Status',
      'Problems',
      'Template',
      'Actions',
    ]);
    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('1.1 CORESWITCH');
    expect(cells[1]).toHaveTextContent('Jakarta');
    expect(cells[6]).toHaveTextContent('Cisco IOS by SNMP');
  });

  it('says "No site" for a device whose name gives none', async () => {
    open('/devices?type=server');
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[1]).toHaveTextContent('No site');
  });

  it('searches the name, the site and the template, within the kind chosen', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    await user.type(screen.getByLabelText('Search device'), 'site three');
    await screen.findByText('1 device');
    expect(names()).toEqual(['3.1 SITE3-FW-01']);

    await user.clear(screen.getByLabelText('Search device'));
    await user.type(screen.getByLabelText('Search device'), 'generic');
    await screen.findByText('1 device');
    expect(names()).toEqual(['2.1.1 ARUBA AP 3']);
  });

  it('keeps to the devices with problems when asked', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    await user.click(screen.getByLabelText('With problems only'));
    expect(names()).toEqual(['1.1 CORESWITCH']);
    expect(new URLSearchParams(window.location.search).get('problems')).toBe('1');
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    await user.type(screen.getByLabelText('Search device'), 'zzz');
    expect(await screen.findByText('No device matches.')).toBeInTheDocument();
  });

  it('offers no way to add or change a device: it is read-only, and a device is added in Zabbix', async () => {
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(screen.queryByRole('button', { name: /add|new|create|delete|edit/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /add|new|create|delete|edit/i })).toBeNull();
  });
});

describe('the link to the ports', () => {
  it('is not offered to a viewer, who may not read interface data', async () => {
    open();
    await screen.findByRole('group', { name: 'Kind of device' });
    expect(screen.queryByRole('link', { name: 'Ports' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Graphs' })).toHaveLength(5);
  });

  it('is offered to an operator and an admin, to the Network page with the device chosen', async () => {
    for (const role of ['operator', 'admin'] as const) {
      signedInAs(role);
      const { unmount } = open('/devices?type=firewall');
      const link = await screen.findByRole('link', { name: 'Ports' });
      expect(link).toHaveAttribute('href', '/network?hostid=3');
      unmount();
    }
  });
});

describe('when the list cannot be had', () => {
  it('shows the failure, like every other page', async () => {
    vi.spyOn(api, 'devices').mockRejectedValue(new Error('The data source is not answering. Tell an administrator and quote reference abc.'));
    open();
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('The data source is not answering.');
  });

  it('shows no tiles while it loads', () => {
    vi.spyOn(api, 'devices').mockReturnValue(new Promise(() => undefined));
    open();
    expect(screen.queryByRole('group', { name: 'Kind of device' })).toBeNull();
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
  });
});
