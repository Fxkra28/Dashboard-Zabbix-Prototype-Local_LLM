import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppRoutes } from '../App';
import Layout, { titleFor } from '../features/shell/Layout';
import { APP_TITLE, usePageTitle } from '../features/shell/usePageTitle';

const Where = () => <output data-testid="where">{useLocation().pathname}</output>;

/** The routes at an address. Nothing answers fetch, so a page that mounts just waits. */
const open = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  document.title = APP_TITLE;
  vi.stubGlobal('fetch', () => new Promise(() => undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('an address that is not a page (FR-06)', () => {
  it('says so, with a way home, and stays on the address', async () => {
    open('/no-such-page');
    expect(await screen.findByText(/does not match a page/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
    expect(screen.getByTestId('where')).toHaveTextContent('/no-such-page');
  });

  it('keeps the sidebar, so the way to a real page stays one click away', async () => {
    open('/no-such-page');
    await screen.findByText(/does not match a page/);
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('names the browser tab for it', async () => {
    open('/no-such-page');
    await screen.findByText(/does not match a page/);
    expect(document.title).toBe(`Page not found · ${APP_TITLE}`);
  });
});

describe('the way past the menu (UX-10)', () => {
  it('puts a skip link before the sidebar, and it moves focus to the main landmark', async () => {
    open('/no-such-page');
    await screen.findByText(/does not match a page/);
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main');
    // First in the document, so the first Tab stop.
    expect(skip.compareDocumentPosition(screen.getByRole('complementary')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    fireEvent.click(skip);
    expect(main).toHaveFocus();
  });

  it('has no skip link on a wall, which has no menu to skip, and keeps it everywhere else', () => {
    const inLayout = (url: string) =>
      render(
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<p>Page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    const { unmount } = inLayout('/?wall=1');
    expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
    unmount();
    inLayout('/');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
  });
});

describe('the browser tab title (FR-06)', () => {
  it('follows the page, in the portal name', async () => {
    open('/links');
    await screen.findByRole('heading', { level: 1, name: 'Links & WAN health' });
    expect(document.title).toBe(`Links & WAN health · ${APP_TITLE}`);
  });

  it('still finds the page when the address has another case or a trailing slash', async () => {
    open('/Reports/Noise/');
    await screen.findByRole('heading', { level: 1, name: 'Alert noise' });
    expect(document.title).toBe(`Alert noise · ${APP_TITLE}`);
  });

  it('goes back to the plain name when the shell is left', () => {
    const { unmount } = renderHook(() => usePageTitle('Problems'));
    expect(document.title).toBe(`Problems · ${APP_TITLE}`);
    unmount();
    expect(document.title).toBe(APP_TITLE);
  });
});

describe('titleFor', () => {
  it('gives the menu label of each page and null for anything else', () => {
    expect(titleFor('/')).toBe('Dashboard');
    expect(titleFor('/problems')).toBe('Problems');
    expect(titleFor('/reports/top-triggers')).toBe('Top 100 triggers');
    expect(titleFor('/problems/')).toBe('Problems');
    expect(titleFor('/PROBLEMS')).toBe('Problems');
    expect(titleFor('/problem')).toBeNull();
    expect(titleFor('/reports')).toBeNull();
    expect(titleFor('/problems/1')).toBeNull();
  });
});

describe('the date in the topbar (FR-08)', () => {
  it('turns over at midnight on a tab that stays open', () => {
    vi.useFakeTimers();
    // Half a minute before midnight in the report zone (Jakarta), whatever zone this machine is set to (FR-24).
    vi.setSystemTime(new Date('2026-10-07T23:59:30+07:00'));
    const jakartaDay = (day: string) => new Date(`2026-10-${day}T12:00:00+07:00`).toLocaleDateString(undefined, { timeZone: 'Asia/Jakarta' });
    // A page with nothing in it: only the shell is under test.
    render(
      <MemoryRouter initialEntries={['/links']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const topbar = screen.getByRole('banner');
    expect(topbar).toHaveTextContent(jakartaDay('07'));

    act(() => void vi.advanceTimersByTime(60_000));
    expect(topbar).toHaveTextContent(jakartaDay('08'));
    expect(topbar).not.toHaveTextContent(jakartaDay('07'));
  });
});
