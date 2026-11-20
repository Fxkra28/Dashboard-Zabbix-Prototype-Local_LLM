import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../hooks/useAuth';
import { PageLink } from './PageLink';
import { HostTable, type HostTableRow } from '../../features/hosts/HostTable';
import ProblemsTable from '../../features/problems/ProblemsTable';
import Gauge from '../../features/meters/Gauge';
import { meWith } from '../../__tests__/accounts';
import { meter } from '../../__tests__/meters';
import { problem } from '../../__tests__/problems';
import type { Me } from '../../types';

/**
 * A link to a page the account does not have is not drawn: an account given its own list of pages followed it to "You do not have access" (UX-78). The four old kinds all hold Graphs and
 * Problems, so only a custom account meets this, which is the one these tests are.
 */

const signIn = (me: Me) => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue(me);
};
const inPage = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
/** A link is drawn at once, before the answer to /api/auth/me, and goes when the answer says the page is not the account's: let the answer land first. */
const settle = () => act(async () => undefined);

beforeEach(() => vi.restoreAllMocks());

describe('PageLink', () => {
  it('is a link for an account that has the page, whatever follows the path', async () => {
    signIn(meWith(['hosts', 'graphs']));
    inPage(<PageLink to="/graphs?hostid=1&itemid=2">words</PageLink>);
    expect(await screen.findByRole('link', { name: 'words' })).toHaveAttribute('href', '/graphs?hostid=1&itemid=2');
  });

  it('is the same words as plain text for an account that does not, in the same tag it was given', async () => {
    signIn(meWith(['hosts']));
    inPage(<PageLink to="/graphs?hostid=1" className="kind-tile">words</PageLink>);
    await settle();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('words')).toBeInTheDocument();
  });

  it('is what `fallback` says instead, which for a button is nothing', async () => {
    signIn(meWith(['hosts']));
    inPage(
      <p data-testid="p">
        <PageLink to="/graphs?hostid=1" className="btn" fallback={null}>
          Graph
        </PageLink>
        <PageLink to="/network" fallback={<em>elsewhere</em>}>
          Ports
        </PageLink>
      </p>,
    );
    await settle();
    expect(screen.getByText('elsewhere')).toBeInTheDocument();
    expect(screen.getByTestId('p')).not.toHaveTextContent('Graph');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is a link while the pages are not known, and for a BFF that does not say, as before', async () => {
    signIn({ authEnabled: true, user: { name: 'x', role: 'guest' }, expiresIn: 3600 });
    inPage(<PageLink to="/graphs">words</PageLink>);
    expect(await screen.findByRole('link', { name: 'words' })).toBeInTheDocument();
  });

  it('follows the pages an administrator changes, so that the link comes when the page is given', async () => {
    signIn(meWith(['hosts']));
    const { unmount } = inPage(<PageLink to="/graphs">words</PageLink>);
    await settle();
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    signIn(meWith(['hosts', 'graphs']));
    inPage(<PageLink to="/graphs">words</PageLink>);
    expect(await screen.findByRole('link', { name: 'words' })).toBeInTheDocument();
  });
});

const host = (n: number): HostTableRow => ({
  hostid: String(n),
  name: `Host ${n}`,
  status: '0',
  interfaces: [{ ip: '10.0.0.1', type: '2' }],
  problems: { total: 0, bySeverity: {} },
  state: 'up',
});

describe('the pages that link to Graphs, for a guest with Hosts and no Graphs', () => {
  it('has no Graphs button on the host table, and the name stays', async () => {
    signIn(meWith(['hosts']));
    inPage(<HostTable hosts={[host(1), host(2)]} />);
    await settle();
    expect(screen.getByText('Host 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Graphs' })).toBeNull();
  });

  it('has the button, to the host, when Graphs is on the account', async () => {
    signIn(meWith(['hosts', 'graphs']));
    inPage(<HostTable hosts={[host(1)]} />);
    expect(await screen.findByRole('link', { name: 'Graphs' })).toHaveAttribute('href', '/graphs?hostid=1');
  });

  it('keeps Ports for an account that has Network and drops Graphs for one that has not', async () => {
    signIn(meWith(['devices', 'network']));
    inPage(<HostTable hosts={[host(1)]} portsLink />);
    await settle();
    expect(screen.getByRole('link', { name: 'Ports' })).toHaveAttribute('href', '/network?hostid=1');
    expect(screen.queryByRole('link', { name: 'Graphs' })).toBeNull();
  });

  it('has the host of a problem as text on the Dashboard’s list, and the problem too when the account has no Problems page', async () => {
    signIn(meWith(['dashboard']));
    inPage(<ProblemsTable problems={[problem(1, 4, 60)]} />);
    await settle();
    const row = screen.getByText('Problem 1').closest('tr') as HTMLElement;
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).getByText('host-1')).toBeInTheDocument();
  });

  it('links the problem and its host when the account has both pages', async () => {
    signIn(meWith(['dashboard', 'problems', 'graphs']));
    inPage(<ProblemsTable problems={[problem(1, 4, 60)]} />);
    const row = (await screen.findByText('Problem 1')).closest('tr') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Problem 1' })).toHaveAttribute('href', '/problems?eventid=1');
    expect(within(row).getByRole('link', { name: 'host-1' })).toHaveAttribute('href', '/graphs?hostid=10001');
  });

  it('has the title of an internet meter as text, and no note about a link that is not there', async () => {
    signIn(meWith(['dashboard', 'network']));
    inPage(<Gauge meter={meter()} now={1_800_000_000_000} />);
    await settle();
    expect(screen.getByText('SITE ONE INTERNET')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/Opens the history of this link in Graphs/)).toBeNull();
  });

  it('links the title of a meter, with its note, when Graphs is on the account', async () => {
    signIn(meWith(['dashboard', 'network', 'graphs']));
    inPage(<Gauge meter={meter()} now={1_800_000_000_000} />);
    const link = await screen.findByRole('link', { name: 'SITE ONE INTERNET' });
    expect(link).toHaveAccessibleDescription('Opens the history of this link in Graphs');
  });
});
