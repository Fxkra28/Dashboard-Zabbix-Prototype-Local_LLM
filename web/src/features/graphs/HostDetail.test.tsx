import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import type { Host, Item } from '../../types';

/**
 * An address that names items (FR-24): it opens the host of the first, shows the items that are on that host, and
 * says which it left out and why. An item that cannot be found no longer leaves "Loading hosts…" for ever.
 */
vi.mock('echarts-for-react/esm/core', () => ({ default: () => <div /> }));
const { default: HostDetail } = await import('./HostDetail');

const HOSTS: Host[] = [
  { hostid: '1', name: '1.1 core-1', status: '0' },
  { hostid: '2', name: '1.2 core-2', status: '0' },
];
const item = (itemid: string, hostid: string, name: string, key_ = `k.${itemid}`): Item => ({
  itemid, name, key_, value_type: '3', units: 'bps', hosts: [{ hostid, name: hostid === '1' ? '1.1 core-1' : '1.2 core-2' }],
});
const ITEMS = [item('10', '1', 'Bits received'), item('11', '1', 'Bits sent'), item('20', '2', 'CPU load')];

const open = (url: string) => {
  window.history.replaceState(null, '', url);
  return render(<HostDetail />, { wrapper: BrowserRouter });
};
const query = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  vi.spyOn(api, 'hosts').mockResolvedValue(HOSTS);
  vi.spyOn(api, 'items').mockImplementation(async (hostid) => ITEMS.filter((i) => i.hosts?.[0].hostid === hostid));
  vi.spyOn(api, 'itemsById').mockImplementation(async (ids) => ITEMS.filter((i) => ids.includes(i.itemid)));
  vi.spyOn(api, 'graph').mockReturnValue(new Promise(() => undefined));
});
afterEach(() => vi.restoreAllMocks());

describe('the Graphs page opened by an address that names items', () => {
  it('opens the host of the first item and shows the items that are on it', async () => {
    open('/graphs?itemid=10,11');
    await waitFor(() => expect(query().get('hostid')).toBe('1'));
    expect(await screen.findByRole('button', { name: 'Remove Bits sent' })).toBeInTheDocument();
    expect(screen.queryByText(/left out/)).toBeNull();
  });

  it('says which item it left out when the address names items of two hosts, and why', async () => {
    open('/graphs?itemid=10,20');
    await waitFor(() => expect(query().get('hostid')).toBe('1'));
    const note = await screen.findByText(/left out/);
    expect(note).toHaveTextContent('Item 20 is not a graphable item of this host, so it was left out.');
    expect(note).toHaveAttribute('role', 'status');
    expect(query().get('itemid')).toBe('10');
  });

  it('names every item that was left out', async () => {
    vi.spyOn(api, 'itemsById').mockImplementation(async (ids) => ITEMS.filter((i) => ids.includes(i.itemid)));
    open('/graphs?itemid=10,20,21');
    expect(await screen.findByText(/left out/)).toHaveTextContent('Items 20, 21 are not graphable items of this host, so they were left out.');
  });

  it('opens the first host and says the item was not found, instead of waiting for ever, when no item in the address exists', async () => {
    open('/graphs?itemid=999');
    await waitFor(() => expect(query().get('hostid')).toBe('1'));
    await waitFor(() => expect(query().has('itemid')).toBe(true)); // the first host's default item, once its items are in
    expect(await screen.findByText(/left out/)).toHaveTextContent('Item 999 was not found, so it was left out.');
    expect(screen.queryByText('Loading hosts…', { selector: '.state *' })).toBeNull();
  });

  it('opens the first host and says so when the items could not be looked up', async () => {
    vi.spyOn(api, 'itemsById').mockRejectedValue(new Error('boom'));
    open('/graphs?itemid=10');
    await waitFor(() => expect(query().get('hostid')).toBe('1'));
    expect(await screen.findByText(/left out/)).toHaveTextContent('Item 10 could not be looked up, so it was left out.');
  });

  it('takes the note away once the person picks the items themselves', async () => {
    const user = userEvent.setup();
    open('/graphs?itemid=10,20');
    expect(await screen.findByText(/left out/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Bits sent/ }));
    await waitFor(() => expect(screen.queryByText(/left out/)).toBeNull());
  });

  describe('when the lookup of the items in the address is slow', () => {
    // The person does not wait: they pick host 2, and the page opens its first item, "CPU load", while the lookup is still out.
    const chooseMeanwhile = async () => {
      const user = userEvent.setup();
      await screen.findByRole('option', { name: '1.2 core-2' });
      await user.selectOptions(screen.getByLabelText('Host'), '2');
      await waitFor(() => expect(query().get('hostid')).toBe('2'));
      await waitFor(() => expect(query().get('itemid')).toBe('20'));
    };

    it('does not take back what the person chose when it answers that the items are not there', async () => {
      let answer!: (items: Item[]) => void;
      vi.spyOn(api, 'itemsById').mockImplementation(() => new Promise<Item[]>((resolve) => (answer = resolve)));
      open('/graphs?itemid=999');
      await chooseMeanwhile();
      answer([]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(query().get('hostid')).toBe('2');
      expect(query().get('itemid')).toBe('20');
      expect(screen.queryByText(/left out/)).toBeNull();
    });

    it('does not move the person to the host of the item either', async () => {
      let answer!: (items: Item[]) => void;
      vi.spyOn(api, 'itemsById').mockImplementation(() => new Promise<Item[]>((resolve) => (answer = resolve)));
      open('/graphs?itemid=10');
      await chooseMeanwhile();
      answer([ITEMS[0]]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(query().get('hostid')).toBe('2');
      expect(query().get('itemid')).toBe('20');
    });

    it('does not say the items could not be looked up, when the lookup fails after the person chose', async () => {
      let fail!: (error: Error) => void;
      vi.spyOn(api, 'itemsById').mockImplementation(() => new Promise<Item[]>((_resolve, reject) => (fail = reject)));
      open('/graphs?itemid=10');
      await chooseMeanwhile();
      fail(new Error('boom'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(query().get('itemid')).toBe('20');
      expect(screen.queryByText(/left out/)).toBeNull();
    });
  });
});
