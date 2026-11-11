import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, HttpFailure } from '../../api';
import SavedList from './SavedList';

/**
 * The saved list of people a report goes to, as the Email and Schedule dialogs show it (FR-31): each address with a button to
 * remove it, a box to add one, and a button to delete the whole list. Each change is saved at once; the portal's own words are
 * shown when it refuses. Every address is made up.
 */

const SAVED = ['carla@example.org', 'dewi@example.org'];
let save: ReturnType<typeof vi.spyOn>;
let remove: ReturnType<typeof vi.spyOn>;
const onChanged = vi.fn();

beforeEach(() => {
  onChanged.mockReset();
  save = vi.spyOn(api, 'sliRecipientsSave').mockImplementation(async (list: string[]) => ({ recipients: list, saved: list.length }));
  remove = vi.spyOn(api, 'sliRecipientsDelete').mockResolvedValue({ recipients: [], removed: 2 });
});
afterEach(() => vi.restoreAllMocks());

async function open(props: Partial<React.ComponentProps<typeof SavedList>> = {}) {
  const user = userEvent.setup();
  render(<SavedList saved={SAVED} max={10} allowedDomains={[]} onChanged={onChanged} {...props} />);
  await user.click(screen.getByRole('button', { name: /Saved list/ }));
  return user;
}
const toggle = () => screen.getByRole('button', { name: /Saved list/ });

describe('the view before it is opened', () => {
  it('is closed, says how many people are saved, and shows no address', () => {
    render(<SavedList saved={SAVED} max={10} allowedDomains={[]} onChanged={onChanged} />);
    expect(toggle()).toHaveTextContent('Saved list (2 people)');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('carla@example.org')).toBeNull();
  });

  it('says one person for one, and nobody for none', () => {
    const { rerender } = render(<SavedList saved={['carla@example.org']} max={10} allowedDomains={[]} onChanged={onChanged} />);
    expect(toggle()).toHaveTextContent('Saved list (1 person)');
    rerender(<SavedList saved={[]} max={10} allowedDomains={[]} onChanged={onChanged} />);
    expect(toggle()).toHaveTextContent('Saved list (none)');
  });

  it('opens and closes on the button, which names the region it controls', async () => {
    const user = await open();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle().getAttribute('aria-controls') ?? '')).toContainElement(screen.getByText('carla@example.org'));
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('carla@example.org')).toBeNull();
  });
});

describe('the view opened', () => {
  it('lists each saved address with a Remove button that names it, and a box to add one', async () => {
    await open();
    for (const a of SAVED) {
      expect(screen.getByText(a)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Remove ${a} from the saved list` })).toBeEnabled();
    }
    expect(screen.getByRole('textbox', { name: 'Add an address to the saved list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete the saved list' })).toBeInTheDocument();
  });

  it('says that no list is saved, and offers no Remove and no Delete, when there is none', async () => {
    await open({ saved: [] });
    expect(screen.getByText('No list is saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete the saved list' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Add an address to the saved list' })).toBeInTheDocument();
  });
});

describe('removing an address', () => {
  it('saves the rest, tells the page the list that applies, and says what was done', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Remove carla@example.org from the saved list' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(['dewi@example.org']));
    expect(save).toHaveBeenCalledWith(['dewi@example.org']);
    expect(screen.getByRole('status')).toHaveTextContent('Removed carla@example.org. The list holds 1 person.');
  });

  it('deletes the list when it is the last address, since a list is never saved empty', async () => {
    const user = await open({ saved: ['carla@example.org'] });
    await user.click(screen.getByRole('button', { name: 'Remove carla@example.org from the saved list' }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(save).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledWith([]);
    expect(screen.getByRole('status')).toHaveTextContent('Removed carla@example.org. No list is saved now.');
  });
});

describe('adding an address', () => {
  const type = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    const box = screen.getByRole('textbox', { name: 'Add an address to the saved list' });
    await user.clear(box);
    await user.type(box, text);
    return box;
  };

  it('saves the list with it at the end, trimmed, empties the box and says what was done', async () => {
    const user = await open();
    const box = await type(user, '  eko@example.org ');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith([...SAVED, 'eko@example.org']));
    expect(onChanged).toHaveBeenCalledWith([...SAVED, 'eko@example.org']);
    expect(box).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Added eko@example.org. The list holds 3 people.');
  });

  it('adds on Enter in the box too', async () => {
    const user = await open();
    await type(user, 'eko@example.org{Enter}');
    await waitFor(() => expect(save).toHaveBeenCalledWith([...SAVED, 'eko@example.org']));
  });

  it('asks the server nothing for an empty box, and for an address that is on the list already, of any case', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await type(user, 'CARLA@example.org');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('carla@example.org is on the list already.');
  });

  it('asks the server nothing when the list is full, and says how many it may hold', async () => {
    const full = Array.from({ length: 3 }, (_, i) => `p${i}@example.org`);
    const user = await open({ saved: full, max: 3 });
    await type(user, 'more@example.org');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('The list holds the most it can: 3 addresses.');
  });

  it('says which domains the portal sends to, beside the box, when it limits them', async () => {
    await open({ allowedDomains: ['example.org', 'hcml.co.id'] });
    expect(screen.getByText(/Only addresses at example\.org or hcml\.co\.id are accepted\./)).toBeInTheDocument();
  });

  it('shows the portal’s sentence when it refuses the address, keeps what was typed and leaves the list alone', async () => {
    save.mockRejectedValueOnce(new HttpFailure('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).', 400, true));
    const user = await open();
    const box = await type(user, 'spy@elsewhere.net');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).');
    expect(box).toHaveValue('spy@elsewhere.net');
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('deleting the list', () => {
  it('asks first, and keeps the list when the person says keep', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Delete the saved list' }));
    expect(screen.getByRole('alertdialog', { name: /Delete the saved list of 2 people/ })).toBeInTheDocument();
    // The safe answer has the focus, so that Enter does not delete.
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('closes only the confirmation on Escape, sends the key no further, and puts the focus back on the button that asked (reviewer, 11 November)', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Delete the saved list' }));
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      await user.keyboard('{Escape}');
    } finally {
      window.removeEventListener('keydown', reached);
    }
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(reached).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete the saved list' })).toHaveFocus();
  });

  it('lets Escape through when no confirmation is open, for the dialog around the view to take', async () => {
    const user = await open();
    await user.click(screen.getByRole('textbox'));
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      await user.keyboard('{Escape}');
    } finally {
      window.removeEventListener('keydown', reached);
    }
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('deletes it when the person confirms, tells the page what applies now, and says so', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Delete the saved list' }));
    await user.click(screen.getByRole('button', { name: 'Delete the list' }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledWith([]);
    expect(screen.getByRole('status')).toHaveTextContent('The saved list was deleted. No list is saved now.');
  });

  it('says that the list the portal started with applies again, when there is one', async () => {
    remove.mockResolvedValueOnce({ recipients: ['start@example.org'], removed: 2 });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Delete the saved list' }));
    await user.click(screen.getByRole('button', { name: 'Delete the list' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The list the portal started with applies again (1 person).');
    expect(onChanged).toHaveBeenCalledWith(['start@example.org']);
  });

  it('says that nothing was deleted when the list in use is the one the portal started with', async () => {
    remove.mockResolvedValueOnce({ recipients: SAVED, removed: 0 });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Delete the saved list' }));
    await user.click(screen.getByRole('button', { name: 'Delete the list' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The portal has no saved list of its own, so nothing was deleted. The list it started with is the one in use.');
  });

  it('shows the portal’s sentence when the schedule still needs the list, and leaves it alone', async () => {
    remove.mockRejectedValueOnce(new HttpFailure('The monthly schedule sends to this list, and nothing else says who gets the report. Turn the schedule off, or save another list, first.', 409, true));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Delete the saved list' }));
    await user.click(screen.getByRole('button', { name: 'Delete the list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The monthly schedule sends to this list');
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('a failure with no words of the portal', () => {
  const MAYBE = 'The list may or may not have changed: close this window and open it again to see what it holds.';

  it('says that the portal did not answer, and that the list may have changed', async () => {
    save.mockRejectedValueOnce(new HttpFailure('/api/sli/recipients: HTTP 502', 502, false));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Remove carla@example.org from the saved list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`The portal did not answer (HTTP 502). ${MAYBE}`);
  });

  it('says that the connection broke, and that the list may have changed', async () => {
    remove.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Delete the saved list' }));
    await user.click(screen.getByRole('button', { name: 'Delete the list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`The portal could not be reached, or the connection broke while it worked. ${MAYBE}`);
  });
});

describe('when the dialog turns the view off', () => {
  it('keeps every control off, and the button that opens the view on', async () => {
    const user = await open({ disabled: true });
    expect(toggle()).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Add an address to the saved list' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove carla@example.org from the saved list' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete the saved list' })).toBeDisabled();
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('while a change is under way', () => {
  it('keeps every button off, says it is working, and brings them back after', async () => {
    let finish!: (v: { recipients: string[]; saved: number }) => void;
    save.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Remove carla@example.org from the saved list' }));
    for (const b of within(document.getElementById(toggle().getAttribute('aria-controls')!)!).getAllByRole('button')) expect(b).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Add an address to the saved list' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    finish({ recipients: ['dewi@example.org'], saved: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled());
  });

  it('sends one change at a time, whatever is pressed meanwhile', async () => {
    let finish!: (v: { recipients: string[]; saved: number }) => void;
    save.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Remove carla@example.org from the saved list' }));
    await user.click(screen.getByRole('button', { name: 'Remove dewi@example.org from the saved list' }));
    expect(save).toHaveBeenCalledTimes(1);
    finish({ recipients: ['dewi@example.org'], saved: 1 });
  });

  it('puts the focus back on the button that opens the view, since the button that was pressed is gone', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Remove carla@example.org from the saved list' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toggle()).toHaveFocus();
  });
});
