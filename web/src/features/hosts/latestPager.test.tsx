import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, configure } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import LatestData from './LatestData';
import type { LatestItem } from '../../types';

// A page loads in steps and the test files run side by side, so the default second of waiting is too short on a busy machine.
configure({ asyncUtilTimeout: 5000 });

/**
 * The pager of Latest data sits outside the content that goes inert while the next page loads (UX-57): inside it, pressing Next took the focus from
 * the button just pressed. jsdom has no `inert`, so what is checked is where the pager is in the page.
 */
const item = (n: number): LatestItem =>
  ({ itemid: String(n), name: `Item ${n}`, key_: `key.${n}`, lastclock: '1788000000', lastvalue: '5', value_type: '3', state: '0', units: '', hosts: [{ hostid: '1', name: 'core-1' }] }) as LatestItem;

beforeEach(() => {
  resetAuthProbe();
  window.history.replaceState(null, '', '/latest?hostid=1');
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'hosts').mockResolvedValue([{ hostid: '1', name: '1.1 core-1', status: '0' }]);
  vi.spyOn(api, 'hostgroups').mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

const settle = () => act(async () => undefined);

describe('the pager of Latest data (UX-57)', () => {
  it('is not inside the inert content while the next page loads, and keeps the focus of the button that was pressed', async () => {
    let release!: () => void;
    vi.spyOn(api, 'latest').mockImplementation(({ page }) =>
      page === 1
        ? Promise.resolve({ items: [item(1), item(2)], truncated: false, total: 300, page: 1, pageSize: 100 })
        : new Promise((resolve) => {
            release = () => resolve({ items: [item(101)], truncated: false, total: 300, page: 2, pageSize: 100 });
          }),
    );
    const { container } = render(<LatestData />, { wrapper: BrowserRouter });
    await settle();
    const next = await screen.findByRole('button', { name: /Next/ });
    next.focus();
    fireEvent.click(next);
    await settle();

    // The old page is dimmed and inert, the pager is not, and it is the same button with the focus on it.
    expect(container.querySelector('[inert]')).not.toBeNull();
    expect(screen.getByText('Item 1').closest('[inert]')).not.toBeNull();
    const again = screen.getByRole('button', { name: /Next/ });
    expect(again.closest('[inert]')).toBeNull();
    expect(again).toBe(next);
    expect(document.activeElement).toBe(next);
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

    await act(async () => release());
    await settle();
    expect(screen.getByText('Item 101')).toBeInTheDocument();
    expect(container.querySelector('[inert]')).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it('shows the pager for a page past the end of a list that has items, and none for a single page', async () => {
    vi.spyOn(api, 'latest').mockResolvedValue({ items: [item(1)], truncated: false, total: 1, page: 1, pageSize: 100 });
    const { unmount } = render(<LatestData />, { wrapper: BrowserRouter });
    await settle();
    expect(await screen.findByText('Item 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
    unmount();

    window.history.replaceState(null, '', '/latest?hostid=1&page=9');
    vi.mocked(api.latest).mockResolvedValue({ items: [], truncated: false, total: 250, page: 9, pageSize: 100 });
    render(<LatestData />, { wrapper: BrowserRouter });
    await settle();
    expect(await screen.findByText(/There are no items on page/)).toBeInTheDocument();
  });

  it('keeps a pager under a page that came back empty although the list has items, so that the person can go back', async () => {
    window.history.replaceState(null, '', '/latest?hostid=1&page=2');
    vi.spyOn(api, 'latest').mockResolvedValue({ items: [], truncated: false, total: 50, page: 2, pageSize: 100 });
    render(<LatestData />, { wrapper: BrowserRouter });
    await settle();
    expect(await screen.findByText(/There are no items on page/)).toBeInTheDocument();
    expect(screen.getByText(/Page \d of 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prev/ })).toBeInTheDocument();
  });

  it('draws no pager while the first page loads, or when the list could not be read', async () => {
    vi.spyOn(api, 'latest').mockReturnValue(new Promise(() => undefined));
    const { unmount } = render(<LatestData />, { wrapper: BrowserRouter });
    await settle();
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
    unmount();

    vi.mocked(api.latest).mockRejectedValue(new Error('Zabbix did not answer'));
    render(<LatestData />, { wrapper: BrowserRouter });
    await settle();
    expect(await screen.findByText(/Zabbix did not answer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
  });
});
