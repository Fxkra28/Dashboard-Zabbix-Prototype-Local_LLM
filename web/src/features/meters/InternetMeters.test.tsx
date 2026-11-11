import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import InternetMeters from './InternetMeters';
import { useMeters } from './useMeters';
import { meter, response, without } from '../../__tests__/meters';

/** The Internet traffic section: what it asks for, and what it says when the dashboard answers well, badly or not at all. */

afterEach(() => vi.restoreAllMocks());

/** The Dashboard holds the request (useMeters.ts) and hands it to the section; so does this. */
function Held({ page }: { page?: { index: number; pages: number } }) {
  return <InternetMeters q={useMeters(true)} page={page} />;
}
const show = (page?: { index: number; pages: number }) =>
  render(
    <MemoryRouter>
      <Held page={page} />
    </MemoryRouter>,
  );

const items = () => screen.getAllByRole('listitem');

describe('InternetMeters', () => {
  it('names itself, and says it is loading until the meters come', () => {
    vi.spyOn(api, 'netMeters').mockReturnValue(new Promise(() => undefined));
    show();
    expect(screen.getByRole('heading', { name: 'Internet traffic' })).toBeInTheDocument();
    expect(screen.getByText('Loading the meters…')).toBeInTheDocument();
  });

  it('shows one gauge for each meter, in the order given, with a sentence about them all', async () => {
    vi.spyOn(api, 'netMeters').mockResolvedValue(
      response([
        meter(),
        meter({ id: 'item-2', title: 'SITE TWO INTERNET 1', zone: 'critical', value: 45_320_000, max: 50_000_000, fraction: 0.9064 }),
        meter({ id: 'item-3', title: 'SITE THREE INTERNET 1', state: 'stale', clock: 1_700_000_000 }),
        without('missing', { id: 'title-sapudi', title: 'SITE FOUR INTERNET 2', max: null, itemid: null }),
      ]),
    );
    show();

    expect(await screen.findByRole('list')).toBeInTheDocument();
    expect(items().map((li) => within(li).getByText(/INTERNET/).textContent)).toEqual([
      'SITE ONE INTERNET',
      'SITE TWO INTERNET 1',
      'SITE THREE INTERNET 1',
      'SITE FOUR INTERNET 2',
    ]);
    expect(screen.getByText('4 links. 1 critical. 1 with an old reading. 1 without a gauge.')).toBeInTheDocument();
  });

  it('says when it was updated, as the Live problems panel does', async () => {
    vi.spyOn(api, 'netMeters').mockResolvedValue(response([meter()]));
    show();
    expect(await screen.findByText(/^Updated \d\d:\d\d:\d\d WIB$/)).toBeInTheDocument();
  });

  it('asks the BFF once, for the meters, and nothing else', async () => {
    const spy = vi.spyOn(api, 'netMeters').mockResolvedValue(response([meter()]));
    show();
    await screen.findByRole('list');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('says what to set when Zabbix has no dashboard of that name', async () => {
    vi.spyOn(api, 'netMeters').mockResolvedValue(response([], { found: false, dashboard: 'Global view' }));
    show();
    expect(await screen.findByText(/no dashboard named “Global view”/)).toBeInTheDocument();
    expect(screen.getByText(/INTERNET_METERS_DASHBOARD/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says so when the dashboard has no gauge widgets', async () => {
    vi.spyOn(api, 'netMeters').mockResolvedValue(response([]));
    show();
    expect(await screen.findByText('The dashboard “Global view” has no gauge widgets.')).toBeInTheDocument();
    expect(screen.queryByText(/^No links/)).toBeNull();
  });

  it('shows the failure, like every other panel, when the BFF cannot answer', async () => {
    vi.spyOn(api, 'netMeters').mockRejectedValue(new Error('The data source is not answering. Tell an administrator and quote reference abc123.'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('The data source is not answering.');
    expect(screen.getByText('Couldn’t load data')).toBeInTheDocument();
  });

  it('holds a page of the meters on a wall slide, and says which, while the sentence still counts them all', async () => {
    const many = Array.from({ length: 5 }, (_, i) => meter({ id: `item-${i}`, title: `SITE ${i + 1} INTERNET` }));
    vi.spyOn(api, 'netMeters').mockResolvedValue(response(many));
    show({ index: 1, pages: 2 });
    await screen.findByRole('list');
    expect(items().map((li) => within(li).getByText(/INTERNET/).textContent)).toEqual(['SITE 4 INTERNET', 'SITE 5 INTERNET']);
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('5 links. None high or critical.')).toBeInTheDocument();
  });

  it('shows every meter and no page marker without a page, and no marker for a wall that needs one page', async () => {
    const many = Array.from({ length: 5 }, (_, i) => meter({ id: `item-${i}`, title: `SITE ${i + 1} INTERNET` }));
    vi.spyOn(api, 'netMeters').mockResolvedValue(response(many));
    const { unmount } = show();
    await screen.findByRole('list');
    expect(items()).toHaveLength(5);
    expect(screen.queryByText(/^Page \d/)).toBeNull();
    unmount();
    show({ index: 0, pages: 1 });
    await screen.findByRole('list');
    expect(items()).toHaveLength(5);
    expect(screen.queryByText(/^Page \d/)).toBeNull();
  });
});
