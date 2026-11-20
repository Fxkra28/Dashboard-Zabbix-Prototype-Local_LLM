import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';

/** After a link in the content, or Back, focus is not left on a control that has gone with the old page (UX-80). */
vi.mock('../assistant/useAi', () => ({ useCapabilities: () => ({ ai: false, writeBack: false, availabilityMinSeverity: 2 }) }));
const { default: Layout } = await import('./Layout');

beforeEach(() => {
  resetAuthProbe();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: false, user: null, expiresIn: null } as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Dashboard() {
  const go = useNavigate();
  return (
    <>
      <p>The dashboard</p>
      <Link to="/problems">View all problems</Link>
      <button type="button" onClick={() => go('/?q=1')}>Filter</button>
    </>
  );
}
function Problems() {
  const go = useNavigate();
  return (
    <>
      <p>The problems</p>
      <button type="button" onClick={() => go(-1)}>Back</button>
    </>
  );
}

function show(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/problems" element={<Problems />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
const main = () => document.getElementById('main');

describe('focus on a change of page (UX-80)', () => {
  it('leaves focus alone when the first page opens, so that the first Tab is the skip link', async () => {
    show();
    await screen.findByText('The dashboard');
    expect(document.activeElement).toBe(document.body);
  });

  // A person whose pages do not include the dashboard lands on `/` and is sent to their first page: that is the first page opening, not a move they made.
  it('leaves focus alone when the first page is a redirect to the first page the person has', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'ana', role: 'guest' }, expiresIn: 3600, pages: { '/problems': 'guest' }, modules: ['problems'] } as never);
    show();
    expect(await screen.findByText('The problems')).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the main area after a link in the content, so that the next Tab starts in the new page', async () => {
    show();
    await userEvent.setup().click(await screen.findByRole('link', { name: 'View all problems' }));
    expect(await screen.findByText('The problems')).toBeInTheDocument();
    expect(document.activeElement).toBe(main());
  });

  it('moves it again on Back', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('link', { name: 'View all problems' }));
    await screen.findByText('The problems');
    (document.activeElement as HTMLElement).blur();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('The dashboard')).toBeInTheDocument();
    expect(document.activeElement).toBe(main());
  });

  it('does not move it for a change of the query on the same page, which a filter makes on every key', async () => {
    show();
    const filter = await screen.findByRole('button', { name: 'Filter' });
    filter.focus();
    await userEvent.setup().click(filter);
    expect(document.activeElement).toBe(filter);
  });

  it('gives the tab stop back once the person moves on, as the skip link does', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('link', { name: 'View all problems' }));
    await screen.findByText('The problems');
    expect(main()).toHaveAttribute('tabindex', '-1');
    await act(async () => (document.activeElement as HTMLElement).blur());
    expect(main()).not.toHaveAttribute('tabindex');
  });
});
