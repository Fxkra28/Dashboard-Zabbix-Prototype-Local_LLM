import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { api } from '../../api';
import type { GraphSeries, Item } from '../../types';
import { MAX_UNIT_SCALES, unitFamilies } from './unitScales';

/**
 * A graph has a scale on each side, so it holds two kinds of unit at most (FR-21). A third used to be
 * drawn on the first scale, flat at zero, while the tooltip named the right unit: the picker now refuses
 * it in words, and a chart reached by an address that names three says what it cannot draw.
 */
const chart = vi.hoisted(() => ({ option: null as null | { yAxis: unknown[]; series: { yAxisIndex: number; name: string }[] } }));
vi.mock('echarts-for-react/esm/core', () => ({
  default: (props: { option: typeof chart.option }) => {
    chart.option = props.option;
    return <div />;
  },
}));
const { default: TimeSeriesChart } = await import('./TimeSeriesChart');
const { default: ItemPicker } = await import('./ItemPicker');

const item = (itemid: string, name: string, units: string): Item => ({ itemid, name, key_: `k.${itemid}`, value_type: '3', units, hosts: [{ hostid: '1', name: 'sw-lt3' }] });
const ITEMS = [item('1', 'Bits received', 'bps'), item('2', 'Bits sent', 'bps'), item('3', 'CPU utilisation', '%'), item('4', 'Ping response time', 's')];

const AT = Date.UTC(2026, 9, 7, 8, 0, 0);
const seriesOf = (itemid: string, name: string, units: string): GraphSeries => ({
  itemid, name, host: 'sw-lt3', units, value_type: '0', delaySeconds: 60, step: false,
  points: [[AT, 5, null, null]], stats: null, coverage: { coveredSeconds: 3600, firstClock: AT / 1000, lastClock: AT / 1000 + 3600 },
});

describe('unitFamilies', () => {
  it('lists each kind of unit once, in the order it first appears, with no unit as a kind of its own', () => {
    expect(unitFamilies(['bps', '%', 'bps', undefined, ''])).toEqual(['bps', '%', '']);
    expect(MAX_UNIT_SCALES).toBe(2);
  });
});

describe('the item picker and a third kind of unit', () => {
  beforeEach(() => void vi.spyOn(api, 'items').mockResolvedValue(ITEMS));
  afterEach(() => vi.restoreAllMocks());

  // The picker keeps a host's list for a few minutes, so a test with items of its own names its own host.
  const open = async (selected: string[], hostid = '301') => {
    const onChange = vi.fn();
    render(<ItemPicker hostid={hostid} selected={selected} onChange={onChange} />);
    await screen.findByRole('button', { name: /Ping response time/ });
    return onChange;
  };

  it('adds an item of a kind already on the graph, and of a second kind', async () => {
    const onChange = await open(['1']);
    fireEvent.click(screen.getByRole('button', { name: /Bits sent/ }));
    expect(onChange).toHaveBeenLastCalledWith(['1', '2']);
    fireEvent.click(screen.getByRole('button', { name: /CPU utilisation/ }));
    expect(onChange).toHaveBeenLastCalledWith(['1', '3']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('refuses a third kind with a sentence that names the two it holds, and changes nothing', async () => {
    const onChange = await open(['1', '3']);
    fireEvent.click(screen.getByRole('button', { name: /Ping response time/ }));
    expect(onChange).not.toHaveBeenCalled();
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('A graph shows two kinds of unit at most, and this one already has bps and %.');
    expect(note).toHaveTextContent('Remove one to add Ping response time.');
  });

  it('adds it once the kind that was in the way is removed, and the note goes', async () => {
    const onChange = await open(['1', '3']);
    fireEvent.click(screen.getByRole('button', { name: /Ping response time/ }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bits received' }));
    expect(onChange).toHaveBeenLastCalledWith(['3']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('takes the note away when "Traffic in + out" replaces the whole selection', async () => {
    const withTraffic = [
      { ...item('1', 'Interface Gi1/0/1(uplink): Bits received', 'bps'), key_: 'net.if.in[ifHCInOctets.1]' },
      { ...item('2', 'Interface Gi1/0/1(uplink): Bits sent', 'bps'), key_: 'net.if.out[ifHCOutOctets.1]' },
      item('3', 'CPU utilisation', '%'),
      item('4', 'Ping response time', 's'),
    ];
    vi.spyOn(api, 'items').mockResolvedValue(withTraffic);
    const onChange = await open(['1', '3'], '302');
    fireEvent.click(screen.getByRole('button', { name: /Ping response time/ }));
    expect(screen.getByRole('status')).toHaveTextContent('already has bps and %');
    fireEvent.click(screen.getByRole('button', { name: /Traffic in \+ out/ }));
    expect(onChange).toHaveBeenLastCalledWith(['1', '2']);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('a chart given three kinds of unit by an address', () => {
  it('puts each of the first two on a scale of its own and says that the third is on the first scale', () => {
    render(<TimeSeriesChart series={[seriesOf('1', 'Bits received', 'bps'), seriesOf('3', 'CPU utilisation', '%'), seriesOf('4', 'Ping response time', 's')]} from={AT / 1000 - 3600} to={AT / 1000} />);
    expect(chart.option!.yAxis).toHaveLength(2);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('A graph has two scales at most, one for each kind of unit.');
    expect(note).toHaveTextContent('Ping response time');
    expect(note).not.toHaveTextContent('CPU utilisation');
  });

  it('says nothing for two kinds or fewer', () => {
    render(<TimeSeriesChart series={[seriesOf('1', 'Bits received', 'bps'), seriesOf('3', 'CPU utilisation', '%')]} from={AT / 1000 - 3600} to={AT / 1000} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
