import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api, HttpFailure } from '../../api';
import ReportDownload, { GIVE_UP_AFTER_MS, READY_FOR_MS, REVOKE_AFTER_MS } from './ReportDownload';
import { recentMonths } from '../../shared/lib/time';
import { DEFAULT_REPORT_STYLE, REPORT_STYLE_KEY } from './reportStyle';
import Availability from './Availability';
import Sla from './Sla';
import type { AvailabilityReport, SliGroup, SliProfile, SliReport } from '../../types';

// Who is signed in, for the tests of where the Email button appears. Nobody, unless a test says.
const auth = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../shared/hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../../shared/hooks/useAuth')>('../../shared/hooks/useAuth');
  return { ...actual, useAuth: () => ({ me: null, role: auth.role, pages: null, loading: false }) };
});

type ReportFile = Awaited<ReturnType<typeof api.sliExport>>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const file = (fileName: string): ReportFile => ({ blob: new Blob(['report'], { type: 'application/pdf' }), fileName });

/** What the throwaway link was asked to save, in order. */
let clicked: { href: string; download: string; connected: boolean }[];
let sliExport: MockInstance<typeof api.sliExport>;

beforeEach(() => {
  auth.role = null;
  localStorage.clear();
  clicked = [];
  // jsdom has neither, and a real click on a blob link would try to navigate.
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download, connected: this.isConnected });
  });
  sliExport = vi.spyOn(api, 'sliExport').mockResolvedValue(file('HCML_SLA_Report_2026-08.pdf'));
});
afterEach(() => vi.restoreAllMocks());

const pdfButton = () => screen.getByRole('button', { name: 'PDF report' });
const excelButton = () => screen.getByRole('button', { name: 'Excel report' });
const csvButton = () => screen.getByRole('button', { name: 'CSV report' });

describe('ReportDownload', () => {
  it('offers the PDF, Excel and CSV report in a group named for the month in words', () => {
    render(<ReportDownload month="2026-08" />);
    const group = screen.getByRole('group', { name: 'Download the SLA report for August 2026, both methods' });
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.replace(/Preparing.*/, ''))).toEqual(['PDF report', 'Excel report', 'CSV report']);
    expect(group.querySelectorAll('button.btn.ghost.sm')).toHaveLength(3);
  });

  it('offers the number and date style in a group of its own, after the downloads and not among them', () => {
    render(<ReportDownload month="2026-08" />);
    const downloads = screen.getByRole('group', { name: 'Download the SLA report for August 2026, both methods' });
    const style = screen.getByRole('group', { name: 'Number and date style of the report files' });
    expect(downloads.contains(style)).toBe(false);
    expect(downloads.compareDocumentPosition(style) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(downloads).queryByRole('button', { name: 'Number and date style' })).toBeNull();
  });

  it('says in the button’s hint that the CSV report is a zip with a file for each table', () => {
    render(<ReportDownload month="2026-08" />);
    expect(csvButton()).toHaveAttribute('title', expect.stringContaining('one zip with a CSV file for each table'));
    expect(pdfButton()).toHaveAttribute('title', expect.stringContaining('Both methods'));
  });

  it('fetches the month as a PDF and saves it under the name the BFF gave', async () => {
    const report = file('HCML_SLA_Report_2026-08.pdf');
    sliExport.mockResolvedValue(report);
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());

    expect(sliExport).toHaveBeenCalledWith('2026-08', 'pdf', expect.any(AbortSignal), DEFAULT_REPORT_STYLE);
    await waitFor(() => expect(clicked).toEqual([{ href: 'blob:report', download: 'HCML_SLA_Report_2026-08.pdf', connected: true }]));
    expect(URL.createObjectURL).toHaveBeenCalledWith(report.blob);
    // Gone from the page once clicked.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('lets go of the object URL only after a delay, so a slow browser can finish starting the save', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());
    await waitFor(() => expect(clicked).toHaveLength(1));

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const revoke = timers.mock.calls.find(([, ms]) => ms === REVOKE_AFTER_MS);
    expect(revoke, 'a revoke was scheduled').toBeDefined();
    // Long enough for a slow browser: Firefox and Safari can cancel a save whose URL is revoked early.
    expect(REVOKE_AFTER_MS).toBeGreaterThanOrEqual(30_000);
    (revoke![0] as () => void)();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it('fetches the month as an Excel workbook the same way', async () => {
    sliExport.mockResolvedValue(file('HCML_SLA_Report_2026-08.xlsx'));
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(excelButton());

    expect(sliExport).toHaveBeenCalledWith('2026-08', 'xlsx', expect.any(AbortSignal), DEFAULT_REPORT_STYLE);
    await waitFor(() => expect(clicked).toEqual([{ href: 'blob:report', download: 'HCML_SLA_Report_2026-08.xlsx', connected: true }]));
  });

  it('fetches the month as the CSV files in one zip, saved under the name the BFF gave', async () => {
    sliExport.mockResolvedValue(file('HCML_SLA_Report_2026-08_csv.zip'));
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(csvButton());

    expect(sliExport).toHaveBeenCalledWith('2026-08', 'csv', expect.any(AbortSignal), DEFAULT_REPORT_STYLE);
    await waitFor(() => expect(clicked).toEqual([{ href: 'blob:report', download: 'HCML_SLA_Report_2026-08_csv.zip', connected: true }]));
  });

  it('labels the CSV button while it prepares, announces it, and says when it is ready', async () => {
    const pending = deferred<ReportFile>();
    sliExport.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(csvButton());
    expect(screen.getByRole('button', { name: 'Preparing CSV…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Preparing the CSV report');
    pending.resolve(file('HCML_SLA_Report_2026-08_csv.zip'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('CSV report ready'));
  });

  it('names the CSV report in the error when it fails', async () => {
    sliExport.mockRejectedValueOnce(new Error('Zabbix rejected the API token.'));
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(csvButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t prepare the CSV report: Zabbix rejected the API token.');
  });

  it('writes every file in the style the person kept, read when the button is pressed and not when the page loaded', async () => {
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    const kept = { decimal: 'comma', date: 'iso', separator: 'semicolon' } as const;
    localStorage.setItem(REPORT_STYLE_KEY, JSON.stringify(kept));
    await user.click(csvButton());
    await waitFor(() => expect(sliExport).toHaveBeenCalledWith('2026-08', 'csv', expect.any(AbortSignal), kept));
    await user.click(pdfButton());
    await waitFor(() => expect(sliExport).toHaveBeenCalledWith('2026-08', 'pdf', expect.any(AbortSignal), kept));
    await user.click(excelButton());
    await waitFor(() => expect(sliExport).toHaveBeenCalledWith('2026-08', 'xlsx', expect.any(AbortSignal), kept));
  });

  it('uses the style chosen in the dialog for the very next download', async () => {
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(screen.getByRole('button', { name: 'Number and date style' }));
    const dialog = await screen.findByRole('dialog', { name: 'Number and date style' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Decimal mark' }), 'comma');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(csvButton());
    await waitFor(() => expect(sliExport).toHaveBeenCalledWith('2026-08', 'csv', expect.any(AbortSignal), { ...DEFAULT_REPORT_STYLE, decimal: 'comma' }));
  });

  it('shows the busy button and shuts the other while a report is prepared, and keeps focus on the one pressed', async () => {
    const pending = deferred<ReportFile>();
    sliExport.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());

    const busy = screen.getByRole('button', { name: 'Preparing PDF…' });
    const other = excelButton();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(other).not.toHaveAttribute('aria-busy');
    // aria-disabled, not disabled: a disabled button drops the keyboard focus it holds (see the sign-in form).
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(other).toHaveAttribute('aria-disabled', 'true');
    expect(busy).toHaveFocus();

    pending.resolve(file('HCML_SLA_Report_2026-08.pdf'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDF report' })).not.toHaveAttribute('aria-busy'));
    expect(pdfButton()).not.toHaveAttribute('aria-disabled');
    expect(excelButton()).not.toHaveAttribute('aria-disabled');
    expect(pdfButton()).toHaveFocus();
  });

  it('labels the Excel button while it prepares', async () => {
    sliExport.mockReturnValue(deferred<ReportFile>().promise);
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(excelButton());
    expect(screen.getByRole('button', { name: 'Preparing Excel…' })).toHaveAttribute('aria-busy', 'true');
    expect(pdfButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('sends one request however often the buttons are pressed meanwhile', async () => {
    sliExport.mockReturnValue(deferred<ReportFile>().promise);
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.dblClick(pdfButton());
    await user.click(screen.getByRole('button', { name: 'Preparing PDF…' }));
    await user.click(excelButton());
    expect(sliExport).toHaveBeenCalledTimes(1);
  });

  it('tells a screen reader that the report is being prepared, then that it is ready', async () => {
    const pending = deferred<ReportFile>();
    sliExport.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveClass('sr-only');

    await user.click(pdfButton());
    expect(status).toHaveTextContent('Preparing the PDF report');
    pending.resolve(file('HCML_SLA_Report_2026-08.pdf'));
    await waitFor(() => expect(status).toHaveTextContent('PDF report ready'));
    expect(status).not.toHaveTextContent('Preparing');
  });

  it('says the Excel report in the same words', async () => {
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(excelButton());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Excel report ready'));
  });

  it('shows a failure in an alert on a row of its own, frees the buttons, and clears it on the next press', async () => {
    sliExport.mockRejectedValueOnce(new Error('Zabbix rejected the API token.'));
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t prepare the PDF report: Zabbix rejected the API token.');
    // Outside the buttons' box, so that box keeps its width and the buttons stay put when the alert appears.
    expect(screen.getByRole('group', { name: /^Download the SLA report/ }).closest('.field')).not.toContainElement(alert);
    expect(alert.closest('.report-error-row')).not.toBeNull();
    expect(clicked).toEqual([]);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(pdfButton()).not.toHaveAttribute('aria-disabled');
    expect(excelButton()).not.toHaveAttribute('aria-disabled');
    expect(pdfButton()).not.toHaveAttribute('aria-busy');

    // Retry is the same button, and the old message goes the moment it is pressed.
    const retry = deferred<ReportFile>();
    sliExport.mockReturnValue(retry.promise);
    await user.click(pdfButton());
    expect(screen.queryByRole('alert')).toBeNull();
    retry.resolve(file('HCML_SLA_Report_2026-08.pdf'));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the format that failed, and the other one still works', async () => {
    sliExport.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(excelButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t prepare the Excel report: The portal could not be reached. Check the connection and try again.',
    );
    await user.click(pdfButton());
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears an old error when the month changes', async () => {
    sliExport.mockRejectedValueOnce(new Error('The report could not be built.'));
    const user = userEvent.setup();
    const { rerender } = render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    rerender(<ReportDownload month="2026-07" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('group', { name: 'Download the SLA report for July 2026, both methods' })).toBeInTheDocument();

    // And the old one does not come back with the old month.
    rerender(<ReportDownload month="2026-08" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('frees the buttons at once when the month changes, still saves the file that was on its way, and asks for the new month afterwards', async () => {
    const old = deferred<ReportFile>();
    sliExport.mockReturnValueOnce(old.promise);
    const user = userEvent.setup();
    const { rerender } = render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());
    const signal = sliExport.mock.calls[0][2] as AbortSignal;

    rerender(<ReportDownload month="2026-07" />);
    // Not called off: the person asked for August, and a file that never turns up says nothing.
    expect(signal.aborted).toBe(false);
    expect(pdfButton()).not.toHaveAttribute('aria-busy');
    expect(pdfButton()).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    old.resolve(file('HCML_SLA_Report_2026-08.pdf'));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]!.download).toBe('HCML_SLA_Report_2026-08.pdf');
    // It says nothing about a month that is no longer the one shown.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    await user.click(pdfButton());
    expect(sliExport).toHaveBeenLastCalledWith('2026-07', 'pdf', expect.any(AbortSignal), DEFAULT_REPORT_STYLE);
  });

  it('does not let an old request that ends late free the buttons the new one holds', async () => {
    const a = deferred<ReportFile>();
    const b = deferred<ReportFile>();
    sliExport.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const user = userEvent.setup();
    const { rerender } = render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());
    rerender(<ReportDownload month="2026-07" />);
    await user.click(excelButton());
    expect(screen.getByRole('button', { name: 'Preparing Excel…' })).toHaveAttribute('aria-busy', 'true');

    a.resolve(file('HCML_SLA_Report_2026-08.pdf'));
    await waitFor(() => expect(clicked).toHaveLength(1));
    // The old file is saved, but the new request still owns the buttons and the status.
    expect(screen.getByRole('button', { name: 'Preparing Excel…' })).toHaveAttribute('aria-busy', 'true');
    expect(pdfButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Preparing the Excel report');
    await user.click(pdfButton());
    expect(sliExport).toHaveBeenCalledTimes(2);

    b.resolve(file('HCML_SLA_Report_2026-07.xlsx'));
    await waitFor(() => expect(clicked).toHaveLength(2));
    await waitFor(() => expect(excelButton()).not.toHaveAttribute('aria-busy'));
    expect(pdfButton()).not.toHaveAttribute('aria-disabled');
  });

  it('still saves a report that was on its way when the person left the page', async () => {
    const pending = deferred<ReportFile>();
    sliExport.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    const { unmount } = render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());
    const signal = sliExport.mock.calls[0][2] as AbortSignal;

    unmount();
    expect(signal.aborted).toBe(false);
    pending.resolve(file('HCML_SLA_Report_2026-08.pdf'));
    await waitFor(() =>
      expect(clicked).toEqual([{ href: 'blob:report', download: 'HCML_SLA_Report_2026-08.pdf', connected: true }]),
    );
  });

  it('shows nothing, and leaves nothing behind, when a request fails after the person left', async () => {
    const pending = deferred<ReportFile>();
    sliExport.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    const { unmount } = render(<ReportDownload month="2026-08" />);
    await user.click(excelButton());
    unmount();
    pending.reject(new Error('The report could not be built.'));
    await new Promise((r) => setTimeout(r, 0));
    expect(clicked).toEqual([]);

    // The next visit starts clean: no old failure and no shut buttons.
    render(<ReportDownload month="2026-08" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pdfButton()).not.toHaveAttribute('aria-disabled');
    expect(excelButton()).not.toHaveAttribute('aria-disabled');
  });

  it('gives up on a request that never answers, says so, and frees the buttons', async () => {
    sliExport.mockImplementation(
      (_month, _format, signal) =>
        new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());
    expect(screen.getByRole('button', { name: 'Preparing PDF…' })).toHaveAttribute('aria-busy', 'true');

    const giveUp = timers.mock.calls.find(([, ms]) => ms === GIVE_UP_AFTER_MS);
    expect(giveUp, 'a time limit was set').toBeDefined();
    expect(GIVE_UP_AFTER_MS).toBeGreaterThanOrEqual(60_000);
    act(() => (giveUp![0] as () => void)());

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t prepare the PDF report: It took too long. Try again in a minute.');
    expect(pdfButton()).not.toHaveAttribute('aria-busy');
    expect(pdfButton()).not.toHaveAttribute('aria-disabled');
    expect(excelButton()).not.toHaveAttribute('aria-disabled');
  });

  it('drops the "ready" note after a few seconds, so it is not met later as stale news', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('PDF report ready'));

    const clear = timers.mock.calls.find(([, ms]) => ms === READY_FOR_MS);
    expect(clear, 'the note was given a lifetime').toBeDefined();
    act(() => (clear![0] as () => void)());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps one width whatever the button says: the longer label sits unseen beside the real one', async () => {
    sliExport.mockReturnValue(deferred<ReportFile>().promise);
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    const twinOf = (button: HTMLElement) => button.querySelector('.report-label-twin');
    expect(twinOf(pdfButton())).toHaveAttribute('aria-hidden', 'true');
    expect(twinOf(pdfButton())).toHaveTextContent('Preparing PDF…');
    expect(twinOf(excelButton())).toHaveTextContent('Preparing Excel…');

    await user.click(pdfButton());
    const busy = screen.getByRole('button', { name: 'Preparing PDF…' });
    // The same hidden text as before, and still not part of what a screen reader says.
    expect(twinOf(busy)).toHaveTextContent('Preparing PDF…');
    expect(busy).toHaveAccessibleName('Preparing PDF…');
  });

  it('says in a tooltip, and in the group’s name, that the file holds both methods', () => {
    render(<ReportDownload month="2026-08" />);
    for (const button of [pdfButton(), excelButton(), csvButton()]) {
      expect(button).toHaveAttribute('title', expect.stringContaining('Both methods'));
    }
    expect(screen.getByRole('group', { name: /^Download the SLA report/ })).toHaveAccessibleName('Download the SLA report for August 2026, both methods');
  });

  it.each([
    ['an answer with no words of its own', () => new HttpFailure('/api/sli/export?month=2026-08&format=pdf: HTTP 502', 502, false), 'The portal did not answer (HTTP 502). Try again in a minute.'],
    ['an empty 504', () => new HttpFailure('/api/sli/export?month=2026-08&format=pdf: HTTP 504', 504, false), 'The portal did not answer (HTTP 504). Try again in a minute.'],
    ['words from the BFF', () => new HttpFailure('Zabbix rejected the API token.', 503, true), 'Zabbix rejected the API token.'],
    ['a network failure in Chrome’s words', () => new TypeError('Failed to fetch'), 'The portal could not be reached. Check the connection and try again.'],
    ['a network failure in Firefox’s words', () => new TypeError('NetworkError when attempting to fetch resource.'), 'The portal could not be reached. Check the connection and try again.'],
    ['a network failure in Safari’s words', () => new TypeError('Load failed'), 'The portal could not be reached. Check the connection and try again.'],
    ['an empty message', () => new Error(''), 'Something went wrong. Try again.'],
    ['something that is not an Error', () => ({ odd: true }), 'Something went wrong. Try again.'],
    ['a file that is not the report', () => new Error('The server answered with something that is not a PDF file.'), 'The server answered with something that is not a PDF file.'],
  ])('reads a failure in plain words: %s', async (_label, make, words) => {
    sliExport.mockRejectedValueOnce(make());
    const user = userEvent.setup();
    render(<ReportDownload month="2026-08" />);
    await user.click(pdfButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Couldn’t prepare the PDF report: ${words}`);
    expect(alert.textContent).not.toMatch(/\/api\/|\[object|: $/);
  });

  it('turns both buttons off while the page says the report is still loading', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportDownload month="2026-08" disabled />);
    expect(pdfButton()).toBeDisabled();
    expect(excelButton()).toBeDisabled();
    await user.click(pdfButton());
    expect(sliExport).not.toHaveBeenCalled();

    rerender(<ReportDownload month="2026-08" />);
    expect(pdfButton()).toBeEnabled();
    expect(excelButton()).toBeEnabled();
  });
});

// The two pages that carry it

const at = (url: string) => window.history.replaceState(null, '', url);

const group = (over: Partial<SliGroup> = {}): SliGroup => ({
  key: 'all',
  name: 'HCML estate',
  hosts: 3,
  withData: 3,
  sli: 99.5,
  downtime: 600,
  meeting: true,
  belowTarget: 0,
  ...over,
});

const sliReport = (month: string, profile: SliProfile): SliReport => ({
  source: 'derived',
  label: 'Derived',
  profile,
  month,
  from: 0,
  to: 1,
  end: 1,
  closed: true,
  timezone: 'Asia/Jakarta',
  target: 99,
  basis: { triggers: [], gapPolicy: 'excluded', noDataPolicy: 'excluded', maintenancePolicy: 'excluded' },
  overall: group(),
  categories: [],
  sites: [],
  classes: [],
  hosts: [],
  wanPaths: [],
  web: [],
  gaps: [],
  noDataWindows: [],
  stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0, ms: 0 },
  generatedAt: 0,
});

const availabilityReport = (month: string | null): AvailabilityReport => ({
  from: 0,
  to: 1,
  windowSeconds: 86_400,
  minSeverity: 2,
  hosts: [],
  truncated: false,
  basis: 'availability',
  profile: 'availability',
  month,
  target: 99,
  overall: group(),
  categories: [],
  sites: [],
  gaps: [],
});

const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inWords = (month: string) => `${NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const [, lastMonth, monthBefore] = recentMonths(3);
const downloadGroup = (month: string) => `Download the SLA report for ${inWords(month)}, both methods`;
const emailGroup = (month: string) => `Email the SLA report for ${inWords(month)}, both methods`;
const emailOn = () => vi.spyOn(api, 'sliEmailInfo').mockResolvedValue({ enabled: true, from: 'portal@example.com', recipients: ['ana@example.org'], max: 10, allowedDomains: [], kept: true });

/** The pages ask for the AI switch once and keep the answer, so it is the same for every test here. */
const pageSetup = () => {
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 0, ai: false, writeBack: false });
  vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0 });
  vi.spyOn(api, 'aging').mockResolvedValue({ buckets: [], unacknowledged: 0, total: 0, oldest: [] });
};

/** Each month and method of the derived SLA gets its own answer, which the test gives when it likes. */
function serveSli() {
  const answers: Record<string, ReturnType<typeof deferred<SliReport>>> = {};
  const asked = (month: string, profile: SliProfile) => (answers[`${month}/${profile}`] ??= deferred<SliReport>());
  vi.spyOn(api, 'sli').mockImplementation((month, profile) => asked(month!, profile!).promise);
  return { asked, give: (month: string) => asked(month, 'availability').resolve(sliReport(month, 'availability')) };
}

const openSla = () => {
  at('/sla');
  return render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
};

describe('on the SLA page', () => {
  beforeEach(pageSetup);

  it('sits in the controls row without the AI switch, off until the month has loaded', async () => {
    const { give } = serveSli();
    openSla();

    const controls = screen.getByLabelText('Month').closest('.controls') as HTMLElement;
    const downloads = within(controls).getByRole('group', { name: downloadGroup(lastMonth) });
    expect(within(downloads).getAllByRole('button')).toHaveLength(3);
    // Nothing here is the AI's: its "Explain overall" button is not on the page at all.
    expect(screen.queryByRole('button', { name: 'Explain overall' })).toBeNull();
    expect(within(downloads).getByRole('button', { name: 'PDF report' })).toBeDisabled();
    expect(within(downloads).getByRole('button', { name: 'Excel report' })).toBeDisabled();
    expect(within(downloads).getByRole('button', { name: 'CSV report' })).toBeDisabled();
    // The style is a setting, not a report, so it is there from the start.
    expect(within(controls).getByRole('button', { name: 'Number and date style' })).toBeEnabled();

    give(lastMonth);
    await waitFor(() => expect(within(downloads).getByRole('button', { name: 'PDF report' })).toBeEnabled());
    expect(within(downloads).getByRole('button', { name: 'Excel report' })).toBeEnabled();
    expect(within(downloads).getByRole('button', { name: 'CSV report' })).toBeEnabled();
  });

  it('follows the month, off again until that month has loaded, and fetches the month shown', async () => {
    const { give } = serveSli();
    const user = userEvent.setup();
    openSla();
    give(lastMonth);
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDF report' })).toBeEnabled());

    await user.selectOptions(screen.getByLabelText('Month'), monthBefore);
    expect(screen.getByRole('group', { name: downloadGroup(monthBefore) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF report' })).toBeDisabled();

    give(monthBefore);
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDF report' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Excel report' }));
    expect(api.sliExport).toHaveBeenCalledWith(monthBefore, 'xlsx', expect.any(AbortSignal), DEFAULT_REPORT_STYLE);
  });

  it('puts Email report in the same row for an administrator, off with the downloads until the month has loaded', async () => {
    auth.role = 'admin';
    emailOn();
    const { give } = serveSli();
    openSla();

    const controls = screen.getByLabelText('Month').closest('.controls') as HTMLElement;
    const email = await within(controls).findByRole('group', { name: emailGroup(lastMonth) });
    const button = within(email).getByRole('button', { name: 'Email report' });
    expect(button).toBeDisabled();
    give(lastMonth);
    await waitFor(() => expect(button).toBeEnabled());
    // Its own group, apart from the two downloads, so the downloads keep their label and their two buttons.
    expect(within(controls).getByRole('group', { name: downloadGroup(lastMonth) })).not.toContainElement(button);
  });

  it('puts Email report nowhere for anyone below an administrator', async () => {
    auth.role = 'operator';
    const info = emailOn();
    serveSli();
    openSla();
    expect(screen.getByRole('group', { name: downloadGroup(lastMonth) })).toBeInTheDocument();
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Email report' })).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it('waits for the method in view when that is the HCML one', async () => {
    const { give, asked } = serveSli();
    const user = userEvent.setup();
    openSla();
    give(lastMonth);
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDF report' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'HCML report method' }));
    expect(screen.getByRole('button', { name: 'PDF report' })).toBeDisabled();
    asked(lastMonth, 'hcml-report').resolve(sliReport(lastMonth, 'hcml-report'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDF report' })).toBeEnabled());
  });
});

describe('on the availability page', () => {
  beforeEach(pageSetup);

  const open = (search: string) => {
    at(`/availability${search}`);
    return render(
      <BrowserRouter>
        <Availability />
      </BrowserRouter>,
    );
  };

  it('offers nothing for a rolling window, which is not a month', async () => {
    vi.spyOn(api, 'availability').mockResolvedValue(availabilityReport(null));
    open('');
    expect(await screen.findByLabelText('Period')).toHaveValue('d7');
    expect(screen.queryByRole('group', { name: /Download the SLA report/ })).toBeNull();
  });

  it('offers nothing on the legacy basis, whose figures are not the SLA', async () => {
    vi.spyOn(api, 'availability').mockResolvedValue(availabilityReport(lastMonth));
    open(`?period=m:${lastMonth}&basis=all-problems`);
    expect(await screen.findByLabelText('Basis')).toHaveValue('all-problems');
    expect(screen.queryByRole('group', { name: /Download the SLA report/ })).toBeNull();
  });

  it('offers the chosen calendar month, off while that month loads', async () => {
    const answer = deferred<AvailabilityReport>();
    const availability = vi.spyOn(api, 'availability').mockReturnValue(answer.promise);
    open(`?period=m:${lastMonth}`);

    const downloads = await screen.findByRole('group', { name: downloadGroup(lastMonth) });
    expect(downloads.closest('.controls')).toContainElement(screen.getByLabelText('Period'));
    expect(within(downloads).getByRole('button', { name: 'PDF report' })).toBeDisabled();

    answer.resolve(availabilityReport(lastMonth));
    await waitFor(() => expect(within(downloads).getByRole('button', { name: 'PDF report' })).toBeEnabled());
    expect(availability).toHaveBeenCalledWith(expect.objectContaining({ month: lastMonth }));
  });

  it('offers Email report for the same calendar month to an administrator, and for no rolling window', async () => {
    auth.role = 'admin';
    emailOn();
    vi.spyOn(api, 'availability').mockImplementation(async (arg) =>
      availabilityReport(typeof arg === 'object' ? (arg.month ?? null) : null),
    );
    const user = userEvent.setup();
    open(`?period=m:${lastMonth}`);

    const group = await screen.findByRole('group', { name: emailGroup(lastMonth) });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Email report' })).toBeEnabled());

    await user.selectOptions(screen.getByLabelText('Period'), 'd30');
    await waitFor(() => expect(screen.queryByRole('group', { name: /Email the SLA report/ })).toBeNull());
  });

  it('stays off when the month just picked fails to load, though the last month’s figures are still on screen', async () => {
    const availability = vi
      .spyOn(api, 'availability')
      .mockResolvedValueOnce(availabilityReport(lastMonth))
      .mockRejectedValueOnce(new Error('Zabbix rejected the API token.'));
    const user = userEvent.setup();
    open(`?period=m:${lastMonth}`);
    const first = await screen.findByRole('group', { name: downloadGroup(lastMonth) });
    await waitFor(() => expect(within(first).getByRole('button', { name: 'PDF report' })).toBeEnabled());

    await user.selectOptions(screen.getByLabelText('Period'), `m:${monthBefore}`);
    await waitFor(() => expect(availability).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    const after = screen.getByRole('group', { name: downloadGroup(monthBefore) });
    expect(within(after).getByRole('button', { name: 'PDF report' })).toBeDisabled();
    expect(within(after).getByRole('button', { name: 'Excel report' })).toBeDisabled();
  });

  it('comes and goes with the period picked', async () => {
    vi.spyOn(api, 'availability').mockImplementation(async (arg) =>
      availabilityReport(typeof arg === 'object' ? (arg.month ?? null) : null),
    );
    const user = userEvent.setup();
    open('');
    const period = await screen.findByLabelText('Period');
    expect(screen.queryByRole('group', { name: /Download the SLA report/ })).toBeNull();

    await user.selectOptions(period, `m:${monthBefore}`);
    expect(await screen.findByRole('group', { name: downloadGroup(monthBefore) })).toBeInTheDocument();

    await user.selectOptions(period, 'd30');
    expect(screen.queryByRole('group', { name: /Download the SLA report/ })).toBeNull();
  });
});
