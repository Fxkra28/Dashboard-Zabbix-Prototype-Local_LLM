import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, HttpFailure } from '../../api';
import AckDialog from './AckDialog';
import type { Freshness, Problem } from '../../types';
import { problem } from '../../__tests__/problems';

/**
 * The warning before a write goes to a Zabbix that has stopped collecting. A stopped zabbix-server
 * leaves every API call working, so a close is accepted and never applied; the dialog says so first.
 */
const fresh: Freshness = { lastCollectedAt: 1_799_999_960, ageSeconds: 40, stale: false, staleAfterSeconds: 600, pinged: 0, answering: 0, reachLost: false };
const stopped: Freshness = { lastCollectedAt: 1_799_995_680, ageSeconds: 4_320, stale: true, staleAfterSeconds: 600, pinged: 0, answering: 0, reachLost: false };

afterEach(() => vi.restoreAllMocks());

function open(freshness: Promise<Freshness> | Freshness | Error) {
  vi.spyOn(api, 'freshness').mockImplementation(() =>
    freshness instanceof Error ? Promise.reject(freshness) : Promise.resolve(freshness),
  );
  vi.spyOn(api, 'acknowledge').mockResolvedValue({ ok: true, eventids: ['1'], action: 6 });
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<AckDialog problem={problem(1, 4, 600, { manualClose: true })} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}
const warning = () => screen.queryByText(/Zabbix has collected nothing since/);

describe('AckDialog and a Zabbix that has stopped collecting', () => {
  it('says when it last collected and how long ago, before anything is sent', async () => {
    open(stopped);
    expect(await screen.findByText(/Zabbix has collected nothing since .+ \(1 h 12 min ago\)\./)).toBeInTheDocument();
    expect(screen.getByText(/A change you send now may not be applied until it collects again\./)).toBeInTheDocument();
    expect(api.acknowledge).not.toHaveBeenCalled();
  });

  it('is a status the screen reader announces, in the notice style the portal already has', async () => {
    open(stopped);
    const note = await screen.findByRole('status');
    expect(note).toHaveClass('notice', 'warn');
    expect(note).toHaveTextContent('Zabbix has collected nothing since');
  });

  it('warns and does not block: Confirm still sends', async () => {
    const { onDone, onClose } = open(stopped);
    await screen.findByText(/Zabbix has collected nothing since/);
    await userEvent.click(screen.getByRole('checkbox', { name: /Close problem/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ acknowledge: true, close: true }));
    expect(api.acknowledge).toHaveBeenCalledWith({ eventids: ['1'], message: undefined, acknowledge: true, close: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('asks once, when it opens', async () => {
    open(stopped);
    await screen.findByText(/Zabbix has collected nothing since/);
    expect(api.freshness).toHaveBeenCalledTimes(1);
  });

  it('is silent while Zabbix is collecting', async () => {
    open(fresh);
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    await screen.findByRole('dialog');
    expect(warning()).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is silent when the check fails, and the dialog still works', async () => {
    const { onDone } = open(new Error('Failed to fetch'));
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(warning()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says nothing when the portal cannot tell when Zabbix last collected', async () => {
    open({ lastCollectedAt: null, ageSeconds: null, stale: false, staleAfterSeconds: 600, pinged: 0, answering: 0, reachLost: false });
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    expect(warning()).toBeNull();
    // Even a stale flag with no time to name is not shown: there is nothing true to say.
    open({ lastCollectedAt: null, ageSeconds: null, stale: true, staleAfterSeconds: 600, pinged: 0, answering: 0, reachLost: false });
    await waitFor(() => expect(api.freshness).toHaveBeenCalledTimes(2));
    expect(warning()).toBeNull();
  });

  it('does not touch the page once it is closed before the answer comes', async () => {
    let answer!: (f: Freshness) => void;
    vi.spyOn(api, 'freshness').mockReturnValue(new Promise<Freshness>((resolve) => (answer = resolve)));
    const view = render(<AckDialog problem={problem(1, 4, 600)} onClose={() => undefined} onDone={() => undefined} />);
    view.unmount();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answer(stopped);
    await Promise.resolve();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('AckDialog and the name on the message', () => {
  it('tells the user their name goes on the message, since the server adds it (SC-08)', async () => {
    open(fresh);
    expect(await screen.findByText(/with your name on the message/)).toBeInTheDocument();
  });
});

describe('AckDialog and the length of the message (reviewer, 11 November)', () => {
  it('leaves room for the tag the server puts first, so the end of a long note is never cut off unseen', async () => {
    open(fresh);
    // Zabbix keeps 2048 characters; the portal's tag is at most 74 of them (a name of 64, the brackets, the word and a space).
    expect(await screen.findByLabelText(/Message/)).toHaveAttribute('maxlength', String(2048 - 74));
  });
});

describe('AckDialog and a close, which the portal cannot take back', () => {
  it('turns Confirm into the danger button while Close problem is ticked, and back when it is not', async () => {
    open(fresh);
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).not.toHaveClass('danger');
    await userEvent.click(screen.getByRole('checkbox', { name: /Close problem/ }));
    expect(confirm).toHaveClass('btn', 'sm', 'danger');
    await userEvent.click(screen.getByRole('checkbox', { name: /Close problem/ }));
    expect(confirm).not.toHaveClass('danger');
  });
});

/** An acknowledgement the test answers by hand. */
function pending(extra: Partial<Problem> = {}) {
  let answer!: (r: { ok: true; eventids: string[]; action: number }) => void;
  let fail!: (e: Error) => void;
  vi.spyOn(api, 'freshness').mockResolvedValue(fresh);
  vi.spyOn(api, 'acknowledge').mockImplementation(() => new Promise((resolve, reject) => ((answer = resolve), (fail = reject))));
  const onClose = vi.fn();
  const onDone = vi.fn();
  const view = render(<AckDialog problem={problem(1, 4, 600, { manualClose: true, ...extra })} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone, view, answer: (id = '1') => answer({ ok: true, eventids: [id], action: 6 }), fail: (e: Error | string) => fail(typeof e === 'string' ? new Error(e) : e) };
}
const confirmButton = () => screen.getByRole('button', { name: /Confirm|Sending/ });
// The dialog is drawn on the page, outside the container the test renders into (UX-46).
const overlay = () => document.querySelector('.drawer-overlay') as HTMLElement;

describe('AckDialog closed before Zabbix answers (FR-24)', () => {

  it('closes itself when the answer comes, as before', async () => {
    const { onClose, onDone, answer } = pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    answer();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ acknowledge: true, close: false }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still tells the page what was sent when the dialog was closed meanwhile, but does not close the dialog of another problem', async () => {
    const { onClose, onDone, view, answer } = pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    // The cross, and then the page opens another problem's dialog.
    view.unmount();
    answer();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ acknowledge: true, close: false }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a failure to a dialog that is still open, and does not tell the page the problem was acknowledged', async () => {
    const open = pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    open.fail('Zabbix said no');
    expect(await screen.findByText(/Zabbix said no/)).toBeInTheDocument();
    expect(open.onDone).not.toHaveBeenCalled();
  });

  it('lets a failure reach a dialog that has gone without an error or a report to the page', async () => {
    const gone = pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    gone.view.unmount();
    const complaint = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    gone.fail('Zabbix said no');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(complaint).not.toHaveBeenCalled();
    expect(gone.onDone).not.toHaveBeenCalled();
    expect(gone.onClose).not.toHaveBeenCalled();
    complaint.mockRestore();
  });
});

describe('AckDialog while a request is out (FR-33)', () => {
  it('turns Confirm off and says it is sending', async () => {
    pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).toHaveTextContent('Sending');
  });

  it('turns the cross and Cancel off, so the dialog cannot be left with the answer still to come', async () => {
    pending();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('turns them on again after a failure, so the person can try again or leave', async () => {
    const dialog = pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    dialog.fail('Zabbix said no');
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('ignores Escape while sending, and closes on Escape otherwise', async () => {
    const dialog = pending();
    await userEvent.keyboard('{Escape}');
    expect(dialog.onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await userEvent.keyboard('{Escape}');
    expect(dialog.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AckDialog and the backdrop (UX-08)', () => {
  it('closes on a click outside the dialog when nothing was typed', () => {
    const dialog = pending();
    fireEvent.click(overlay());
    expect(dialog.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog on a click outside it when a message was typed, so the words are not thrown away', async () => {
    const dialog = pending();
    await userEvent.type(screen.getByLabelText(/Message/), 'I am on it');
    fireEvent.click(overlay());
    expect(dialog.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Message/)).toHaveValue('I am on it');
  });

  it('ignores a click outside it while sending', async () => {
    const dialog = pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    fireEvent.click(overlay());
    expect(dialog.onClose).not.toHaveBeenCalled();
  });

  it('does not close on a click inside the dialog', async () => {
    const dialog = pending();
    await userEvent.click(screen.getByRole('dialog'));
    expect(dialog.onClose).not.toHaveBeenCalled();
  });
});

describe('AckDialog after a failure', () => {
  it('puts the cursor back in the message box, since Confirm was off and focus had gone to the page', async () => {
    const dialog = pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    dialog.fail('Zabbix said no');
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/Message/)).toHaveFocus();
  });

  it('keeps what was typed, and clears the failure when it is sent again', async () => {
    const dialog = pending();
    await userEvent.type(screen.getByLabelText(/Message/), 'checked the link');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    dialog.fail('Zabbix said no');
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/Message/)).toHaveValue('checked the link');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AckDialog with nothing to send', () => {
  it('keeps Confirm off until something is ticked or written', async () => {
    pending();
    await userEvent.click(screen.getByRole('checkbox', { name: /Acknowledge/ }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Message/), 'a note');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    await userEvent.clear(screen.getByLabelText(/Message/));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Close problem/ }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('counts a message of only spaces as nothing', async () => {
    pending();
    await userEvent.click(screen.getByRole('checkbox', { name: /Acknowledge/ }));
    await userEvent.type(screen.getByLabelText(/Message/), '   ');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('sends nothing when it is submitted with the keyboard in that state', async () => {
    pending();
    await userEvent.click(screen.getByRole('checkbox', { name: /Acknowledge/ }));
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(api.acknowledge).not.toHaveBeenCalled();
  });
});

describe('AckDialog and a problem that is already acknowledged', () => {
  it('starts with Acknowledge ticked for a problem that is not, and says nothing about it', () => {
    pending();
    const box = screen.getByRole('checkbox', { name: /Acknowledge/ });
    expect(box).toBeChecked();
    expect(screen.queryByText(/already acknowledged/)).toBeNull();
  });

  it('starts with it unticked for one that is, and says so', () => {
    pending({ acknowledged: '1' });
    expect(screen.getByRole('checkbox', { name: /Acknowledge/ })).not.toBeChecked();
    expect(screen.getByText(/already acknowledged/)).toBeInTheDocument();
  });

  it('then wants a close or a message before it will send', async () => {
    pending({ acknowledged: '1' });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Close problem/ }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});

describe('AckDialog and what it says about a failure (FR-32)', () => {
  const MAYBE = 'The change may or may not have been made: look at the problem again before you try it again.';
  const alertAfter = async (error: Error) => {
    const dialog = pending();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    dialog.fail(error);
    return screen.findByRole('alert');
  };

  it.each([502, 504])('says the portal did not answer (HTTP %i), and that the change may or may not have been made', async (status) => {
    const alert = await alertAfter(new HttpFailure(`/api/problems/acknowledge: HTTP ${status}`, status, false));
    expect(alert).toHaveTextContent(`The portal did not answer (HTTP ${status}). ${MAYBE}`);
    expect(alert).not.toHaveTextContent('/api/problems/acknowledge');
  });

  it('says the portal could not be reached, or the connection broke, when the request itself fails', async () => {
    const alert = await alertAfter(new TypeError('Failed to fetch'));
    expect(alert).toHaveTextContent(`The portal could not be reached, or the connection broke while it worked. ${MAYBE}`);
    expect(alert).not.toHaveTextContent('Failed to fetch');
  });

  it('shows the portal’s own sentence as it gave it, when it gave one', async () => {
    const said = 'Zabbix refused the change. It may already be closed, or this account may not be allowed to change it. Tell an administrator and quote reference abc-123.';
    const alert = await alertAfter(new HttpFailure(said, 502, true));
    expect(alert).toHaveTextContent(said);
    expect(alert.textContent).toBe(said);
  });

  it('shows the words of any other failure', async () => {
    const alert = await alertAfter(new Error('Something else'));
    expect(alert).toHaveTextContent('Something else');
  });
});

