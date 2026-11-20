import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../api';
import ChangePassword from './ChangePassword';

/** A person's own password (ADR-0017): asked for twice, held to the server's rule, and the one thing a temporary password may do. */

afterEach(() => vi.restoreAllMocks());

const fill = async (typing: ReturnType<typeof userEvent.setup>, current: string, next: string, again: string) => {
  if (current) await typing.type(screen.getByLabelText('Current password'), current);
  if (next) await typing.type(screen.getByLabelText('New password', { selector: 'input[name="new"]' }), next);
  if (again) await typing.type(screen.getByLabelText('New password again'), again);
  await typing.click(screen.getByRole('button', { name: 'Change password' }));
};

describe('ChangePassword', () => {
  it('sends the current and the new password, says it was changed, and clears the fields', async () => {
    const change = vi.spyOn(api, 'changePassword').mockResolvedValue({ ok: true, user: { name: 'ana', role: 'guest' }, expiresIn: 43_200 });
    const done = vi.fn();
    const typing = userEvent.setup();
    render(<ChangePassword onDone={done} />);
    await fill(typing, 'the-old-password', 'a-brand-new-password', 'a-brand-new-password');
    await waitFor(() => expect(change).toHaveBeenCalledWith('the-old-password', 'a-brand-new-password'));
    expect(await screen.findByText('Your password was changed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('asks nothing of the server when the two new passwords differ or the current one is missing', async () => {
    const change = vi.spyOn(api, 'changePassword');
    const typing = userEvent.setup();
    render(<ChangePassword />);
    await fill(typing, 'the-old-password', 'a-brand-new-password', 'another-one-entirely');
    expect(await screen.findByRole('alert')).toHaveTextContent('The two new passwords are not the same.');
    await typing.clear(screen.getByLabelText('Current password'));
    await typing.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your current password.');
    expect(change).not.toHaveBeenCalled();
  });

  it('shows the server\'s sentence when it refuses, and does not say it was changed', async () => {
    vi.spyOn(api, 'changePassword').mockRejectedValue(new Error('The current password is not right.'));
    const typing = userEvent.setup();
    render(<ChangePassword />);
    await fill(typing, 'wrong-guess', 'a-brand-new-password', 'a-brand-new-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('The current password is not right.');
    expect(screen.queryByText('Your password was changed.')).toBeNull();
  });

  it('says why when the password is a temporary one', () => {
    render(<ChangePassword forced />);
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.getByText(/set by an administrator/)).toBeInTheDocument();
  });
});
