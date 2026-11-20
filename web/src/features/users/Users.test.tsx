import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import type { AccountRequestRecord, ModuleId, ModuleInfo, UserRecord, UsersResponse } from '../../types';
import Users, { signInNameFor } from './Users';

/** Users and access (ADR-0017): the list, adding a user, changing one, setting a password, disabling, and what the page says when it cannot change anything. */

const MODULES: ModuleInfo[] = (
  [
    ['dashboard', 'Dashboard', '/'],
    ['problems', 'Problems', '/problems'],
    ['network', 'Network', '/network'],
    ['sla', 'SLA', '/sla'],
    ['inventory', 'Inventory & ownership scorecard', '/reports/inventory'],
    ['users', 'Users and access', '/users'],
  ] as [ModuleId, string, string][]
).map(([id, label, page]) => ({ id, label, page, adminOnly: id === 'inventory' || id === 'users' }));

const user = (over: Partial<UserRecord> = {}): UserRecord => ({
  name: 'budi.santoso',
  displayName: 'Budi Santoso',
  role: 'operator',
  modules: ['problems', 'sla'],
  language: 'id',
  source: 'file',
  breakGlass: false,
  disabled: false,
  expires: null,
  mustChange: false,
  created: 1_790_000_000,
  createdBy: 'root',
  lastSignIn: 1_790_100_000,
  ...over,
});

const response = (over: Partial<UsersResponse> = {}): UsersResponse => ({
  users: [user({ name: 'root', displayName: 'root', role: 'admin', modules: MODULES.map((m) => m.id), source: 'env', breakGlass: true, lastSignIn: null, language: null }), user(), user({ name: 'guest.one', displayName: 'guest.one', role: 'guest', modules: ['sla'], disabled: true, language: null, lastSignIn: null })],
  modules: MODULES,
  presets: { guest: ['dashboard', 'problems', 'sla'], operator: ['dashboard', 'problems', 'sla', 'network'], admin: MODULES.map((m) => m.id) },
  durable: true,
  editable: true,
  failing: false,
  secure: true,
  ...over,
});

const open = () =>
  render(
    <BrowserRouter>
      <Users />
    </BrowserRouter>,
  );

beforeEach(() => {
  vi.spyOn(api, 'users').mockResolvedValue(response());
});
afterEach(() => vi.restoreAllMocks());

const row = (name: string) => screen.getByText(name, { selector: 'strong, .sli-sub' }).closest('tr') as HTMLElement;

describe('the list', () => {
  it('shows each user with the role, how many pages, the language, the last sign-in and where they stand', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Users (3)' })).toBeInTheDocument();
    const budi = within(row('Budi Santoso'));
    expect(budi.getByText('Operator')).toBeInTheDocument();
    expect(budi.getByText('2 of 4')).toBeInTheDocument();
    expect(budi.getByText('Bahasa Indonesia')).toBeInTheDocument();
    expect(budi.getByText('Active')).toBeInTheDocument();
    expect(within(row('root')).getByText('All')).toBeInTheDocument();
    expect(within(row('root')).getByText('Kept in .env, always signs in')).toBeInTheDocument();
    expect(within(row('guest.one')).getByText('Disabled')).toBeInTheDocument();
    expect(within(row('guest.one')).getByText('never')).toBeInTheDocument();
  });

  it('offers to change, set a password for and disable a user of the file, and offers nothing for one kept in .env', async () => {
    open();
    await screen.findByRole('heading', { name: 'Users (3)' });
    expect(screen.getByRole('button', { name: 'Change budi.santoso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a password for budi.santoso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable budi.santoso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable guest.one' })).toBeInTheDocument();
    expect(within(row('root')).queryAllByRole('button')).toHaveLength(0);
  });

  it('says so, and keeps every control away, when the users are in .env and cannot be changed', async () => {
    vi.mocked(api.users).mockResolvedValue(response({ editable: false, durable: false }));
    open();
    expect(await screen.findByText(/no data folder to keep users in/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a user' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Change / })).toBeNull();
  });

  it('warns that the connection is not encrypted before real accounts are added, and that a save failed', async () => {
    vi.mocked(api.users).mockResolvedValue(response({ secure: false, failing: true }));
    open();
    expect(await screen.findByText(/not encrypted/)).toBeInTheDocument();
    expect(screen.getByText(/last change could not be saved/)).toBeInTheDocument();
  });

  it('says why when the users cannot be read', async () => {
    vi.mocked(api.users).mockRejectedValue(new Error('This view is for administrators.'));
    open();
    expect(await screen.findByText(/This view is for administrators/)).toBeInTheDocument();
  });
});

describe('adding a user', () => {
  it('ticks the pages of the role, which can be changed, and sends the choices', async () => {
    const create = vi.spyOn(api, 'createUser').mockResolvedValue({ user: user({ name: 'new.person' }) });
    const typing = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'Add a user' });
    // A guest starts with the guest preset: three pages, and the administrator's pages cannot be ticked.
    const form = within(screen.getByRole('heading', { name: 'Add a user' }).closest('form') as HTMLElement);
    expect(form.getByRole('checkbox', { name: 'Dashboard' })).toBeChecked();
    expect(form.getByRole('checkbox', { name: 'Network' })).not.toBeChecked();
    expect(form.getByRole('checkbox', { name: /Inventory.*\(administrators only\)/ })).toBeDisabled();

    await typing.type(form.getByLabelText('Sign-in name'), 'new.person');
    await typing.type(form.getByLabelText('Name shown'), 'New Person');
    await typing.selectOptions(form.getByLabelText('Role'), 'operator');
    expect(form.getByRole('checkbox', { name: 'Network' })).toBeChecked();
    await typing.click(form.getByRole('checkbox', { name: 'Problems' }));
    await typing.selectOptions(form.getByLabelText('Language of the Assistant'), 'id');
    await typing.type(form.getByLabelText('Password'), 'a-long-password-1');
    await typing.click(form.getByRole('button', { name: 'Add user' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      name: 'new.person',
      displayName: 'New Person',
      role: 'operator',
      modules: ['dashboard', 'sla', 'network'],
      language: 'id',
      password: 'a-long-password-1',
      mustChange: true,
      expires: null,
    });
    expect(await screen.findByText('Added new.person.')).toBeInTheDocument();
    expect(api.users).toHaveBeenCalledTimes(2);
  });

  it('shows an administrator every page, ticked and fixed', async () => {
    const typing = userEvent.setup();
    open();
    const form = within((await screen.findByRole('heading', { name: 'Add a user' })).closest('form') as HTMLElement);
    await typing.selectOptions(form.getByLabelText('Role'), 'admin');
    expect(form.getByText('An administrator has every page.')).toBeInTheDocument();
    for (const box of form.getAllByRole('checkbox', { name: /Dashboard|Network|Inventory|Users and access/ })) {
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
  });

  it('shows the server\'s words when it refuses, and keeps what was typed', async () => {
    vi.spyOn(api, 'createUser').mockRejectedValue(new Error('The password must have at least 8 characters.'));
    const typing = userEvent.setup();
    open();
    const form = within((await screen.findByRole('heading', { name: 'Add a user' })).closest('form') as HTMLElement);
    await typing.type(form.getByLabelText('Sign-in name'), 'new.person');
    await typing.type(form.getByLabelText('Password'), 'short');
    await typing.click(form.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The password must have at least 8 characters.');
    expect(form.getByLabelText('Sign-in name')).toHaveValue('new.person');
  });
});

describe('changing a user', () => {
  it('opens a form with what the user has, says what the account can do, and sends only a whole change', async () => {
    const update = vi.spyOn(api, 'updateUser').mockResolvedValue({ user: user() });
    const typing = userEvent.setup();
    open();
    await typing.click(await screen.findByRole('button', { name: 'Change budi.santoso' }));
    const form = within(screen.getByRole('heading', { name: 'Change budi.santoso' }).closest('form') as HTMLElement);
    expect(form.getByLabelText('Role')).toHaveValue('operator');
    expect(form.getByRole('checkbox', { name: 'SLA' })).toBeChecked();
    expect(form.getByRole('checkbox', { name: 'Network' })).not.toBeChecked();
    expect(form.getByText('Problems, SLA')).toBeInTheDocument();
    expect(form.getByText(/Acknowledge and close problems/)).toBeInTheDocument();
    // The add form gives way to this one.
    expect(screen.queryByRole('heading', { name: 'Add a user' })).toBeNull();

    await typing.click(form.getByRole('checkbox', { name: 'Network' }));
    await typing.click(form.getByRole('checkbox', { name: 'Problems' }));
    await typing.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('budi.santoso', { displayName: 'Budi Santoso', role: 'operator', modules: ['sla', 'network'], language: 'id', expires: null }));
    expect(screen.queryByRole('heading', { name: 'Change budi.santoso' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Add a user' })).toBeInTheDocument();
  });

  it('drops the pages a lower role cannot have when the role is lowered, and says what the account can then do', async () => {
    const typing = userEvent.setup();
    vi.mocked(api.users).mockResolvedValue(response({ users: [user({ name: 'second.admin', displayName: 'second.admin', role: 'admin', modules: MODULES.map((m) => m.id) })] }));
    open();
    await typing.click(await screen.findByRole('button', { name: 'Change second.admin' }));
    const form = within(screen.getByRole('heading', { name: 'Change second.admin' }).closest('form') as HTMLElement);
    expect(form.getByText(/Add and change users and their pages/)).toBeInTheDocument();
    await typing.selectOptions(form.getByLabelText('Role'), 'guest');
    expect(form.queryByText(/Add and change users and their pages/)).toBeNull();
    expect(form.getByRole('checkbox', { name: /Users and access/ })).toBeDisabled();
    expect(form.getByRole('checkbox', { name: /Users and access/ })).not.toBeChecked();
    expect(form.getByRole('checkbox', { name: 'Dashboard' })).toBeChecked();
  });

  it('shows the server\'s sentence when it refuses and leaves the form open', async () => {
    vi.spyOn(api, 'updateUser').mockRejectedValue(new Error('You cannot disable, demote or expire your own account: ask another administrator.'));
    const typing = userEvent.setup();
    open();
    await typing.click(await screen.findByRole('button', { name: 'Change budi.santoso' }));
    await typing.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('your own account');
    expect(screen.getByRole('heading', { name: 'Change budi.santoso' })).toBeInTheDocument();
    await typing.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Change budi.santoso' })).toBeNull();
  });
});

describe('setting a password and disabling', () => {
  it('sets a temporary password, which the person must change, unless it is told not to', async () => {
    const reset = vi.spyOn(api, 'resetUserPassword').mockResolvedValue({ user: user() });
    const typing = userEvent.setup();
    open();
    await typing.click(await screen.findByRole('button', { name: 'Set a password for budi.santoso' }));
    const form = within(screen.getByRole('heading', { name: 'Set a password for budi.santoso' }).closest('form') as HTMLElement);
    expect(form.getByRole('checkbox')).toBeChecked();
    await typing.type(form.getByLabelText('New password'), 'reset-by-the-admin-1');
    await typing.click(form.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith('budi.santoso', 'reset-by-the-admin-1', true));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Set a password/ })).toBeNull());
  });

  it('disables and enables with one press, and reads the list again', async () => {
    const update = vi.spyOn(api, 'updateUser').mockResolvedValue({ user: user() });
    const typing = userEvent.setup();
    open();
    await typing.click(await screen.findByRole('button', { name: 'Disable budi.santoso' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('budi.santoso', { disabled: true }));
    await typing.click(await screen.findByRole('button', { name: 'Enable guest.one' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith('guest.one', { disabled: false }));
    expect(api.users).toHaveBeenCalledTimes(3);
  });

  it('says why a change was refused, in the table\'s own place', async () => {
    vi.spyOn(api, 'updateUser').mockRejectedValue(new Error('That would leave no administrator who can sign in.'));
    const typing = userEvent.setup();
    open();
    await typing.click(await screen.findByRole('button', { name: 'Disable budi.santoso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no administrator who can sign in');
  });
});

// UX-71: Save and Cancel take a form and its heading away, and the Add form is not lost by looking at another row.
describe('focus and the form of a new user (UX-71)', () => {
  const press = async (name: string | RegExp) => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name }));
    return user;
  };

  it('goes back to the Change button of the row when Cancel closes the form', async () => {
    open();
    const user = await press('Change budi.santoso');
    expect(await screen.findByRole('heading', { name: 'Change budi.santoso' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Change budi.santoso' })).toHaveFocus();
  });

  it('goes back to it when Save closes the form, and the list is read again', async () => {
    const save = vi.spyOn(api, 'updateUser').mockResolvedValue({ user: user() } as never);
    open();
    const typing = await press('Change budi.santoso');
    await typing.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change budi.santoso' })).toHaveFocus());
    expect(api.users).toHaveBeenCalledTimes(2);
  });

  it('goes back to the Password button of the row when the password form closes', async () => {
    open();
    const typing = await press('Set a password for budi.santoso');
    expect(await screen.findByRole('heading', { name: 'Set a password for budi.santoso' })).toHaveFocus();
    await typing.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Set a password for budi.santoso' })).toHaveFocus();
  });

  it('keeps the Add form, with what was typed in it, while another form is open, and shows it again after', async () => {
    open();
    const typing = userEvent.setup();
    await typing.type(await screen.findByLabelText('Sign-in name'), 'new.person');
    await typing.click(screen.getByRole('button', { name: 'Change budi.santoso' }));
    await screen.findByRole('heading', { name: 'Change budi.santoso' });
    const kept = screen.getByLabelText('Sign-in name', { selector: '[name="name"]' });
    expect(kept.closest('[hidden]')).not.toBeNull();
    expect(kept).toHaveValue('new.person');
    await typing.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Sign-in name')).toHaveValue('new.person');
    expect(screen.getByLabelText('Sign-in name').closest('[hidden]')).toBeNull();
  });
});

// FR-62: people who are not signed in ask for an account; an administrator answers on this page.
describe('requests for an account', () => {
  const REQUEST: AccountRequestRecord = { id: 'req-0001-abcdef', name: 'Citra Dewi', pages: ['problems', 'sla'], reason: 'I take the Surabaya handover.\nSecond line <b>not bold</b>.', created: 1_790_000_000 };
  const open = () =>
    render(
      <BrowserRouter>
        <Users />
      </BrowserRouter>,
    );
  const on = (requests: AccountRequestRecord[] = [REQUEST]) => vi.spyOn(api, 'accountRequests').mockResolvedValue({ enabled: true, max: 50, requests });

  it('is not drawn when the portal does not take requests, which is how it is until a setting is on', async () => {
    vi.spyOn(api, 'accountRequests').mockResolvedValue({ enabled: false, max: 50, requests: [] });
    open();
    await screen.findByRole('heading', { name: 'Users (3)' });
    expect(screen.queryByRole('heading', { name: /Requests for an account/ })).toBeNull();
  });

  it('is not drawn either when the list could not be read', async () => {
    vi.spyOn(api, 'accountRequests').mockRejectedValue(new Error('The users cannot be managed while sign-in is off.'));
    open();
    await screen.findByRole('heading', { name: 'Users (3)' });
    expect(screen.queryByRole('heading', { name: /Requests for an account/ })).toBeNull();
  });

  it('lists each request with what the person asked for, and shows what they typed as text and never as markup', async () => {
    on();
    open();
    expect(await screen.findByRole('heading', { name: 'Requests for an account (1)' })).toBeInTheDocument();
    const item = screen.getByText('Citra Dewi').closest('li') as HTMLElement;
    expect(item).toHaveTextContent('for Problems, SLA');
    expect(within(item).getByText(/I take the Surabaya handover/)).toHaveTextContent('Second line <b>not bold</b>.');
    expect(item.querySelector('b')).toBeNull();
    expect(screen.getByText(/at most 50 wait at once/)).toBeInTheDocument();
  });

  it('says none are waiting when the form is on and nobody has asked', async () => {
    on([]);
    open();
    expect(await screen.findByRole('heading', { name: 'Requests for an account (0)' })).toBeInTheDocument();
    expect(screen.getByText('None waiting.')).toBeInTheDocument();
  });

  it('opens the form of a new user for an approval, with the name, a sign-in name to start from and the pages asked for already chosen', async () => {
    on();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve…' }));
    const heading = await screen.findByRole('heading', { name: 'Approve the request of Citra Dewi' });
    expect(heading).toHaveFocus();
    expect(screen.getByLabelText('Sign-in name')).toHaveValue('citra.dewi');
    expect(screen.getByLabelText('Name shown')).toHaveValue('Citra Dewi');
    expect(screen.getByRole('checkbox', { name: 'Problems' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'SLA' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Network' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Approve and add the user' })).toBeInTheDocument();
  });

  it('makes the account through the approval, with the password the administrator typed, and says so when it is done', async () => {
    on();
    const approve = vi.spyOn(api, 'approveRequest').mockResolvedValue({ user: user({ name: 'citra.dewi', displayName: 'Citra Dewi' }) });
    const create = vi.spyOn(api, 'createUser');
    open();
    const typing = userEvent.setup();
    await typing.click(await screen.findByRole('button', { name: 'Approve…' }));
    await typing.type(await screen.findByLabelText('Password', { selector: '[name="password"]' }), 'a-long-password-1');
    await typing.click(screen.getByRole('button', { name: 'Approve and add the user' }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(approve).toHaveBeenCalledWith('req-0001-abcdef', expect.objectContaining({ name: 'citra.dewi', displayName: 'Citra Dewi', role: 'guest', modules: ['problems', 'sla'], password: 'a-long-password-1', mustChange: true }));
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByText(/Added citra\.dewi\. Pass the temporary password on/)).toBeInTheDocument();
    expect(api.accountRequests).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('heading', { name: /Approve the request/ })).toBeNull();
  });

  it('leaves the request where it is when the account cannot be made, and says why', async () => {
    on();
    vi.spyOn(api, 'approveRequest').mockRejectedValue(new Error('"citra.dewi" is already a user.'));
    open();
    const typing = userEvent.setup();
    await typing.click(await screen.findByRole('button', { name: 'Approve…' }));
    await typing.type(await screen.findByLabelText('Password', { selector: '[name="password"]' }), 'a-long-password-1');
    await typing.click(screen.getByRole('button', { name: 'Approve and add the user' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already a user');
    expect(screen.getByRole('heading', { name: 'Approve the request of Citra Dewi' })).toBeInTheDocument();
  });

  it('goes back to the list with Leave the request, and the form is the one for a new user again', async () => {
    on();
    open();
    const typing = userEvent.setup();
    await typing.click(await screen.findByRole('button', { name: 'Approve…' }));
    await typing.click(await screen.findByRole('button', { name: 'Leave the request' }));
    expect(screen.getByRole('heading', { name: 'Add a user' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requests for an account (1)' })).toBeInTheDocument();
  });

  // UX-71 again, for the form of an approval: it is taken away when it is done or left, and a keyboard must not fall to the top of the page.
  it('puts the focus on the heading of the users when the approval is done', async () => {
    on();
    vi.spyOn(api, 'approveRequest').mockResolvedValue({ user: user({ name: 'citra.dewi', displayName: 'Citra Dewi' }) });
    open();
    const typing = userEvent.setup();
    await typing.click(await screen.findByRole('button', { name: 'Approve…' }));
    await typing.type(await screen.findByLabelText('Password', { selector: '[name="password"]' }), 'a-long-password-1');
    await typing.click(screen.getByRole('button', { name: 'Approve and add the user' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Users \(/ })).toHaveFocus());
  });

  it('puts it there after Leave the request too', async () => {
    on();
    open();
    const typing = userEvent.setup();
    await typing.click(await screen.findByRole('button', { name: 'Approve…' }));
    await typing.click(await screen.findByRole('button', { name: 'Leave the request' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Users \(/ })).toHaveFocus());
  });

  it('closes a form that is open above the table when an approval starts, and shows the approval, with the focus on it', async () => {
    on();
    open();
    const typing = userEvent.setup();
    await typing.click(await screen.findByRole('button', { name: 'Change budi.santoso' }));
    await screen.findByRole('heading', { name: 'Change budi.santoso' });
    await typing.click(screen.getByRole('button', { name: 'Approve…' }));
    expect(screen.queryByRole('heading', { name: 'Change budi.santoso' })).toBeNull();
    const heading = await screen.findByRole('heading', { name: 'Approve the request of Citra Dewi' });
    expect(heading.closest('[hidden]')).toBeNull();
    await waitFor(() => expect(heading).toHaveFocus());
  });

  // The notice follows what was made: the person is told to choose their own password only when the account says they must.
  it('says in the notice that the person chooses their own password when the account makes them, and not when it does not', async () => {
    const approve = vi.spyOn(api, 'approveRequest').mockResolvedValue({ user: user({ name: 'citra.dewi', displayName: 'Citra Dewi', mustChange: true }) });
    on();
    open();
    const typing = userEvent.setup();
    const approveOne = async () => {
      await typing.click(await screen.findByRole('button', { name: 'Approve…' }));
      await typing.type(await screen.findByLabelText('Password', { selector: '[name="password"]' }), 'a-long-password-1');
      await typing.click(screen.getByRole('button', { name: 'Approve and add the user' }));
    };
    await approveOne();
    expect(await screen.findByText(/they choose their own when they first sign in/)).toBeInTheDocument();
    approve.mockResolvedValue({ user: user({ name: 'dewi.lestari', displayName: 'Dewi Lestari', mustChange: false }) });
    await approveOne();
    expect(await screen.findByText(/Added dewi\.lestari\. Pass the temporary password on to them yourself\./)).toBeInTheDocument();
    expect(screen.queryByText(/they choose their own when they first sign in/)).toBeNull();
  });

  it('asks before it refuses, and then takes the request off the list', async () => {
    on();
    const refuse = vi.spyOn(api, 'refuseRequest').mockResolvedValue({ ok: true });
    open();
    const typing = userEvent.setup();
    await typing.click(await screen.findByRole('button', { name: 'Refuse…' }));
    expect(refuse).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Refuse the request of Citra Dewi?' })).toBeInTheDocument();
    await typing.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(refuse).not.toHaveBeenCalled();
    await typing.click(screen.getByRole('button', { name: 'Refuse…' }));
    await typing.click(screen.getByRole('button', { name: 'Yes, refuse it' }));
    await waitFor(() => expect(refuse).toHaveBeenCalledWith('req-0001-abcdef'));
    await waitFor(() => expect(api.accountRequests).toHaveBeenCalledTimes(2));
  });

  it('says why when a refusal did not go through, and keeps the request on the list', async () => {
    on();
    vi.spyOn(api, 'refuseRequest').mockRejectedValue(new Error('There is no such request: it may have been answered by another administrator.'));
    open();
    const typing = userEvent.setup();
    await typing.click(await screen.findByRole('button', { name: 'Refuse…' }));
    await typing.click(screen.getByRole('button', { name: 'Yes, refuse it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('answered by another administrator');
    expect(screen.getByText('Citra Dewi')).toBeInTheDocument();
  });
});

describe('the sign-in name to start from, for a name a stranger typed', () => {
  it('is lower case with a dot between the words', () => {
    expect(signInNameFor('Budi Santoso')).toBe('budi.santoso');
    expect(signInNameFor('  Citra   Dewi  ')).toBe('citra.dewi');
  });

  it('drops accents and anything a name may not hold, and keeps it to the length a name may have', () => {
    expect(signInNameFor('José Müller-Éa')).toBe('jose.muller.ea');
    expect(signInNameFor('A. B! <script>')).toBe('a.b.script');
    expect(signInNameFor('x'.repeat(100)).length).toBeLessThanOrEqual(64);
    expect(signInNameFor('日本語')).toBe('');
  });
});

