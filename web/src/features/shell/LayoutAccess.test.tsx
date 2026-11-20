import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import type { Me } from '../../types';

/** What the shell does with a page the signed-in user does not have, and with a temporary password (ADR-0017). */
vi.mock('../assistant/useAi', () => ({ useCapabilities: () => ({ ai: false, writeBack: false, availabilityMinSeverity: 2 }) }));
const { default: Layout } = await import('./Layout');

const answer = (over: Partial<Me> = {}): Me => ({
  authEnabled: true,
  user: { name: 'budi.santoso', role: 'guest', displayName: 'Budi' },
  expiresIn: 3600,
  pages: { '/problems': 'guest', '/sla': 'guest' },
  modules: ['problems', 'sla'],
  ...over,
});

beforeEach(() => {
  resetAuthProbe();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<p>The dashboard</p>} />
          <Route path="/problems" element={<p>The problems</p>} />
          <Route path="/network" element={<p>The network</p>} />
          <Route path="/users" element={<p>The users</p>} />
          <Route path="/account" element={<p>The account</p>} />
          <Route path="/somewhere-else" element={<p>Not a page of the menu</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('a page the user does not have', () => {
  it('shows what they asked for when they have it', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    show('/problems');
    expect(await screen.findByText('The problems')).toBeInTheDocument();
  });

  it('says so, with a way to a page they do have, instead of drawing a page of refusals', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    show('/network');
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to Network.');
    expect(screen.queryByText('The network')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Problems' })).toHaveAttribute('href', '/problems');
    expect(screen.getByText(/Ask one to add this page to your account/)).toBeInTheDocument();
  });

  it('keeps the Users page from anyone who is not an administrator, though they can type its address', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    show('/users');
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to Users and access.');
  });

  it('sends a user without the Dashboard from its address to the first page they have', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    show('/');
    expect(await screen.findByText('The problems')).toBeInTheDocument();
    expect(screen.queryByText('The dashboard')).toBeNull();
  });

  it('leaves an address that is not a page of the menu alone, and a BFF that sends no pages, which still refuses what it must', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    const { unmount } = show('/somewhere-else');
    expect(await screen.findByText('Not a page of the menu')).toBeInTheDocument();
    unmount();
    resetAuthProbe();
    vi.mocked(api.me).mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'guest' }, expiresIn: 3600 });
    show('/network');
    expect(await screen.findByText('The network')).toBeInTheDocument();
  });

  it('offers an administrator every page of the menu, the Users page too', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer({ user: { name: 'root', role: 'admin' }, pages: { '/users': 'admin', '/': 'guest' }, modules: ['users', 'dashboard'] }));
    show('/users');
    expect(await screen.findByText('The users')).toBeInTheDocument();
  });
});

describe('a temporary password', () => {
  it('opens nothing but the form for a new one, whatever page was asked for, and offers sign-out and an account link', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer({ mustChange: true }));
    show('/problems');
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.queryByText('The problems')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('gives a user with a password of their own the page they asked for', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer({ mustChange: false }));
    show('/problems');
    expect(await screen.findByText('The problems')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Choose a new password' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
  });
});

describe('after the new password is chosen', () => {
  it('lets the person in at once, with no reload: the shell asks who is signed in again', async () => {
    vi.spyOn(api, 'me').mockResolvedValueOnce(answer({ mustChange: true })).mockResolvedValue(answer({ mustChange: false }));
    vi.spyOn(api, 'changePassword').mockResolvedValue({ ok: true, user: { name: 'budi.santoso', role: 'guest' }, expiresIn: 43_200 });
    const typing = userEvent.setup();
    show('/problems');
    await typing.type(await screen.findByLabelText('Current password'), 'the-temporary-one');
    await typing.type(screen.getByLabelText('New password', { selector: 'input[name="new"]' }), 'a-brand-new-password');
    await typing.type(screen.getByLabelText('New password again'), 'a-brand-new-password');
    await typing.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The problems')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Choose a new password' })).toBeNull();
  });

  // UX-71: the form is swapped for the page in the render that follows the answer, so the words and the focus are the shell's.
  it('says in words that the password was changed, in a place that is announced, and puts the focus in the page', async () => {
    vi.spyOn(api, 'me').mockResolvedValueOnce(answer({ mustChange: true })).mockResolvedValue(answer({ mustChange: false }));
    vi.spyOn(api, 'changePassword').mockResolvedValue({ ok: true, user: { name: 'budi.santoso', role: 'guest' }, expiresIn: 43_200 });
    const typing = userEvent.setup();
    show('/problems');
    await typing.type(await screen.findByLabelText('Current password'), 'the-temporary-one');
    await typing.type(screen.getByLabelText('New password', { selector: 'input[name="new"]' }), 'a-brand-new-password');
    await typing.type(screen.getByLabelText('New password again'), 'a-brand-new-password');
    await typing.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByText('The problems');
    const notice = await screen.findByText('Your password was changed.');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('says nothing of a change that was never made, for a person who signs in with a password of their own', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer({ mustChange: false }));
    show('/problems');
    await screen.findByText('The problems');
    expect(screen.queryByText('Your password was changed.')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('the account page', () => {
  it('is titled Account in the top bar, and is not taken for a page the user lacks or for one that does not exist', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    show('/account');
    expect(await screen.findByText('The account')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// FR-70: an administrator changes the pages of a person whose page is open.
describe('a change of the pages while the page is open', () => {
  const wider = answer({ pages: { '/problems': 'guest', '/sla': 'guest', '/network': 'guest' }, modules: ['problems', 'sla', 'network'] });

  it('shows the page the person has just been given, when the tab is shown again, without a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const me = vi.spyOn(api, 'me').mockResolvedValueOnce(answer()).mockResolvedValue(wider);
    show('/network');
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to Network.');
    vi.advanceTimersByTime(61_000);
    await act(async () => void window.dispatchEvent(new Event('focus')));
    expect(await screen.findByText('The network')).toBeInTheDocument();
    expect(screen.queryByText(/You do not have access/)).toBeNull();
    expect(me).toHaveBeenCalledTimes(2);
  });

  it('takes a page out of the menu and shows the notice when it is taken away, instead of refusals', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.spyOn(api, 'me').mockResolvedValueOnce(wider).mockResolvedValue(answer());
    show('/network');
    expect(await screen.findByText('The network')).toBeInTheDocument();
    vi.advanceTimersByTime(61_000);
    await act(async () => void window.dispatchEvent(new Event('focus')));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to Network.');
    expect(screen.queryByText('The network')).toBeNull();
  });

  it('has a Check again button on the notice, which opens the page once it has been added', async () => {
    const me = vi.spyOn(api, 'me').mockResolvedValueOnce(answer()).mockResolvedValue(wider);
    show('/network');
    await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('The network')).toBeInTheDocument();
    expect(me).toHaveBeenCalledTimes(2);
  });

  it('moves the focus to the page when it opens, since the button that was pressed has gone with the notice (FR-70)', async () => {
    vi.spyOn(api, 'me').mockResolvedValueOnce(answer()).mockResolvedValue(wider);
    show('/network');
    await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('The network')).toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('says that the pages changed, and does not claim to know about this one, when other pages were added and not this', async () => {
    vi.spyOn(api, 'me').mockResolvedValueOnce(answer()).mockResolvedValue(answer({ pages: { '/problems': 'guest', '/sla': 'guest', '/graphs': 'guest' }, modules: ['problems', 'sla', 'graphs'] }));
    show('/network');
    await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Your pages have changed\. If this page is still not on your account, ask an administrator to add it\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  // An alert is read again, whole, whenever anything inside it changes: the answer of Check again belongs beside it, not in it.
  it('keeps the alert to the sentence that says what is wrong, and the answer of Check again outside it', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    show('/network');
    const alert = await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    const status = await screen.findByText(/Nothing has changed/);
    expect(alert).toHaveTextContent(/^You do not have access to Network\.$/);
    expect(alert).not.toContainElement(status);
    expect(status.closest('[role="status"]')).not.toBeNull();
  });

  it('says that nothing has changed when it has not, and keeps the notice and the button', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    show('/network');
    await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Nothing has changed: this page is still not on your account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('says that the portal did not answer when it did not', async () => {
    vi.spyOn(api, 'me').mockResolvedValueOnce(answer()).mockRejectedValue(new Error('502'));
    show('/network');
    await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/The portal did not answer/)).toBeInTheDocument();
  });
});
