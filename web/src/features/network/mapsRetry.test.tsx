import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Maps from './Maps';

// A page loads in steps and the test files run side by side, so the default second of waiting is too short on a busy machine.
configure({ asyncUtilTimeout: 5000 });

/** The list of Zabbix maps is read once: a failure left the error and no way to read again but a reload (UX-60). */
beforeEach(() => {
  resetAuthProbe();
  window.history.replaceState(null, '', '/maps');
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'mapDetail').mockReturnValue(new Promise(() => undefined));
});
afterEach(() => vi.restoreAllMocks());

describe('the Maps list (UX-60)', () => {
  it('offers Try again when it could not be read, and reads it again', async () => {
    const maps = vi
      .spyOn(api, 'maps')
      .mockRejectedValueOnce(new Error('Zabbix did not answer'))
      .mockResolvedValue([{ sysmapid: '1', name: 'Core network' } as never]);
    render(<Maps />, { wrapper: BrowserRouter });
    expect(await screen.findByText('Zabbix did not answer')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(maps).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('option', { name: 'Core network' })).toBeInTheDocument();
    expect(screen.queryByText('Zabbix did not answer')).toBeNull();
  });
});
