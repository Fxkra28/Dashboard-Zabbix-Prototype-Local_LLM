import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Maps from './Maps';
import type { MapDetail, MapSelement, ZMap } from '../../types';
import { stylesheet } from '../../__tests__/stylesheet';

const maps: ZMap[] = [
  { sysmapid: '1', name: 'Core', width: '800', height: '400' },
  { sysmapid: '2', name: 'Branches', width: '800', height: '400' },
];

const el = (id: string, x: number, name: string, extra: Partial<MapSelement> = {}): MapSelement => ({
  selementid: id,
  label: name,
  labelText: name,
  x: String(x),
  y: '100',
  elementtype: '0',
  hostid: id,
  problems: 0,
  ...extra,
});

const detail = (sysmapid: string, selements: MapSelement[]): MapDetail[] => [
  { ...maps.find((m) => m.sysmapid === sysmapid)!, selements, links: [] },
];

function open(url: string, selements: MapSelement[] = [el('a', 0, 'SW-A')]) {
  window.history.replaceState(null, '', url);
  vi.spyOn(api, 'maps').mockResolvedValue(maps);
  vi.spyOn(api, 'mapDetail').mockImplementation(async (id: string) => detail(id, selements));
  return render(
    <BrowserRouter>
      <Maps />
    </BrowserRouter>,
  );
}
const query = () => new URLSearchParams(window.location.search);
const nameText = (text: string) => screen.getByText(text, { selector: 'text' });

beforeEach(() => window.history.replaceState(null, '', '/maps'));
afterEach(() => vi.restoreAllMocks());

describe('the chosen map is in the URL (FR-18)', () => {
  it('shows the first map when the URL names none, without writing one', async () => {
    open('/maps');
    await waitFor(() => expect(api.mapDetail).toHaveBeenCalledWith('1'));
    expect(screen.getByLabelText('Map')).toHaveValue('1');
    expect(query().has('map')).toBe(false);
  });

  it('shows the map the URL names', async () => {
    open('/maps?map=2');
    await waitFor(() => expect(api.mapDetail).toHaveBeenCalledWith('2'));
    expect(screen.getByLabelText('Map')).toHaveValue('2');
    expect(api.mapDetail).not.toHaveBeenCalledWith('1');
  });

  it('puts a map picked from the list in the URL', async () => {
    const user = userEvent.setup();
    open('/maps');
    await screen.findByRole('option', { name: 'Branches' });
    await user.selectOptions(screen.getByLabelText('Map'), '2');
    expect(query().get('map')).toBe('2');
    await waitFor(() => expect(api.mapDetail).toHaveBeenCalledWith('2'));
  });

  it('reads an id that is not in the list as the first map', async () => {
    open('/maps?map=99');
    await waitFor(() => expect(api.mapDetail).toHaveBeenCalledWith('1'));
    expect(screen.getByLabelText('Map')).toHaveValue('1');
  });
});

describe('map names that would overlap (FR-18)', () => {
  const long = (s: string) => `${s}-LONG-DEVICE-NAME`;

  it('moves a name that would sit on its neighbour, and still draws both', async () => {
    open('/maps', [el('a', 0, long('A')), el('b', 100, long('B'))]);
    const a = await screen.findByText(long('A'), { selector: 'text' });
    const b = nameText(long('B'));
    // The elements are 100 px apart, so at one height the two names would overlap and the second moves. y is relative to the element.
    expect(a.getAttribute('y')).toBe('46');
    expect(b.getAttribute('y')).not.toBe('46');
    expect(screen.queryByText(/left out where crowded/)).toBeNull();
  });

  it('draws a lone name where it always was', async () => {
    open('/maps', [el('a', 0, 'SW-A')]);
    expect((await screen.findByText('SW-A', { selector: 'text' })).getAttribute('y')).toBe('46');
  });

  it('says how many names it left out when the map is too dense, and which, so no one has to point', async () => {
    const crowd = Array.from({ length: 10 }, (_, i) => el(`e${i}`, 100 + i * 4, `HOST-${i}-LONG-DEVICE-NAME`));
    const { container } = open('/maps', crowd);
    const caption = (await screen.findByText(/names? left out where crowded/)).textContent ?? '';
    const drawn = [...container.querySelectorAll('svg g text')].map((t) => t.textContent);
    expect(drawn.length).toBeLessThan(crowd.length);
    const left = crowd.map((e) => e.label).filter((name) => !drawn.includes(name));
    expect(left.length).toBe(crowd.length - drawn.length);
    expect(caption).toContain(`${left.length} names left out where crowded: ${left.join(', ')}`);
    for (const name of drawn) expect(caption).not.toContain(name ?? '');
    expect(caption).not.toMatch(/point at/);
    // Every element still says what it is when pointed at.
    expect([...container.querySelectorAll('svg title')].map((t) => t.textContent)).toEqual(
      crowd.map((e) => expect.stringContaining(e.label)),
    );
  });

  it('names every element for a screen reader, the ones left out of the drawing too', async () => {
    const crowd = Array.from({ length: 10 }, (_, i) =>
      el(`e${i}`, 100 + i * 4, `HOST-${i}-LONG-DEVICE-NAME`, i === 3 ? { problems: 2, maxSeverity: 4 } : {}),
    );
    const { container } = open('/maps', crowd);
    await screen.findByText(/names? left out where crowded/);
    const drawn = [...container.querySelectorAll('svg g text')].map((t) => t.textContent);
    const left = crowd.filter((e) => !drawn.includes(e.label));
    expect(left.length).toBeGreaterThan(0);
    // A host is a button now (UX-38): it names itself the same way.
    expect(screen.getAllByRole('button', { name: /^HOST-/ })).toHaveLength(crowd.length);
    for (const e of left) expect(screen.getByRole('button', { name: new RegExp(`^${e.label}`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HOST-3-LONG-DEVICE-NAME, 2 open problems, worst: High' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HOST-0-LONG-DEVICE-NAME, no open problems' })).toBeInTheDocument();
  });
});

describe('the caption', () => {
  it('says where the map comes from in plain words, without the API call', async () => {
    open('/maps');
    expect(await screen.findByText(/drawn from the Zabbix map/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('map.get');
  });
});

describe('a host on the map says its severity in words when chosen (UX-38)', () => {
  const hosts = [
    el('a', 0, 'SW-A', { problems: 3, maxSeverity: 5 }),
    el('b', 120, 'SW-B', { problems: 1, maxSeverity: 2 }),
    el('c', 240, 'SW-C', { problems: 0 }),
    el('d', 360, 'Core map', { elementtype: '1', hostid: undefined }),
  ];
  const node = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
  const line = () => document.querySelector('.map-selected');

  it('prints the worst severity as text under the map, beside the colour', async () => {
    const user = userEvent.setup();
    open('/maps', hosts);
    await user.click(await waitFor(() => node('SW-A')));
    expect(line()).toHaveTextContent(/^SW-A: 3 open problems, worst: ● Disaster$/);
    expect(node('SW-A')).toHaveAttribute('aria-pressed', 'true');
  });

  it('says so for a host with one problem and for a host with none', async () => {
    const user = userEvent.setup();
    open('/maps', hosts);
    await user.click(await waitFor(() => node('SW-B')));
    expect(line()).toHaveTextContent(/^SW-B: 1 open problem, worst: ● Warning$/);
    await user.click(node('SW-C'));
    expect(line()).toHaveTextContent('SW-C: no open problems');
    expect(node('SW-B')).toHaveAttribute('aria-pressed', 'false');
  });

  it('works from the keyboard, and a second press clears it', async () => {
    const user = userEvent.setup();
    open('/maps', hosts);
    const a = await waitFor(() => node('SW-A'));
    a.focus();
    await user.keyboard('{Enter}');
    expect(line()).toHaveTextContent(/worst: ● Disaster$/);
    await user.keyboard(' ');
    expect(line()).toBeNull();
  });

  it('leaves an element that is not a host as a picture, with no button to press', async () => {
    open('/maps', hosts);
    await waitFor(() => node('SW-A'));
    expect(screen.queryByRole('button', { name: /^Core map/ })).toBeNull();
    expect(screen.getByRole('img', { name: /^Core map/ })).toBeInTheDocument();
  });

  it('forgets the choice when another map is shown', async () => {
    const user = userEvent.setup();
    open('/maps', hosts);
    await user.click(await waitFor(() => node('SW-A')));
    await user.selectOptions(screen.getByLabelText('Map'), '2');
    await waitFor(() => expect(line()).toBeNull());
  });
});

describe('a host node that is pressed, or that the keyboard is on, shows it on the node itself (UX-38)', () => {
  // A host with problems already has a heavier outline for its problems, so only a heavier one still says "this one".
  it('draws both with a heavier outline than a host with problems has', () => {
    const rule = /\.map-node\[aria-pressed='true'\] rect,\s*\.map-node:focus-visible rect\s*\{([^}]*)\}/.exec(stylesheet);
    expect(rule, 'the rule for a pressed or focused node').not.toBeNull();
    expect(rule![1]).toMatch(/stroke-width:\s*4px/);
  });
});

describe('a map that could not be loaded (UX-40)', () => {
  it('is told to a screen reader, as an alert with the heading every blocking error has, and says which map failed', async () => {
    window.history.replaceState(null, '', '/maps?map=1');
    vi.spyOn(api, 'maps').mockResolvedValue(maps);
    vi.spyOn(api, 'mapDetail').mockRejectedValue(new Error('The data source is not answering. Tell an administrator and quote reference abc123.'));
    render(
      <BrowserRouter>
        <Maps />
      </BrowserRouter>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load data');
    expect(alert).toHaveTextContent('Could not load this map: The data source is not answering.');
  });
});

