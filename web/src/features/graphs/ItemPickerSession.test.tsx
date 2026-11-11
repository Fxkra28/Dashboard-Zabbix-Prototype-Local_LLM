import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { api, login, logout } from '../../api';
import type { Item } from '../../types';
import ItemPicker from './ItemPicker';

/**
 * The item list of a host is kept for five minutes in the page. The server leaves the interface
 * items out of it for a viewer, so a list kept from an operator's visit must not be shown to the next
 * person who signs in on the same tab (SC-36).
 */
const item = (itemid: string, name: string, key_: string): Item => ({ itemid, name, key_, value_type: '3', units: 'bps', hosts: [{ hostid: '1', name: 'sw-lt3' }] });
const OPERATOR_LIST = [item('10', 'CPU load', 'system.cpu.load'), item('11', 'Interface Gi1/0/1(uplink to core): Bits sent', 'net.if.out[ifHCOutOctets.1]')];
const VIEWER_LIST = [item('10', 'CPU load', 'system.cpu.load')];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let list: Item[];
let items: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  list = OPERATOR_LIST;
  items = vi.spyOn(api, 'items').mockImplementation(async () => list);
  // One host for every case, so a list kept by an earlier case would be served: start with an empty cache.
  vi.stubGlobal('fetch', vi.fn(async () => json(200, { ok: true, user: { name: 'ana', role: 'viewer' }, expiresIn: 3600 })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function visit(hostid: string) {
  const view = render(<ItemPicker hostid={hostid} selected={[]} onChange={() => undefined} />);
  await screen.findByRole('textbox', { name: 'Search items' });
  await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Search items' })).toHaveAttribute('placeholder', expect.stringMatching(/Search \d+ items/)));
  return view;
}

describe('the list of a host that the picker keeps', () => {
  it('is served again to a second visit by the same person, with no second request', async () => {
    const first = await visit('201');
    first.unmount();
    await visit('201');
    expect(items).toHaveBeenCalledTimes(1);
  });

  it('is forgotten when someone signs out, so the next person to sign in on the tab reads a list of their own', async () => {
    const first = await visit('202');
    expect(screen.getByText(/Gi1\/0\/1/)).toBeInTheDocument();
    first.unmount();

    await logout();
    await login('ana', 'viewer-pass');
    list = VIEWER_LIST;
    await visit('202');

    expect(items).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Gi1\/0\/1/)).toBeNull();
    expect(screen.getByText('CPU load')).toBeInTheDocument();
  });

  it('is forgotten at a sign-out alone, before anyone signs in again', async () => {
    const first = await visit('204');
    first.unmount();
    await logout();
    await visit('204');
    expect(items).toHaveBeenCalledTimes(2);
  });

  it('is forgotten at a sign-in alone, which a tab that missed the sign-out would still see', async () => {
    const first = await visit('203');
    first.unmount();
    await login('ana', 'viewer-pass');
    await visit('203');
    expect(items).toHaveBeenCalledTimes(2);
  });
});
