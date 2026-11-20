import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import LatestData from './LatestData';

/**
 * Latest data writes a number item as a number and a text item as the words Zabbix sent (FR-69): a serial number of 0012345678 is not 12,345,678, nor a version 2.10 the number 2.1. The items are made up.
 */
const item = (over: Record<string, unknown>) => ({ itemid: '1', name: 'Serial number', key_: 'system.hw.serial', value_type: '1', state: '0', units: '', lastvalue: '0012345678', lastclock: '1790000000', prevvalue: '0012345678', ...over });

beforeEach(() => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'hosts').mockResolvedValue([{ hostid: '1', name: '1.1 core-1', status: '0' }]);
  vi.spyOn(api, 'hostgroups').mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

const showItems = async (items: unknown[]) => {
  vi.spyOn(api, 'latest').mockResolvedValue({ items: items as never, truncated: false, total: items.length, page: 1, pageSize: 100 });
  window.history.replaceState(null, '', '/latest?hostid=1');
  render(<LatestData />, { wrapper: BrowserRouter });
  await screen.findByText(String((items[0] as { name: string }).name));
};

describe('the values of Latest data', () => {
  it('print a character or text item as it was sent, leading zeros and trailing zeros included', async () => {
    await showItems([
      item({}),
      item({ itemid: '2', name: 'Firmware', key_: 'system.hw.firmware', lastvalue: '2.10', prevvalue: '2.10' }),
      item({ itemid: '3', name: 'Contact phone', key_: 'system.contact', value_type: '4', lastvalue: '08123456789', prevvalue: '08123456789' }),
    ]);
    expect(screen.getByText('0012345678')).toBeInTheDocument();
    expect(screen.getByText('2.10')).toBeInTheDocument();
    expect(screen.getByText('08123456789')).toBeInTheDocument();
    expect(screen.queryByText('12,345,678')).toBeNull();
  });

  it('still format a number item with its unit', async () => {
    await showItems([item({ itemid: '4', name: 'Traffic', key_: 'net.if.in[1]', value_type: '3', units: 'bps', lastvalue: '12345678', prevvalue: '12345678' })]);
    expect(await screen.findByText(/12\.35 Mbps/)).toBeInTheDocument();
    expect(screen.queryByText('12345678')).toBeNull();
  });
});
