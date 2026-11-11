import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import LatestData from './LatestData';

/** Latest data picks the first host when it opens with nothing chosen, once. Choosing "Any" for the host afterwards stays (FR-24). */
const open = (url: string) => {
  window.history.replaceState(null, '', url);
  return render(<LatestData />, { wrapper: BrowserRouter });
};

beforeEach(() => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'hosts').mockResolvedValue([
    { hostid: '1', name: '1.1 core-1', status: '0' },
    { hostid: '2', name: '1.2 core-2', status: '0' },
  ]);
  vi.spyOn(api, 'hostgroups').mockResolvedValue([{ groupid: '7', name: 'Switches' }]);
  vi.spyOn(api, 'latest').mockResolvedValue({ items: [], truncated: false, total: 0, page: 1, pageSize: 100 });
});
afterEach(() => vi.restoreAllMocks());

const host = () => screen.getByLabelText('Host') as HTMLSelectElement;
const group = () => screen.getByLabelText('Host group') as HTMLSelectElement;

describe('the Host menu of Latest data', () => {
  it('starts on the first host when the page opens with nothing chosen', async () => {
    open('/latest');
    await waitFor(() => expect(host().value).toBe('1'));
  });

  it('keeps "Any" when it is chosen, and says what to choose instead of reading as an empty list', async () => {
    const user = userEvent.setup();
    open('/latest');
    await waitFor(() => expect(host().value).toBe('1'));

    await user.selectOptions(host(), '');
    // Long enough for an effect to have picked a host again, had it been going to.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host().value).toBe('');
    expect(group().value).toBe('');
    expect(await screen.findByText('Choose a host or a host group to list its items.')).toBeInTheDocument();
    expect(screen.queryByText('No items for this selection.')).toBeNull();
  });

  it('keeps a group that was chosen, and does not pick a host beside it', async () => {
    open('/latest?groupid=7');
    await waitFor(() => expect(group().value).toBe('7'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host().value).toBe('');
  });
});
