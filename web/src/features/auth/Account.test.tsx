import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Account from './Account';
import type { Me } from '../../types';

/** The Account page: who is signed in, and the form for the password only for an account the portal can change (FR-73). */

const answer = (over: Partial<Me> = {}): Me => ({
  authEnabled: true,
  user: { name: 'budi.santoso', role: 'guest', displayName: 'Budi Santoso', source: 'file' },
  expiresIn: 3600,
  pages: { '/problems': 'guest', '/sla': 'guest' },
  modules: ['problems', 'sla'],
  ...over,
});

beforeEach(() => {
  resetAuthProbe();
  vi.restoreAllMocks();
});

describe('the Account page', () => {
  it('names the person by the name they go by, with their sign-in name, role and number of pages', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    render(<Account />);
    expect(await screen.findByRole('heading', { name: 'Budi Santoso' })).toBeInTheDocument();
    expect(screen.getByText(/Signed in as budi\.santoso/)).toHaveTextContent('role guest · 2 pages');
  });

  it('says 1 page for a person with one page', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer({ pages: { '/sla': 'guest' }, modules: ['sla'] }));
    render(<Account />);
    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('role guest · 1 page');
    expect(screen.queryByText(/1 pages/)).toBeNull();
  });

  it('offers the form for the password to an account kept in the portal’s own file', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer());
    render(<Account />);
    expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });

  it('says where the password of the first administrator is changed, and offers no form that would be refused', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer({ user: { name: 'root', role: 'admin', displayName: 'root', source: 'env' } }));
    render(<Account />);
    expect(await screen.findByText(/kept in the portal’s/)).toHaveTextContent('its password is changed there and not on this page');
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
  });

  it('keeps the form for a BFF that does not say where an account is kept, as before', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer({ user: { name: 'budi.santoso', role: 'guest' } }));
    render(<Account />);
    expect(await screen.findByLabelText('Current password')).toBeInTheDocument();
  });
});
