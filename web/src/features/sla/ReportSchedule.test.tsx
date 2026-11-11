import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, HttpFailure } from '../../api';
import { UnreadableAnswer } from '../../guards';
import type { EmailInfo, ScheduleInfo, SendRecord } from '../../types';
import { formatDateTime } from '../../shared/lib/time';
import ReportSchedule, { sendLine } from './ReportSchedule';
import { REPORT_STYLE_KEY } from './reportStyle';

/**
 * The Schedule button and its dialog: what it shows before anything is changed, what a save sends, and what the person is told
 * about the next send and the last ones. The BFF is a stand-in; its own tests hold the other half. Every address is made up.
 */

const mail: EmailInfo = { enabled: true, from: 'portal.reports@example.com', recipients: ['ana@example.org'], max: 10, allowedDomains: [], kept: true };

const settings = (over: Partial<NonNullable<ScheduleInfo['schedule']>> = {}): NonNullable<ScheduleInfo['schedule']> => ({
  enabled: true,
  day: 5,
  time: '08:30',
  formats: ['pdf', 'csv'],
  style: { decimal: 'comma', date: 'iso', separator: 'semicolon' },
  notify: ['boss@example.org'],
  setBy: 'ana',
  setAt: 1_800_000_000,
  ...over,
});
const record = (over: Partial<SendRecord> = {}): SendRecord => ({
  month: '2026-10',
  trigger: 'schedule',
  by: 'schedule',
  at: 1_793_664_600,
  outcome: 'sent',
  attempts: 1,
  formats: ['pdf'],
  recipients: 2,
  refused: 0,
  bytes: 1000,
  ...over,
});
const base = (over: Partial<ScheduleInfo> = {}): ScheduleInfo => ({
  available: true,
  why: '',
  timezone: 'Asia/Jakarta',
  schedule: null,
  recipients: ['ana@example.org', 'budi@example.org'],
  next: null,
  sends: [],
  max: 10,
  maxNotify: 3,
  allowedDomains: [],
  ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let read: MockInstance<typeof api.sliSchedule>;
let save: MockInstance<typeof api.sliScheduleSave>;

beforeEach(() => {
  localStorage.clear();
  read = vi.spyOn(api, 'sliSchedule').mockResolvedValue(base());
  save = vi.spyOn(api, 'sliScheduleSave').mockResolvedValue(base());
});
afterEach(() => vi.restoreAllMocks());

const button = () => screen.getByRole('button', { name: 'Schedule' });
async function open(info: ScheduleInfo = base(), onSaved?: () => void) {
  read.mockResolvedValue(info);
  const user = userEvent.setup();
  render(<ReportSchedule info={mail} onSaved={onSaved} />);
  await user.click(button());
  const dialog = await screen.findByRole('dialog', { name: 'Send the SLA report every month' });
  await within(dialog).findByRole('checkbox', { name: 'Send the report every month' });
  return { user, dialog };
}
const field = (dialog: HTMLElement, name: string) => within(dialog).getByRole('textbox', { name });
const when = (seconds: number, tz = 'Asia/Jakarta') => formatDateTime(seconds * 1000, tz);

describe('the button', () => {
  it('is a small ghost button that opens a dialog, and reads nothing until it is pressed', () => {
    render(<ReportSchedule info={mail} />);
    expect(button()).toHaveClass('btn', 'ghost', 'sm');
    expect(button()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('reads the schedule when it is pressed, and says so while it waits', async () => {
    const pending = deferred<ScheduleInfo>();
    read.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<ReportSchedule info={mail} />);
    await user.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Send the SLA report every month' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Reading the schedule…');
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(base()));
    expect(await within(dialog).findByRole('checkbox', { name: 'Send the report every month' })).toBeInTheDocument();
  });

  it('stays one dialog from the press to the form: the same element, and no second one announced', async () => {
    const pending = deferred<ScheduleInfo>();
    read.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<ReportSchedule info={mail} />);
    await user.click(button());
    const reading = await screen.findByRole('dialog', { name: 'Send the SLA report every month' });
    await act(async () => pending.resolve(base()));
    await within(reading).findByRole('checkbox', { name: 'Send the report every month' });
    expect(screen.getAllByRole('dialog')).toEqual([reading]);
  });

  it('says when it could not read the schedule, in the BFF’s words, and tries again when asked', async () => {
    read.mockRejectedValueOnce(new Error('The portal could not read its state.'));
    const user = userEvent.setup();
    render(<ReportSchedule info={mail} />);
    await user.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Send the SLA report every month' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The portal could not read its state.');

    read.mockResolvedValue(base());
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('checkbox', { name: 'Send the report every month' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('says the portal could not be reached when the request never got there', async () => {
    read.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<ReportSchedule info={mail} />);
    await user.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent('The portal could not be reached. Check the connection and try again.');
  });
});

describe('a read of the schedule that fails', () => {
  it('says that the portal did not answer, and does not say that anything was saved, when nginx answers and not the BFF', async () => {
    read.mockRejectedValue(new HttpFailure('/api/sli/schedule: HTTP 502', 502, false));
    const user = userEvent.setup();
    render(<ReportSchedule info={mail} />);
    await user.click(button());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The portal did not answer (HTTP 502). Try again in a minute.');
    expect(alert).not.toHaveTextContent(/saved/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says that the answer could not be read, and does not say that anything was saved', async () => {
    read.mockRejectedValue(new UnreadableAnswer('/api/sli/schedule', 'the schedule', 'enabled: not true or false'));
    const user = userEvent.setup();
    render(<ReportSchedule info={mail} />);
    await user.click(button());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('in a form this page cannot read');
    expect(alert).not.toHaveTextContent(/was saved/);
  });
});

describe('a schedule not set yet', () => {
  it('starts on the first of the month at midnight, with the PDF, to the saved list, in the style chosen for downloads', async () => {
    localStorage.setItem(REPORT_STYLE_KEY, JSON.stringify({ decimal: 'comma', date: 'numeric', separator: 'comma' }));
    const { dialog } = await open();
    expect(within(dialog).getByRole('checkbox', { name: 'Send the report every month' })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Day of the month' })).toHaveValue('1');
    expect(within(dialog).getByLabelText('Time of day')).toHaveValue('00:00');
    expect(within(dialog).getByRole('checkbox', { name: 'PDF' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Excel' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'CSV (a zip of files)' })).not.toBeChecked();
    expect(field(dialog, 'Send to')).toHaveValue('ana@example.org\nbudi@example.org');
    expect(field(dialog, 'If a send fails, also tell')).toHaveValue('');
    expect(within(dialog).getByRole('combobox', { name: 'Decimal mark' })).toHaveValue('comma');
    expect(within(dialog).getByRole('combobox', { name: 'Dates' })).toHaveValue('numeric');
  });

  it('says that nothing goes by itself yet', async () => {
    const { dialog } = await open();
    expect(dialog).toHaveTextContent('No schedule is set. The report goes only when someone presses Email report.');
  });

  it('names the time zone and the sender, and what the portal needs to send', async () => {
    const { dialog } = await open();
    expect(dialog).toHaveTextContent('Times are in Asia/Jakarta. Sent from portal.reports@example.com.');
    expect(dialog).toHaveTextContent('Sends only while the portal runs and can reach Zabbix. A send that fails is tried again for a week.');
  });

  it('explains the day and the time, and the wait of ten minutes', async () => {
    const { dialog } = await open();
    expect(dialog).toHaveTextContent('Days 29 to 31 are left out, so that every month has the day.');
    expect(dialog).toHaveTextContent('The portal waits ten minutes after this, so that Zabbix has the last values of the month.');
    expect(within(dialog).getByRole('combobox', { name: 'Day of the month' }).querySelectorAll('option')).toHaveLength(28);
  });

  it('says how many people may be listed and told, and which domains', async () => {
    const { dialog } = await open(base({ allowedDomains: ['example.org', 'hcml.co.id'] }));
    expect(dialog).toHaveTextContent('Up to 10 addresses, one on each line or separated by commas.');
    expect(dialog).toHaveTextContent('Only addresses at example.org or hcml.co.id are accepted.');
    expect(dialog).toHaveTextContent(
      'Up to 3 addresses. They are told once after the third failed try, once when the portal gives up, and once when the mail server refuses some of the addresses.',
    );
    expect(dialog).toHaveTextContent('The same list is the one the Email report button starts with.');
  });
});

describe('a schedule that is set', () => {
  it('shows what is saved, and when the next send is', async () => {
    const { dialog } = await open(base({ schedule: settings(), next: { month: '2026-10', at: 1_793_664_600, retrying: false } }));
    expect(within(dialog).getByRole('checkbox', { name: 'Send the report every month' })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Day of the month' })).toHaveValue('5');
    expect(within(dialog).getByLabelText('Time of day')).toHaveValue('08:30');
    expect(within(dialog).getByRole('checkbox', { name: 'PDF' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Excel' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'CSV (a zip of files)' })).toBeChecked();
    expect(field(dialog, 'If a send fails, also tell')).toHaveValue('boss@example.org');
    expect(within(dialog).getByRole('combobox', { name: 'Decimal mark' })).toHaveValue('comma');
    expect(within(dialog).getByRole('combobox', { name: 'Dates' })).toHaveValue('iso');
    expect(within(dialog).getByRole('combobox', { name: 'CSV separator' })).toHaveValue('semicolon');
    expect(dialog).toHaveTextContent(`Next send: the report for October 2026, on ${when(1_793_664_600)}.`);
  });

  it('says a send is waiting to be tried again when one failed', async () => {
    const { dialog } = await open(base({ schedule: settings(), next: { month: '2026-10', at: 1_793_664_600, retrying: true } }));
    expect(dialog).toHaveTextContent(`The report for October 2026 has not gone yet. The portal tries again at ${when(1_793_664_600)}.`);
  });

  it('says it is off, and keeps the rest of the settings to look at', async () => {
    const { dialog } = await open(base({ schedule: settings({ enabled: false }), next: null }));
    expect(within(dialog).getByRole('checkbox', { name: 'Send the report every month' })).not.toBeChecked();
    expect(dialog).toHaveTextContent('The schedule is off. The report goes only when someone presses Email report.');
    expect(within(dialog).getByRole('combobox', { name: 'Day of the month' })).toHaveValue('5');
  });

  it('lists the last sends, newest first as the BFF gave them, one line each', async () => {
    const { dialog } = await open(
      base({
        schedule: settings(),
        sends: [record({ month: '2026-10' }), record({ month: '2026-09', trigger: 'manual', by: 'ana', formats: ['pdf', 'xlsx'], recipients: 1 })],
      }),
    );
    const items = within(dialog).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('October 2026: sent');
    expect(items[1]).toContain('September 2026: sent');
    expect(items[1]).toContain('by ana');
    expect(within(dialog).getByText('Last sends')).toBeInTheDocument();
  });

  it('lists no sends when there have been none', async () => {
    const { dialog } = await open(base({ schedule: settings() }));
    expect(within(dialog).queryByText('Last sends')).toBeNull();
    expect(within(dialog).queryByRole('listitem')).toBeNull();
  });
});

describe('where it cannot run', () => {
  const off = base({ available: false, why: 'The portal has no data folder to keep a schedule in. An administrator sets PORTAL_STATE_DIR to a folder that outlives the container.' });

  it('says why, in a notice, and shuts every field and the save', async () => {
    const { dialog } = await open(off);
    const notice = within(dialog).getByText(/The portal has no data folder to keep a schedule in/);
    expect(notice).toHaveClass('notice', 'warn');
    for (const box of within(dialog).getAllByRole('checkbox')) expect(box).toBeDisabled();
    for (const box of within(dialog).getAllByRole('textbox')) expect(box).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(dialog).not.toHaveTextContent('Next send');
  });

  it('can still be closed', async () => {
    const { user, dialog } = await open(off);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });
});

describe('saving', () => {
  it('sends what the form holds, with the addresses split however they were separated, and says it is saved', async () => {
    const saved = base({ schedule: settings({ day: 12, time: '07:45' }), next: { month: '2026-10', at: 1_793_664_600, retrying: false } });
    save.mockResolvedValue(saved);
    const { user, dialog } = await open();
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Day of the month' }), '12');
    const time = within(dialog).getByLabelText('Time of day');
    await user.clear(time);
    await user.type(time, '07:45');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Excel' }));
    const to = field(dialog, 'Send to');
    await user.clear(to);
    await user.type(to, 'cici@example.org; dedi@example.org{enter}eka@example.org');
    await user.type(field(dialog, 'If a send fails, also tell'), 'boss@example.org, chief@example.org');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Decimal mark' }), 'comma');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(save).toHaveBeenCalledWith({
      enabled: true,
      day: 12,
      time: '07:45',
      formats: ['pdf', 'xlsx'],
      recipients: ['cici@example.org', 'dedi@example.org', 'eka@example.org'],
      notify: ['boss@example.org', 'chief@example.org'],
      style: { decimal: 'comma', date: 'long', separator: 'comma' },
    });
    await waitFor(() => expect(within(dialog).getByRole('status', { name: '' })).toBeInTheDocument());
    await waitFor(() => expect(dialog).toHaveTextContent(`Saved. Next send: the report for October 2026, on ${when(1_793_664_600)}.`));
  });

  it('tells the page once the BFF has kept the schedule, so the Email report box starts from the new list', async () => {
    const onSaved = vi.fn();
    const { user, dialog } = await open(base(), onSaved);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).toHaveTextContent('Saved.'));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not tell the page when the BFF refused the schedule', async () => {
    const onSaved = vi.fn();
    save.mockRejectedValue(new Error('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).'));
    const { user, dialog } = await open(base(), onSaved);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await within(dialog).findByRole('alert');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says that the portal did not answer, and that the schedule may not have been saved, when nginx answers and not the BFF', async () => {
    save.mockRejectedValue(new HttpFailure('/api/sli/schedule: HTTP 502', 502, false));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('The portal did not answer (HTTP 502). The schedule may not have been saved: close this window and open Schedule again to see what it holds.');
    expect(alert).not.toHaveTextContent('/api/sli/schedule');
  });

  it('says that the schedule was saved when the answer could not be read', async () => {
    save.mockRejectedValue(new UnreadableAnswer('/api/sli/schedule', 'the schedule', 'enabled: not true or false'));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("The schedule was saved, but this page could not read the portal's answer. Reload the page to see it.");
  });

  it('does not tell the page for a save that was stopped before it was asked', async () => {
    const onSaved = vi.fn();
    const { user, dialog } = await open(base(), onSaved);
    await user.clear(field(dialog, 'Send to'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await within(dialog).findByRole('alert');
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows what the BFF kept, which may differ from what was typed', async () => {
    save.mockResolvedValue(base({ schedule: settings({ formats: ['pdf'] }), recipients: ['ana@example.org'] }));
    const { user, dialog } = await open();
    const to = field(dialog, 'Send to');
    await user.clear(to);
    await user.type(to, 'ana@example.org, ANA@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).toHaveTextContent('Saved.'));
    expect(to).toHaveValue('ana@example.org');
    expect(within(dialog).getByRole('combobox', { name: 'Day of the month' })).toHaveValue('5');
  });

  it('clears the word Saved as soon as anything is changed again', async () => {
    save.mockResolvedValue(base({ schedule: settings(), next: { month: '2026-10', at: 1_793_664_600, retrying: false } }));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).toHaveTextContent('Saved.'));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Excel' }));
    expect(dialog).not.toHaveTextContent('Saved.');
  });

  it('can be turned off and saved with nobody to send to, since nothing will go', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Send the report every month' }));
    await user.clear(field(dialog, 'Send to'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, recipients: [] }));
  });

  it('asks for an address while the schedule is on, before it asks the BFF', async () => {
    const { user, dialog } = await open();
    await user.clear(field(dialog, 'Send to'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Add at least one address to send to.');
    expect(save).not.toHaveBeenCalled();
  });

  it('asks for a file, before it asks the BFF', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'PDF' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose at least one file.');
    expect(save).not.toHaveBeenCalled();
  });

  it('asks for a time of day, before it asks the BFF', async () => {
    const { user, dialog } = await open();
    await user.clear(within(dialog).getByLabelText('Time of day'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Set the time of day, such as 00:00.');
    expect(save).not.toHaveBeenCalled();
  });

  it('shows the BFF’s own sentence when it refuses, and keeps what was typed', async () => {
    save.mockRejectedValue(new Error('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).'));
    const { user, dialog } = await open();
    const to = field(dialog, 'Send to');
    await user.clear(to);
    await user.type(to, 'spy@elsewhere.net');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).');
    expect(to).toHaveValue('spy@elsewhere.net');
    expect(dialog).not.toHaveTextContent('Saved.');
  });

  it('says the portal could not be reached, and gives a plain sentence when the failure carried no words', async () => {
    save.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // The connection may also have broken after the portal had the request, so it does not say "try again".
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The portal could not be reached, or the connection broke while it worked. The schedule may not have been saved: close this window and open Schedule again to see what it holds.',
    );
    save.mockRejectedValueOnce(new Error(''));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('The schedule was not saved. Try again.'));
  });

  it('works while it works: the button says so, nothing else can be pressed, Escape waits, and a second press sends nothing more', async () => {
    const pending = deferred<ScheduleInfo>();
    save.mockReturnValue(pending.promise);
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const working = within(dialog).getByRole('button', { name: 'Saving…' });
    expect(working).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    for (const box of within(dialog).getAllByRole('checkbox')) expect(box).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(working);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(base({ schedule: settings() })));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled());
  });

  it('does not touch the page if it goes away before the answer', async () => {
    const pending = deferred<ScheduleInfo>();
    save.mockReturnValue(pending.promise);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const { unmount } = render(<ReportSchedule info={mail} />);
    await user.click(button());
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    unmount();
    await act(async () => pending.resolve(base()));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('what the person sees after pressing Save', () => {
  // The foot with the Save button stays in view while the body scrolls, so the answer is brought to the person.
  const reveal = vi.fn();
  beforeEach(() => {
    reveal.mockClear();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: reveal, configurable: true, writable: true });
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
  const lastRevealed = () => reveal.mock.contexts[reveal.mock.contexts.length - 1] as HTMLElement | undefined;

  it('brings the line that says it is saved into view', async () => {
    save.mockResolvedValue(base({ schedule: settings() }));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).toHaveTextContent('Saved.'));
    expect(lastRevealed()).toHaveTextContent(/^Saved\./);
  });

  it('brings a refusal into view', async () => {
    save.mockRejectedValue(new Error('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).'));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const alert = await within(dialog).findByRole('alert');
    expect(lastRevealed()).toBe(alert);
  });

  it('moves nothing before anything is pressed', async () => {
    await open();
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe('closing it', () => {
  it('closes with Close and with Escape, and gives the focus back to the button', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
    await user.click(button());
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('puts the focus on the switch when it opens', async () => {
    const { dialog } = await open();
    expect(within(dialog).getByRole('checkbox', { name: 'Send the report every month' })).toHaveFocus();
  });
});

describe('sendLine, the words for one send', () => {
  const tz = 'Asia/Jakarta';
  const at = 1_793_664_600;

  it('says a send went, when, by whom, in which files and to how many people', () => {
    expect(sendLine(record({ formats: ['pdf', 'xlsx', 'csv'], recipients: 3 }), tz)).toBe(`October 2026: sent ${when(at)} by the schedule, the PDF, the Excel file and the CSV zip to 3 people.`);
    expect(sendLine(record({ trigger: 'manual', by: 'ana', recipients: 1 }), tz)).toBe(`October 2026: sent ${when(at)} by ana, the PDF to 1 person.`);
  });

  it('says how many addresses the mail server refused, only when some', () => {
    expect(sendLine(record({ refused: 2 }), tz)).toContain(', 2 refused.');
    expect(sendLine(record({ refused: 0 }), tz)).not.toContain('refused');
  });

  it('says a send is still being tried, how many times so far, and why it failed', () => {
    expect(sendLine(record({ outcome: 'sending', attempts: 1, reason: 'connect' }), tz)).toBe(
      `October 2026: not sent yet, 1 try so far (the mail server could not be reached). Last try ${when(at)}.`,
    );
    expect(sendLine(record({ outcome: 'sending', attempts: 3, reason: 'zabbix' }), tz)).toContain('3 tries so far (Zabbix could not be read)');
  });

  it('says a send was given up on because the schedule was changed, and that is all it says', () => {
    expect(sendLine(record({ outcome: 'failed', attempts: 2, reason: 'changed' }), tz)).toContain('the schedule was changed');
  });

  it('says a send was given up on, and why', () => {
    expect(sendLine(record({ outcome: 'failed', attempts: 7, reason: 'login' }), tz)).toBe(`October 2026: not sent (the mail login was refused). The last try was ${when(at)} by the schedule.`);
  });

  it('says a month was missed, with no time', () => {
    expect(sendLine(record({ outcome: 'missed', attempts: 0, reason: 'not running' }), tz)).toBe('October 2026: missed. The portal was not running in the week after it was due.');
  });

  it('leaves out a reason it does not know, rather than print a code', () => {
    expect(sendLine(record({ outcome: 'failed', reason: 'quantum' }), tz)).not.toContain('quantum');
    expect(sendLine(record({ outcome: 'failed' }), tz)).toBe(`October 2026: not sent. The last try was ${when(at)} by the schedule.`);
  });

  it.each(['login', 'connect', 'timeout', 'tls', 'recipients', 'rejected', 'other', 'zabbix', 'error'])('has words for the reason %s', (reason) => {
    expect(sendLine(record({ outcome: 'failed', reason }), tz)).toMatch(/not sent \(/);
  });

  it('writes the moment in the zone the report is in', () => {
    expect(sendLine(record(), 'UTC')).toContain(when(at, 'UTC'));
    expect(when(at, 'UTC')).not.toBe(when(at, 'Asia/Jakarta'));
  });
});

describe('the saved list view in the Schedule dialog (FR-31)', () => {
  const view = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: /Saved list/ });
  let savedList: MockInstance<typeof api.sliRecipientsSave>;
  beforeEach(() => {
    savedList = vi.spyOn(api, 'sliRecipientsSave').mockImplementation(async (list) => ({ recipients: list, saved: list.length }));
  });

  it('sits under the box of recipients, closed, with the number of people saved', async () => {
    const { dialog } = await open();
    expect(view(dialog)).toHaveTextContent('Saved list (2 people)');
    expect(view(dialog)).toHaveAttribute('aria-expanded', 'false');
  });

  it('changes the box with the saved list, when the box held the saved list, and tells the page to look again', async () => {
    const onSaved = vi.fn();
    const { user, dialog } = await open(base(), onSaved);
    await user.click(view(dialog));
    await user.click(within(dialog).getByRole('button', { name: 'Remove ana@example.org from the saved list' }));
    await waitFor(() => expect(savedList).toHaveBeenCalledWith(['budi@example.org']));
    await waitFor(() => expect(field(dialog, 'Send to')).toHaveValue('budi@example.org'));
    expect(onSaved).toHaveBeenCalledTimes(1);
    // The view holds the list as it is now, so a second change starts from it.
    expect(view(dialog)).toHaveTextContent('Saved list (1 person)');
  });

  it('leaves the box alone when the person had edited it', async () => {
    const { user, dialog } = await open();
    const box = field(dialog, 'Send to');
    await user.clear(box);
    await user.type(box, 'zed@example.org');
    await user.click(view(dialog));
    await user.click(within(dialog).getByRole('button', { name: 'Remove ana@example.org from the saved list' }));
    await waitFor(() => expect(savedList).toHaveBeenCalled());
    expect(box).toHaveValue('zed@example.org');
  });

  it('does not change the schedule: a Save afterwards sends the schedule as it was set, with the box as it is', async () => {
    const { user, dialog } = await open(base({ schedule: settings() }));
    await user.click(view(dialog));
    await user.click(within(dialog).getByRole('button', { name: 'Remove ana@example.org from the saved list' }));
    await waitFor(() => expect(field(dialog, 'Send to')).toHaveValue('budi@example.org'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toMatchObject({ day: 5, time: '08:30', recipients: ['budi@example.org'] });
  });

  it('is off when the schedule cannot be changed on this machine', async () => {
    const { user, dialog } = await open(base({ available: false, why: 'Email is not set up.' }));
    await user.click(view(dialog));
    expect(within(dialog).getByRole('button', { name: 'Remove ana@example.org from the saved list' })).toBeDisabled();
  });
});

