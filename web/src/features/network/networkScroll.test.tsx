import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Network from './Network';
import type { NetDevice } from '../../types';

vi.mock('../graphs/TimeSeriesChart', () => ({ GraphView: () => <div /> }));

/**
 * Choosing a device brings its interfaces into view. Somebody who has asked their system for less motion gets the jump and not the glide: `behavior: 'smooth'`
 * beats the CSS rule that stops animation, so the code has to ask (UX-52).
 */
const device = (hostid: string, name: string): NetDevice => ({ hostid, name, status: '0', interfaces: [], icmp: { up: true, loss: 0, latency: 0.01, state: 'up' } });

/** A matchMedia that answers the reduced-motion query as told, and lets the test change its mind. */
function mediaQuery(reduce: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: reduce,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return (now: boolean) => {
    query.matches = now;
    listeners.forEach((l) => l());
  };
}

let scrolled: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetAuthProbe();
  scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled as never;
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'netDevices').mockResolvedValue([device('1', 'sw-1'), device('2', 'sw-2')]);
  vi.spyOn(api, 'netInterfaces').mockResolvedValue({ rows: [], total: 0, summary: { up: 0, down: 0, other: 0 }, page: 1, pageSize: 50 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = () => {
  window.history.replaceState(null, '', '/network?hostid=1');
  return render(
    <BrowserRouter>
      <Network />
    </BrowserRouter>,
  );
};
const pick = async (name: string) => {
  await userEvent.setup().click(await screen.findByText(name));
  await vi.waitFor(() => expect(scrolled).toHaveBeenCalled());
  return scrolled.mock.calls[scrolled.mock.calls.length - 1]?.[0] as ScrollIntoViewOptions;
};

describe('choosing a device on the Network page', () => {
  it('glides to its interfaces by default', async () => {
    mediaQuery(false);
    open();
    expect(await pick('sw-2')).toEqual({ behavior: 'smooth', block: 'start' });
  });

  it('jumps to them when the person has asked for reduced motion', async () => {
    mediaQuery(true);
    open();
    expect(await pick('sw-2')).toEqual({ behavior: 'auto', block: 'start' });
  });

  it('follows the setting when it changes while the page is open', async () => {
    const set = mediaQuery(false);
    open();
    expect(await pick('sw-2')).toMatchObject({ behavior: 'smooth' });
    const { act } = await import('@testing-library/react');
    act(() => set(true));
    scrolled.mockClear();
    expect(await pick('sw-1')).toMatchObject({ behavior: 'auto' });
  });
});
