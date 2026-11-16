import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, configure } from '@testing-library/react';
import { api } from '../../api';
import type { Item } from '../../types';
import ItemPicker from './ItemPicker';

// A page loads in steps and the test files run side by side, so the default second of waiting is too short on a busy machine.
configure({ asyncUtilTimeout: 5000 });

/**
 * The picker dims the previous host's list while the next host's loads. Dimmed was all it did (UX-58): Tab still reached the old items, and Enter picked one,
 * which went into the address for the new host. It is now out of reach of the keyboard as well, as `Loaded` is (FR-54).
 */
const item = (itemid: string, name: string, key_: string): Item => ({ itemid, name, key_, value_type: '0', units: 'bps', hosts: [{ hostid: '1', name: 'sw-1' }] });
const FIRST = [item('1', 'Interface Gi1/0/1(uplink): Bits received', 'net.if.in[ifHCInOctets.1]'), item('2', 'Load average', 'system.cpu.load')];
const SECOND = [item('9', 'Free memory', 'vm.memory.size[free]')];

afterEach(() => vi.restoreAllMocks());

describe('the item list of another host that is still loading (UX-58)', () => {
  it('keeps the previous host list out of reach of the keyboard until the new one arrives', async () => {
    let release!: () => void;
    vi.spyOn(api, 'items').mockImplementation((hostid) =>
      hostid === '611' ? Promise.resolve(FIRST) : new Promise((resolve) => (release = () => resolve(SECOND))),
    );
    const onChange = vi.fn();
    const { rerender } = render(<ItemPicker hostid="611" selected={[]} onChange={onChange} />);
    await screen.findByRole('button', { name: /Load average/ });
    const list = document.querySelector('.item-picker-list') as HTMLElement;
    expect(list).not.toHaveAttribute('inert');

    rerender(<ItemPicker hostid="612" selected={[]} onChange={onChange} />);
    expect(list).toHaveClass('stale');
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(list).toHaveAttribute('inert');

    await act(async () => release());
    await screen.findByRole('button', { name: /Free memory/ });
    const fresh = document.querySelector('.item-picker-list') as HTMLElement;
    expect(fresh).not.toHaveAttribute('inert');
    expect(fresh).not.toHaveClass('stale');
    expect(fresh).not.toHaveAttribute('aria-busy');
  });

  it('is not inert for the first list of a host, which is not stale', async () => {
    vi.spyOn(api, 'items').mockResolvedValue(FIRST);
    render(<ItemPicker hostid="613" selected={[]} onChange={vi.fn()} />);
    await screen.findByRole('button', { name: /Load average/ });
    expect(document.querySelector('[inert]')).toBeNull();
  });
});
