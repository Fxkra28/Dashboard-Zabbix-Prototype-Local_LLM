import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe, useAuth } from '../../shared/hooks/useAuth';
import type { Me } from '../../types';

/**
 * Sign out when the portal does not answer (SC-37). The cookie is cleared only by the request, so a
 * page that went to the sign-in page anyway left the session alive behind it. Now the page stays, says
 * so in words, and lets the person try again.
 */
const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api')>()), logout: logoutMock }));
vi.mock('../assistant/useAi', () => ({ useCapabilities: () => ({ ai: false, writeBack: false, availabilityMinSeverity: 2 }) }));
const { default: Layout } = await import('./Layout');

const me: Me = { authEnabled: true, user: { name: 'olu', role: 'operator' }, expiresIn: 3600 };

function show() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>The dashboard</p>} />
        </Route>
        <Route path="/login" element={<p>Sign in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAuthProbe();
  logoutMock.mockReset();
  vi.spyOn(api, 'me').mockResolvedValue(me);
});
afterEach(() => vi.restoreAllMocks());

const signOutButton = () => screen.findByRole('button', { name: 'Sign out' });

describe('the Sign out button', () => {
  it('goes to the sign-in page once the portal has signed the person out', async () => {
    logoutMock.mockResolvedValue(undefined);
    show();
    fireEvent.click(await signOutButton());
    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays on the page and says the sign-out did not get through, when it did not', async () => {
    logoutMock.mockRejectedValue(new Error('Sign-out failed (HTTP 502).'));
    show();
    fireEvent.click(await signOutButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sign-out did not reach the portal. You are still signed in. Try again.');
    expect(screen.getByText('The dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Sign in page')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('takes the message away as soon as the next try starts, and goes to the sign-in page when that one works', async () => {
    let finish!: () => void;
    logoutMock
      .mockRejectedValueOnce(new Error('Sign-out failed (HTTP 502).'))
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    show();
    fireEvent.click(await signOutButton());
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    // The second try is still out: the old message must not stand beside it.
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
    finish();
    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(2);
  });

  it('shows that it is signing out while the portal has not answered, and cannot be pressed twice', async () => {
    let finish!: () => void;
    logoutMock.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    show();
    fireEvent.click(await signOutButton());
    const waiting = await screen.findByRole('button', { name: 'Signing out...' });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    expect(logoutMock).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
  });

  it('is pressable again, with its own name, when the sign-out failed', async () => {
    logoutMock.mockRejectedValue(new Error('Sign-out failed (HTTP 502).'));
    show();
    fireEvent.click(await signOutButton());
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('leaves the cached answer about who is signed in alone when the sign-out failed', async () => {
    logoutMock.mockRejectedValue(new Error('Sign-out failed (HTTP 502).'));
    show();
    fireEvent.click(await signOutButton());
    await screen.findByRole('alert');
    // A page that asks who is signed in after the failure still gets the answer it had: no second request.
    function Asker() {
      useAuth();
      return null;
    }
    render(<Asker />);
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(1));
    expect(api.me).toHaveBeenCalledTimes(1);
  });
});
