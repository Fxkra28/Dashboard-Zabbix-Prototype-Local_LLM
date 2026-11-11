import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { api } from '../../api';
import type { Item } from '../../types';
import ItemPicker from './ItemPicker';

/** The buttons of the item picker say whether they are on by more than their colour (UX-40): a screen reader is told "pressed". */

const item = (itemid: string, name: string, key_: string): Item => ({ itemid, name, key_, value_type: '0', units: 'bps', hosts: [{ hostid: '1', name: 'sw-1' }] });
const ITEMS = [
  item('1', 'Interface Gi1/0/1(uplink): Bits received', 'net.if.in[ifHCInOctets.1]'),
  item('2', 'Interface Gi1/0/1(uplink): Bits sent', 'net.if.out[ifHCOutOctets.1]'),
  item('3', 'Interface Gi1/0/2(spare): Bits received', 'net.if.in[ifHCInOctets.2]'),
];

beforeEach(() => void vi.spyOn(api, 'items').mockResolvedValue(ITEMS));
afterEach(() => vi.restoreAllMocks());

const open = async (selected: string[], hostid: string) => {
  const onChange = vi.fn();
  render(<ItemPicker hostid={hostid} selected={selected} onChange={onChange} />);
  await screen.findByRole('button', { name: /Traffic in \+ out/ });
  return onChange;
};
const traffic = () => screen.getByRole('button', { name: /Traffic in \+ out/ });

describe('the Traffic in + out button', () => {
  it('is pressed when exactly its two items are the selection', async () => {
    await open(['1', '2'], '501');
    expect(traffic()).toHaveAttribute('aria-pressed', 'true');
    expect(traffic()).toHaveClass('on');
  });

  it('is not pressed for no selection, for one of its items, or for its two and a third', async () => {
    for (const [selected, hostid] of [[[], '502'], [['1'], '503'], [['1', '2', '3'], '504']] as const) {
      const view = render(<ItemPicker hostid={hostid} selected={[...selected]} onChange={vi.fn()} />);
      await screen.findByRole('button', { name: /Traffic in \+ out/ });
      expect(traffic(), JSON.stringify(selected)).toHaveAttribute('aria-pressed', 'false');
      expect(traffic()).not.toHaveClass('on');
      view.unmount();
    }
  });

  it('says it is pressed in the same words as every other item button, so the picker reads alike', async () => {
    await open(['3'], '505');
    const others = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    expect(others.length).toBeGreaterThanOrEqual(2);
    expect(others).toContain(traffic());
  });

  it('replaces the selection when pressed, as before', async () => {
    const onChange = await open(['3'], '506');
    fireEvent.click(traffic());
    expect(onChange).toHaveBeenLastCalledWith(['1', '2']);
  });
});
