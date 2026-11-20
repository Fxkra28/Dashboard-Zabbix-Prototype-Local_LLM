import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api, HttpFailure } from '../../api';
import Login from './Login';
import type { RequestInfo } from '../../types';

/**
 * Asking for an account from the sign-in page (FR-62). Off unless the portal says the form is on; a person who is not signed in leaves a name, the pages they want and a reason, and is told only that
 * the request was received. The server holds the limits (server/src/__tests__/account-requests.test.ts); here is what the page offers and says.
 */

const ON: RequestInfo = {
  enabled: true,
  pages: [
    { id: 'problems', label: 'Problems' },
    { id: 'sla', label: 'SLA' },
    { id: 'graphs', label: 'Graphs' },
  ],
  nameMax: 80,
  reasonMax: 500,
};

const open = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
/** The sign-in page, with the form for an account opened. */
const ask = async () => {
  open();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Ask for an account' }));
  return user;
};

beforeEach(() => {
  vi.spyOn(api, 'requestInfo').mockResolvedValue(ON);
});
afterEach(() => vi.restoreAllMocks());

describe('the way to the form', () => {
  it('is a button under the sign-in form when the portal says the form is on', async () => {
    open();
    expect(await screen.findByRole('button', { name: 'Ask for an account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('is not drawn when the form is off, which is how a portal is until a setting turns it on', async () => {
    vi.mocked(api.requestInfo).mockResolvedValue({ enabled: false });
    open();
    await waitFor(() => expect(api.requestInfo).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: 'Ask for an account' })).toBeNull();
  });

  it('is not drawn when the portal does not answer: signing in is the page’s task', async () => {
    vi.mocked(api.requestInfo).mockRejectedValue(new Error('Failed to fetch'));
    open();
    await waitFor(() => expect(api.requestInfo).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: 'Ask for an account' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens the form in place of the sign-in form, with its heading focused, and goes back', async () => {
    const user = await ask();
    const heading = await screen.findByRole('heading', { name: 'Ask for an account' });
    expect(heading).toHaveFocus();
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});

describe('the form', () => {
  it('lists the pages the portal says may be asked for, and says an administrator decides', async () => {
    await ask();
    for (const label of ['Problems', 'SLA', 'Graphs']) expect(await screen.findByRole('checkbox', { name: label })).not.toBeChecked();
    expect(screen.getByText(/An administrator reads the request and decides/)).toBeInTheDocument();
  });

  it('says in words what is missing, and sends nothing', async () => {
    const send = vi.spyOn(api, 'sendRequest').mockResolvedValue({ ok: true });
    const user = await ask();
    await screen.findByRole('checkbox', { name: 'SLA' });
    await user.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your name.');
    await user.type(screen.getByLabelText('Your name'), 'Budi Santoso');
    await user.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one page.');
    await user.click(screen.getByRole('checkbox', { name: 'SLA' }));
    await user.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Say what you need the account for.');
    expect(send).not.toHaveBeenCalled();
  });

  it('counts the characters of the reason against what the portal reads', async () => {
    const user = await ask();
    await user.type(await screen.findByLabelText('What you need the account for'), 'abcde');
    expect(screen.getByText('5 of 500 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('What you need the account for')).toHaveAttribute('maxLength', '500');
    expect(screen.getByLabelText('Your name')).toHaveAttribute('maxLength', '80');
  });

  it('sends the name, the pages chosen and the reason, trimmed, and says only that the request was received', async () => {
    const send = vi.spyOn(api, 'sendRequest').mockResolvedValue({ ok: true });
    const user = await ask();
    await user.type(await screen.findByLabelText('Your name'), '  Budi Santoso ');
    await user.click(screen.getByRole('checkbox', { name: 'Problems' }));
    await user.click(screen.getByRole('checkbox', { name: 'SLA' }));
    await user.type(screen.getByLabelText('What you need the account for'), ' The morning handover. ');
    await user.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({ name: 'Budi Santoso', pages: ['problems', 'sla'], reason: 'The morning handover.' });
    const heading = await screen.findByRole('heading', { name: 'Your request was received' });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('temporary password');
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('shows the portal’s own words when it refuses, and keeps what was typed', async () => {
    vi.spyOn(api, 'sendRequest').mockRejectedValue(new HttpFailure('This address has left as many requests as it may for one day. Ask an administrator, or try again tomorrow.', 429, true));
    const user = await ask();
    await user.type(await screen.findByLabelText('Your name'), 'Budi Santoso');
    await user.click(screen.getByRole('checkbox', { name: 'SLA' }));
    await user.type(screen.getByLabelText('What you need the account for'), 'The handover.');
    await user.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('as many requests as it may for one day');
    expect(screen.getByLabelText('Your name')).toHaveValue('Budi Santoso');
    expect(screen.getByRole('checkbox', { name: 'SLA' })).toBeChecked();
  });

  it('sends one request however often the button is pressed, and keeps the button focusable while it works', async () => {
    let done!: (v: { ok: boolean }) => void;
    const send = vi.spyOn(api, 'sendRequest').mockImplementation(() => new Promise((resolve) => (done = resolve)));
    const user = await ask();
    await user.type(await screen.findByLabelText('Your name'), 'Budi Santoso');
    await user.click(screen.getByRole('checkbox', { name: 'SLA' }));
    await user.type(screen.getByLabelText('What you need the account for'), 'The handover.');
    const button = screen.getByRole('button', { name: 'Send the request' });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Sending…' })).not.toBeDisabled();
    done({ ok: true });
    await screen.findByRole('heading', { name: 'Your request was received' });
  });
});
