import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, HttpFailure } from '../../api';
import { UnreadableAnswer } from '../../guards';
import EmailReport from './EmailReport';
import { REPORT_STYLE_KEY } from './reportStyle';

/**
 * The "Email report" button and its dialog: who is offered it, what it shows before anything is sent, what is sent and to
 * whom, and what the person is told after. The BFF is a stand-in; its own tests hold the other half. Every address here is made up.
 */

const auth = vi.hoisted(() => ({ role: 'admin' as string | null }));
vi.mock('../../shared/hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../../shared/hooks/useAuth')>('../../shared/hooks/useAuth');
  return { ...actual, useAuth: () => ({ me: null, role: auth.role, pages: null, loading: false }) };
});

type Info = Awaited<ReturnType<typeof api.sliEmailInfo>>;
type Sent = Awaited<ReturnType<typeof api.sliEmail>>;

const on: Info = { enabled: true, from: 'portal.reports@example.com', recipients: ['ana@example.org', 'budi@example.org'], max: 10, allowedDomains: [], kept: true };
const pdfFile = { format: 'pdf', fileName: 'HCML_SLA_Report_2026-08.pdf', bytes: 1000 } as const;
const sentTo = (sent: number, refused = 0, over: Partial<Sent> = {}): Sent => ({ sent, refused, month: '2026-08', files: [pdfFile], remembered: false, ...over });
const DEFAULT_STYLE = { decimal: 'dot', date: 'long', separator: 'comma' };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let info: MockInstance<typeof api.sliEmailInfo>;
let email: MockInstance<typeof api.sliEmail>;

beforeEach(() => {
  auth.role = 'admin';
  localStorage.clear();
  info = vi.spyOn(api, 'sliEmailInfo').mockResolvedValue(on);
  email = vi.spyOn(api, 'sliEmail').mockResolvedValue(sentTo(2));
});
afterEach(() => vi.restoreAllMocks());

const button = () => screen.findByRole('button', { name: 'Email report' });
/** The live region says what is happening, then what happened; it is there, empty, from the start. */
const said = (dialog: HTMLElement, text: string | RegExp) => waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent(text));
async function open(user = userEvent.setup(), month = '2026-08') {
  render(<EmailReport month={month} />);
  await user.click(await button());
  return { user, dialog: await screen.findByRole('dialog', { name: 'Email the SLA report' }) };
}

describe('who is offered the button', () => {
  it('an administrator, once the BFF says email is set up, in a group named for the month', async () => {
    render(<EmailReport month="2026-08" />);
    const group = await screen.findByRole('group', { name: 'Email the SLA report for August 2026, both methods' });
    const [first, second, ...others] = within(group).getAllByRole('button');
    expect(first).toHaveTextContent('Email report');
    expect(second).toHaveTextContent('Schedule');
    expect(others).toEqual([]);
    for (const b of [first, second]) {
      expect(b).toHaveClass('btn', 'ghost', 'sm');
      expect(b).toHaveAttribute('aria-haspopup', 'dialog');
    }
  });

  it.each(['viewer', 'wall', 'operator', null])('not a %s, and the BFF is not even asked', async (role) => {
    auth.role = role;
    render(<EmailReport month="2026-08" />);
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Email report' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it('nobody once the person is no longer an administrator, even with the answer already in', async () => {
    const { rerender } = render(<EmailReport month="2026-08" />);
    await button();
    auth.role = 'operator';
    rerender(<EmailReport month="2026-08" />);
    expect(screen.queryByRole('button', { name: 'Email report' })).toBeNull();
  });

  it('nobody while email is off', async () => {
    info.mockResolvedValue({ enabled: false, from: '', recipients: [], max: 10, allowedDomains: [], kept: false });
    render(<EmailReport month="2026-08" />);
    await waitFor(() => expect(info).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Email report' })).toBeNull();
  });

  it('nobody when the question could not be asked: a failed check must not get in the way', async () => {
    info.mockRejectedValue(new Error('down'));
    render(<EmailReport month="2026-08" />);
    await waitFor(() => expect(info).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is shut while the page is still loading the month', async () => {
    render(<EmailReport month="2026-08" disabled />);
    expect(await button()).toBeDisabled();
  });
});

describe('the dialog, before anything is sent', () => {
  it('names the month and the sender, and puts the saved recipients in the box, one on each line', async () => {
    const { dialog } = await open();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('August 2026, both methods')).toBeInTheDocument();
    expect(within(dialog).getByText('portal.reports@example.com')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Send to' })).toHaveValue('ana@example.org\nbudi@example.org');
    expect(email).not.toHaveBeenCalled();
  });

  it('puts the cursor in the box of recipients, so a person can start typing', async () => {
    const { dialog } = await open();
    expect(within(dialog).getByRole('textbox', { name: 'Send to' })).toHaveFocus();
  });

  it('offers PDF, Excel and the CSV files as one zip, with only the PDF ticked', async () => {
    const { dialog } = await open();
    const files = within(dialog).getByRole('group', { name: 'Files' });
    const boxes = within(files).getAllByRole('checkbox');
    expect(boxes.map((b) => b.closest('label')?.textContent)).toEqual(['PDF', 'Excel', 'CSV (a zip of files)']);
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false, false]);
  });

  it('says how many addresses a list may hold, and which domains they may be in', async () => {
    info.mockResolvedValue({ ...on, allowedDomains: ['example.org', 'hcml.co.id'] });
    const { dialog } = await open();
    expect(dialog).toHaveTextContent('Up to 10 addresses, one on each line or separated by commas.');
    expect(dialog).toHaveTextContent('Only addresses at example.org or hcml.co.id are accepted.');
  });

  it('says nothing about domains when any will do', async () => {
    const { dialog } = await open();
    expect(dialog).not.toHaveTextContent(/Only addresses at/);
  });

  it('offers to remember the list, unticked', async () => {
    const { dialog } = await open();
    expect(within(dialog).getByRole('checkbox', { name: 'Remember this list for next time' })).not.toBeChecked();
    expect(dialog).not.toHaveTextContent(/forgets the list/);
  });

  it('says so plainly when the portal has no folder to keep the list past a restart', async () => {
    info.mockResolvedValue({ ...on, kept: false });
    const { dialog } = await open();
    expect(dialog).toHaveTextContent('This portal has no data folder, so it forgets the list when it restarts.');
  });

  it('says in which style the files will be written, and where to change it', async () => {
    const { dialog } = await open();
    expect(dialog).toHaveTextContent('Style: decimal dot, dates like 4 Nov 2026.');
    expect(dialog).toHaveTextContent('Change it with the Number and date style button.');
  });

  it('mentions the CSV separator in that line only once CSV is ticked', async () => {
    localStorage.setItem(REPORT_STYLE_KEY, JSON.stringify({ decimal: 'comma', date: 'iso', separator: 'semicolon' }));
    const { user, dialog } = await open();
    expect(dialog).toHaveTextContent('Style: decimal comma, dates like 2026-11-04.');
    expect(dialog).not.toHaveTextContent('CSV separated by');
    await user.click(within(dialog).getByRole('checkbox', { name: 'CSV (a zip of files)' }));
    expect(dialog).toHaveTextContent('Style: decimal comma, dates like 2026-11-04, CSV separated by semicolons.');
  });

  it('moves focus in, keeps it in, and Escape closes it and gives focus back to the button', async () => {
    const { user, dialog } = await open();
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 9; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await button()).toHaveFocus();
  });

  it('closes on Cancel and on a click outside it, and sends nothing', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(await button());
    await user.click(document.querySelector('.drawer-overlay') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(email).not.toHaveBeenCalled();
  });
});

describe('sending', () => {
  it('sends the PDF for the month to the people in the box, and says to how many it went', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));

    expect(email).toHaveBeenCalledWith('2026-08', { formats: ['pdf'], to: ['ana@example.org', 'budi@example.org'], remember: false, style: DEFAULT_STYLE });
    await said(dialog, 'Sent the PDF to 2 people.');
    expect(within(dialog).queryByRole('button', { name: 'Send report' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends to the addresses as typed, however they are separated, and not to the saved ones', async () => {
    const { user, dialog } = await open();
    const box = within(dialog).getByRole('textbox', { name: 'Send to' });
    await user.clear(box);
    await user.type(box, 'cici@example.org, dedi@example.org;eka@example.org{enter}fifi@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(email.mock.calls[0]![1]!.to).toEqual(['cici@example.org', 'dedi@example.org', 'eka@example.org', 'fifi@example.org']);
  });

  it('sends several files in one go, in the order they are listed', async () => {
    email.mockResolvedValue(sentTo(2, 0, { files: [pdfFile, { format: 'xlsx', fileName: 'x.xlsx', bytes: 5 }, { format: 'csv', fileName: 'x_csv.zip', bytes: 5 }] }));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'CSV (a zip of files)' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Excel' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(email.mock.calls[0]![1]!.formats).toEqual(['pdf', 'xlsx', 'csv']);
    await said(dialog, 'Sent the PDF, the Excel file and the CSV zip to 2 people.');
  });

  it('sends only the Excel file when only it is ticked', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'PDF' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Excel' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(email.mock.calls[0]![1]!.formats).toEqual(['xlsx']);
  });

  it('writes in the style the person chose for the downloads', async () => {
    localStorage.setItem(REPORT_STYLE_KEY, JSON.stringify({ decimal: 'comma', date: 'iso', separator: 'semicolon' }));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(email.mock.calls[0]![1]!.style).toEqual({ decimal: 'comma', date: 'iso', separator: 'semicolon' });
  });

  it('asks to remember the list when the box is ticked, and says it is saved', async () => {
    email.mockResolvedValue(sentTo(2, 0, { remembered: true }));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Remember this list for next time' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(email.mock.calls[0]![1]!.remember).toBe(true);
    await said(dialog, 'Sent the PDF to 2 people. The list is saved.');
  });

  it('says that the report went but the list could not be saved, when that is what happened', async () => {
    email.mockResolvedValue(sentTo(2, 0, { remembered: false }));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Remember this list for next time' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await said(dialog, 'Sent the PDF to 2 people. The report went, but the list could not be saved.');
  });

  it('asks for a file before it asks the BFF anything', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'PDF' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose at least one file.');
    expect(email).not.toHaveBeenCalled();
  });

  it('asks for an address before it asks the BFF anything', async () => {
    const { user, dialog } = await open();
    await user.clear(within(dialog).getByRole('textbox', { name: 'Send to' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Add at least one address.');
    expect(email).not.toHaveBeenCalled();
  });

  it('uses the month the page shows when the dialog is opened', async () => {
    const { user, dialog } = await open(userEvent.setup(), '2026-07');
    expect(within(dialog).getByText('July 2026, both methods')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(email.mock.calls[0]![0]).toBe('2026-07');
  });

  it('says "1 person" for one, and how many addresses the mail server refused', async () => {
    email.mockResolvedValue(sentTo(1, 1));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await said(dialog, 'Sent the PDF to 1 person. The mail server refused 1 address.');
  });

  it('works while it works: the button says so, nothing else can be pressed, a second click sends nothing more, Escape waits', async () => {
    const pending = deferred<Sent>();
    email.mockReturnValue(pending.promise);
    const { user, dialog } = await open();
    const send = within(dialog).getByRole('button', { name: 'Send report' });
    await user.click(send);

    const working = within(dialog).getByRole('button', { name: 'Sending…' });
    // Not `disabled`, which would drop the keyboard focus it holds (as with the download buttons).
    expect(working).toHaveAttribute('aria-disabled', 'true');
    expect(working).toHaveFocus();
    await said(dialog, /Sending/);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('textbox', { name: 'Send to' })).toBeDisabled();
    for (const box of within(dialog).getAllByRole('checkbox')) expect(box).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(working);
    expect(email).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(sentTo(2)));
    await said(dialog, 'Sent the PDF to 2 people.');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('shows the BFF’s own sentence when it fails, keeps the dialog and the typed addresses, and lets the person try again', async () => {
    email.mockRejectedValueOnce(new Error('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).'));
    const { user, dialog } = await open();
    const box = within(dialog).getByRole('textbox', { name: 'Send to' });
    await user.clear(box);
    await user.type(box, 'spy@elsewhere.net');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(box).toHaveValue('spy@elsewhere.net');

    await user.clear(box);
    await user.type(box, 'ana@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await said(dialog, 'Sent the PDF to 2 people.');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(email).toHaveBeenCalledTimes(2);
  });

  it('says the portal could not be reached when the request never got there', async () => {
    email.mockRejectedValue(new TypeError('Failed to fetch'));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    // The connection may also have broken after the portal had the request, so it does not say "try again".
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The portal could not be reached, or the connection broke while it worked. The report may or may not have gone: look under Last sends in the Schedule dialog, or ask the people it was sent to, before you press Send report again.',
    );
  });

  it('gives the person a plain sentence when the failure carried no words', async () => {
    email.mockRejectedValue(new Error(''));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/did not go/i);
  });

  it('says that the portal did not answer, and that the report may have gone, when nginx answers and not the BFF', async () => {
    email.mockRejectedValue(new HttpFailure('/api/sli/email: HTTP 502', 502, false));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('The portal did not answer (HTTP 502). The report may or may not have gone: look under Last sends in the Schedule dialog, or ask the people it was sent to, before you press Send report again.');
    expect(alert).not.toHaveTextContent('/api/sli/email');
  });

  it('says the same for a 504 with no words, the one that follows a long send', async () => {
    email.mockRejectedValue(new HttpFailure('/api/sli/email: HTTP 504', 504, false));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The portal did not answer (HTTP 504). The report may or may not have gone');
  });

  it("keeps the BFF's own words when it gave some, whatever the status", async () => {
    email.mockRejectedValue(new HttpFailure('The mail server refused the login. Check MAIL_USER and MAIL_PASS.', 502, true));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('The mail server refused the login. Check MAIL_USER and MAIL_PASS.');
    expect(alert).not.toHaveTextContent(/may or may not/);
  });

  it('says that the report went when the portal answered in a form this page cannot read', async () => {
    email.mockRejectedValue(new UnreadableAnswer('/api/sli/email', 'the email answer', 'files: not a list'));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("The report went, but this page could not read the portal's answer. Reload the page before you send it again.");
  });

  it('takes away the way to send again once the report is known to have gone, as after a success', async () => {
    email.mockRejectedValue(new UnreadableAnswer('/api/sli/email', 'the email answer', 'files: not a list'));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await within(dialog).findByRole('alert');
    expect(within(dialog).queryByRole('button', { name: 'Send report' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(within(dialog).getByLabelText('Send to')).toBeDisabled();
    expect(email).toHaveBeenCalledTimes(1);
  });

  it('keeps the way to send again after a failure that does not say the report went', async () => {
    email.mockRejectedValue(new HttpFailure('/api/sli/email: HTTP 502', 502, false));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await within(dialog).findByRole('alert');
    expect(within(dialog).getByRole('button', { name: 'Send report' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Send to')).toBeEnabled();
  });

  it('starts clean the next time it is opened', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await said(dialog, 'Sent the PDF to 2 people.');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await user.click(await button());
    const again = await screen.findByRole('dialog', { name: 'Email the SLA report' });
    expect(within(again).getByRole('button', { name: 'Send report' })).toHaveAttribute('aria-disabled', 'false');
    expect(within(again).getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not touch the page if it goes away before the answer', async () => {
    const pending = deferred<Sent>();
    email.mockReturnValue(pending.promise);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const { unmount } = render(<EmailReport month="2026-08" />);
    await user.click(await button());
    await user.click(await screen.findByRole('button', { name: 'Send report' }));
    unmount();
    await act(async () => pending.resolve(sentTo(2)));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('what the person sees after pressing Send', () => {
  const reveal = vi.fn();
  beforeEach(() => {
    reveal.mockClear();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: reveal, configurable: true, writable: true });
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
  const lastRevealed = () => reveal.mock.contexts[reveal.mock.contexts.length - 1] as HTMLElement | undefined;

  it('brings what it says into view: the work, then the result', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await said(dialog, 'Sent the PDF to 2 people.');
    expect(lastRevealed()).toHaveTextContent('Sent the PDF to 2 people.');
  });

  it('brings a refusal into view', async () => {
    email.mockRejectedValue(new Error('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).'));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    const alert = await within(dialog).findByRole('alert');
    expect(lastRevealed()).toBe(alert);
  });

  it('moves nothing before anything is pressed', async () => {
    await open();
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe('what ticking Remember does', () => {
  it('is said where the box is ticked: the kept list is also the one the monthly send goes to', async () => {
    const { dialog } = await open();
    expect(within(dialog).getByText('The saved list is also the one the monthly send goes to.')).toBeInTheDocument();
  });
});

describe('the saved list, after it changes', () => {
  const keptList = { ...on, recipients: ['citra@example.org'] };
  const box = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: 'Send to' });

  async function sendAndKeep(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    await user.clear(box(dialog));
    await user.type(box(dialog), 'citra@example.org');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Remember this list for next time' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await said(dialog, /The list is saved\./);
  }

  it('asks the BFF again after a send that kept the list, so the box holds it the next time', async () => {
    info.mockResolvedValueOnce(on).mockResolvedValueOnce(keptList);
    email.mockResolvedValue(sentTo(1, 0, { remembered: true }));
    const { user, dialog } = await open();
    await sendAndKeep(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await user.click(await button());
    const again = await screen.findByRole('dialog', { name: 'Email the SLA report' });
    await waitFor(() => expect(box(again)).toHaveValue('citra@example.org'));
    expect(info).toHaveBeenCalledTimes(2);
  });

  it('does not ask again after a send that kept nothing', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await said(dialog, 'Sent the PDF to 2 people.');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('does not ask again after a send that could not keep the list', async () => {
    email.mockResolvedValue(sentTo(2, 0, { remembered: false }));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Remember this list for next time' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await said(dialog, /could not be saved/);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('keeps the buttons and the list it had when the second look fails', async () => {
    info.mockResolvedValueOnce(on).mockRejectedValueOnce(new Error('down'));
    email.mockResolvedValue(sentTo(1, 0, { remembered: true }));
    const { user, dialog } = await open();
    await sendAndKeep(user, dialog);
    await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await user.click(await button());
    const again = await screen.findByRole('dialog', { name: 'Email the SLA report' });
    expect(box(again)).toHaveValue('ana@example.org\nbudi@example.org');
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument();
  });

  it('starts the box from the list the Schedule dialog saved', async () => {
    const schedule = {
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
    };
    vi.spyOn(api, 'sliSchedule').mockResolvedValue(schedule);
    vi.spyOn(api, 'sliScheduleSave').mockResolvedValue({ ...schedule, recipients: ['dewi@example.org'] });
    info.mockResolvedValueOnce(on).mockResolvedValueOnce({ ...on, recipients: ['dewi@example.org'] });
    const user = userEvent.setup();
    render(<EmailReport month="2026-08" />);
    await user.click(await screen.findByRole('button', { name: 'Schedule' }));
    const scheduleDialog = await screen.findByRole('dialog', { name: 'Send the SLA report every month' });
    await user.click(await within(scheduleDialog).findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(scheduleDialog).toHaveTextContent('Saved.'));
    await user.click(within(scheduleDialog).getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Email report' }));
    const email2 = await screen.findByRole('dialog', { name: 'Email the SLA report' });
    await waitFor(() => expect(box(email2)).toHaveValue('dewi@example.org'));
  });
});

describe('a send that takes long (FR-35)', () => {
  const LEAVE = 'Close, the send continues';
  const WHERE = /Last sends in the Schedule dialog/;
  let pending: ReturnType<typeof deferred<Sent>>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pending = deferred<Sent>();
    email.mockReturnValue(pending.promise);
  });
  afterEach(() => vi.useRealTimers());

  const press = async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { dialog } = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    return { user, dialog };
  };
  const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

  it('offers no way to leave in the first 30 seconds, as before', async () => {
    const { dialog } = await press();
    await wait(29_000);
    expect(within(dialog).queryByRole('button', { name: LEAVE })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('offers it after 30 seconds, and says in the dialog that the send continues and where its result will be', async () => {
    const { dialog } = await press();
    await wait(31_000);
    expect(within(dialog).getByRole('button', { name: LEAVE })).toBeEnabled();
    await said(dialog, /Still sending/);
    await said(dialog, /the send continues/);
    await said(dialog, WHERE);
  });

  it('keeps the cross and Cancel off even then: the one way out is the button that says what it does', async () => {
    const { dialog } = await press();
    await wait(31_000);
    expect(within(dialog).getByRole('button', { name: 'Close the dialog' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('closes the dialog on that button, sends nothing more, and has the page say the send goes on and where to look', async () => {
    const { user, dialog } = await press();
    await wait(31_000);
    await user.click(within(dialog).getByRole('button', { name: LEAVE }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(email).toHaveBeenCalledTimes(1);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('The report email for August 2026 is still being sent.');
    expect(note).toHaveTextContent(WHERE);
  });

  it('keeps the person from sending a second copy while the first is out', async () => {
    const { user, dialog } = await press();
    await wait(31_000);
    await user.click(within(dialog).getByRole('button', { name: LEAVE }));
    expect(screen.getByRole('button', { name: 'Email report' })).toBeDisabled();
  });

  it('tells the person how it went when it ends after they left, and offers to dismiss it', async () => {
    const { user, dialog } = await press();
    await wait(31_000);
    await user.click(within(dialog).getByRole('button', { name: LEAVE }));
    await act(async () => pending.resolve(sentTo(2)));
    expect(screen.getByRole('status')).toHaveTextContent('Sent the PDF to 2 people.');
    expect(screen.getByRole('button', { name: 'Email report' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says so, as an alert, when it fails after they left, with the words the dialog would have used', async () => {
    const { user, dialog } = await press();
    await wait(31_000);
    await user.click(within(dialog).getByRole('button', { name: LEAVE }));
    await act(async () => pending.reject(new HttpFailure('/api/sli/email: HTTP 504', 504, false)));
    expect(screen.getByRole('alert')).toHaveTextContent('The portal did not answer (HTTP 504). The report may or may not have gone');
    expect(screen.getByRole('button', { name: 'Email report' })).toBeEnabled();
  });

  it('shows the portal’s own sentence for a failure that has one', async () => {
    const { user, dialog } = await press();
    await wait(31_000);
    await user.click(within(dialog).getByRole('button', { name: LEAVE }));
    await act(async () => pending.reject(new HttpFailure('The mail server did not answer in time, so the report may or may not have gone.', 502, true)));
    expect(screen.getByRole('alert').textContent).toContain('The mail server did not answer in time, so the report may or may not have gone.');
  });

  it('does not offer to leave, or say anything on the page, when the answer came in time', async () => {
    const { dialog } = await press();
    await wait(10_000);
    await act(async () => pending.resolve(sentTo(2)));
    await said(dialog, 'Sent the PDF to 2 people.');
    await wait(40_000);
    expect(within(dialog).queryByRole('button', { name: LEAVE })).toBeNull();
  });

  it('starts counting again for a second send after a long one failed', async () => {
    const { user, dialog } = await press();
    await wait(31_000);
    expect(within(dialog).getByRole('button', { name: LEAVE })).toBeInTheDocument();
    await act(async () => pending.reject(new Error('The mail server refused the login.')));
    await within(dialog).findByRole('alert');
    expect(within(dialog).queryByRole('button', { name: LEAVE })).toBeNull();
    pending = deferred<Sent>();
    email.mockReturnValue(pending.promise);
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(within(dialog).queryByRole('button', { name: LEAVE })).toBeNull();
    await wait(29_000);
    expect(within(dialog).queryByRole('button', { name: LEAVE })).toBeNull();
    await wait(2_000);
    expect(within(dialog).getByRole('button', { name: LEAVE })).toBeInTheDocument();
  });

  it('does not touch the page if the page goes away after they left', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(<EmailReport month="2026-08" />);
    await user.click(await button());
    await user.click(await screen.findByRole('button', { name: 'Send report' }));
    await wait(31_000);
    await user.click(screen.getByRole('button', { name: LEAVE }));
    view.unmount();
    await act(async () => pending.resolve(sentTo(2)));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('the saved list view in the Email dialog (FR-31)', () => {
  const view = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: /Saved list/ });
  let save: MockInstance<typeof api.sliRecipientsSave>;
  beforeEach(() => {
    save = vi.spyOn(api, 'sliRecipientsSave').mockImplementation(async (list) => ({ recipients: list, saved: list.length }));
  });

  it('sits under the box, closed, with the number of people saved', async () => {
    const { dialog } = await open();
    expect(view(dialog)).toHaveTextContent('Saved list (2 people)');
    expect(view(dialog)).toHaveAttribute('aria-expanded', 'false');
  });

  it('is only for what the dialog can send: it is off while a report is being sent', async () => {
    email.mockReturnValue(new Promise(() => undefined));
    const { user, dialog } = await open();
    await user.click(view(dialog));
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(within(dialog).getByRole('button', { name: 'Remove ana@example.org from the saved list' })).toBeDisabled();
  });

  it('changes the box with the saved list, when the box held the saved list', async () => {
    const { user, dialog } = await open();
    await user.click(view(dialog));
    await user.click(within(dialog).getByRole('button', { name: 'Remove ana@example.org from the saved list' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(['budi@example.org']));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Send to' })).toHaveValue('budi@example.org'));
  });

  it('leaves the box alone when the person had typed a list of their own', async () => {
    const { user, dialog } = await open();
    const box = within(dialog).getByRole('textbox', { name: 'Send to' });
    await user.clear(box);
    await user.type(box, 'zed@example.org');
    await user.click(view(dialog));
    await user.click(within(dialog).getByRole('button', { name: 'Remove ana@example.org from the saved list' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(box).toHaveValue('zed@example.org');
  });

  it('asks the BFF again after a change, so the next dialog starts from the new list', async () => {
    const { user, dialog } = await open();
    expect(info).toHaveBeenCalledTimes(1);
    await user.click(view(dialog));
    await user.click(within(dialog).getByRole('button', { name: 'Remove ana@example.org from the saved list' }));
    await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
  });

  it('is told the saved list that the BFF gave, with its number of people', async () => {
    info.mockResolvedValue({ ...on, recipients: ['ana@example.org'], max: 1, allowedDomains: ['example.org'], kept: false });
    const { user, dialog } = await open();
    await user.click(view(dialog));
    expect(within(dialog).getAllByText(/Only addresses at example\.org are accepted\./).length).toBeGreaterThan(0);
    // The dialog says it once, above; the view does not say it again.
    expect(within(dialog).getAllByText(/forgets the list when it restarts/)).toHaveLength(1);
  });
});

