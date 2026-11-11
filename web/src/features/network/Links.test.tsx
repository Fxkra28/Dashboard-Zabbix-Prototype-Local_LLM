import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import type { Link, LinksResponse } from '../../types';
import Links from './Links';

/**
 * Link & WAN health: the count of each state, the table with trouble first, the filter, and the three other states a
 * data page has (loading, empty, failed). Every host and address here is made up (FR-30).
 */

const link = (over: Partial<Link> & Pick<Link, 'id' | 'state'>): Link => ({
  hostid: `h-${over.id}`,
  host: `host-${over.id}`,
  target: `10.0.0.${over.id}`,
  label: `Link ${over.id}`,
  ...over,
});

const response = (links: Link[]): LinksResponse => ({
  links,
  paths: [],
  summary: {
    total: links.length,
    up: links.filter((l) => l.state === 'up').length,
    degraded: links.filter((l) => l.state === 'degraded').length,
    down: links.filter((l) => l.state === 'down').length,
    unknown: links.filter((l) => l.state === 'unknown').length,
  },
  thresholds: { lossWarn: 2, lossCrit: 10 },
});

// In the order the server would send them, which is not the order the page shows.
const FOUR: Link[] = [
  link({ id: '1', state: 'up', label: 'Jakarta main' }),
  link({ id: '2', state: 'unknown', label: 'Madura radio' }),
  link({ id: '3', state: 'down', label: 'Sapudi SD-WAN', loss: 100 }),
  link({ id: '4', state: 'degraded', label: 'Bali backup', loss: 4 }),
];

let read: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  read = vi.spyOn(api, 'links').mockResolvedValue(response(FOUR));
});
afterEach(() => vi.restoreAllMocks());

const page = () =>
  render(
    <MemoryRouter initialEntries={['/links']}>
      <Links />
    </MemoryRouter>,
  );

/** The first cell of each body row: the state pill's words. */
const states = async () => {
  const table = await screen.findByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]!.textContent!.trim());
};

describe('the page when the read works', () => {
  it('says how many links are in each state, and the loss thresholds', async () => {
    page();
    expect(await screen.findAllByText('of 4 links')).toHaveLength(4);
    expect(screen.getByText(/loss warn ≥ 2% · down ≥ 10%/)).toBeInTheDocument();
  });

  it('lists trouble first: down, then degraded, then up, and links with no data last', async () => {
    page();
    expect(await states()).toEqual(['Down', 'Degraded', 'Up', 'No data']);
  });

  it('shows only the links that are down or degraded under "Not healthy only"', async () => {
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('checkbox', { name: 'Not healthy only' }));
    expect(await states()).toEqual(['Down', 'Degraded']);
  });

  it('narrows the list by link, host or target as the person types', async () => {
    const user = userEvent.setup();
    page();
    await user.type(await screen.findByLabelText('Search link'), 'sapudi');
    await waitFor(async () => expect(await states()).toEqual(['Down']));
  });

  it('says that no links match when the filter hides every one', async () => {
    const user = userEvent.setup();
    page();
    await user.type(await screen.findByLabelText('Search link'), 'no such link');
    expect(await screen.findByText('No links match the filter.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the other states of the page', () => {
  it('says so while it reads', async () => {
    read.mockReturnValue(new Promise(() => undefined));
    page();
    expect(await screen.findByText(/Reading link health/)).toBeInTheDocument();
  });

  it('says that no ICMP-monitored links were found, and where they come from, when the list is empty', async () => {
    read.mockResolvedValue(response([]));
    page();
    expect(await screen.findByText(/No ICMP-monitored links found/)).toBeInTheDocument();
    expect(screen.getByText(/icmppingloss/)).toBeInTheDocument();
  });

  it('says what went wrong when the read fails', async () => {
    read.mockRejectedValue(new Error('The portal could not read the link health.'));
    page();
    expect(await screen.findByText(/The portal could not read the link health/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
