import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The tabs' channel is not under test here; api/ only needs one to exist. */
class FakeChannel {
  postMessage() {}
  addEventListener() {}
}

const pdf = (headers: Record<string, string> = {}) =>
  new Response('%PDF-1.7 report', { status: 200, headers: { 'Content-Type': 'application/pdf', ...headers } });
const xlsx = (headers: Record<string, string> = {}) =>
  new Response('PK workbook', {
    status: 200,
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...headers },
  });
const zip = (headers: Record<string, string> = {}) =>
  new Response('PK csv files', { status: 200, headers: { 'Content-Type': 'application/zip', ...headers } });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let where: { pathname: string; search: string; href: string; origin: string };

/** A fresh api/ for each test: its session state lives at module level (api/session.ts). */
async function load() {
  vi.resetModules();
  return import('../api');
}

beforeEach(() => {
  fetchMock = vi.fn();
  where = { pathname: '/sla', search: '?month=2026-08', href: '', origin: 'http://localhost:3000' };
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', where);
});
afterEach(() => vi.unstubAllGlobals());

describe('api.sliExport', () => {
  it('asks for the month in the format, and returns the file under the name the BFF gave it', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(
      pdf({ 'Content-Disposition': 'attachment; filename="HCML_SLA_Report_2026-08.pdf"' }),
    );
    const { blob, fileName } = await api.sliExport('2026-08', 'pdf');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/sli/export?month=2026-08&format=pdf');
    // A plain same-origin GET: the session cookie goes by itself, and there is nothing to protect with a CSRF header.
    expect(init.method).toBeUndefined();
    expect(init.headers).toBeUndefined();
    expect(fileName).toBe('HCML_SLA_Report_2026-08.pdf');
    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toBe('%PDF-1.7 report');
  });

  it('names the file itself when the BFF sent no name', async () => {
    const { api } = await load();
    fetchMock.mockImplementation(async (url: string) => (url.includes('format=xlsx') ? xlsx() : pdf()));
    expect((await api.sliExport('2026-08', 'pdf')).fileName).toBe('HCML_SLA_Report_2026-08.pdf');
    expect((await api.sliExport('2026-07', 'xlsx')).fileName).toBe('HCML_SLA_Report_2026-07.xlsx');
    expect(fetchMock.mock.calls[1][0]).toBe('/bff/api/sli/export?month=2026-07&format=xlsx');
  });

  it('asks for the CSV files as one zip, and names it itself when the BFF sent no name', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(zip());
    const { blob, fileName } = await api.sliExport('2026-08', 'csv');
    expect(fetchMock.mock.calls[0][0]).toBe('/bff/api/sli/export?month=2026-08&format=csv');
    expect(fileName).toBe('HCML_SLA_Report_2026-08_csv.zip');
    expect(blob.type).toBe('application/zip');
  });

  it('keeps the BFF’s name for the zip, and drops one that does not end in the zip’s own extension', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(zip({ 'Content-Disposition': 'attachment; filename="HCML_SLA_Report_2026-08_csv.zip"' }));
    expect((await api.sliExport('2026-08', 'csv')).fileName).toBe('HCML_SLA_Report_2026-08_csv.zip');
    fetchMock.mockResolvedValueOnce(zip({ 'Content-Disposition': 'attachment; filename="HCML_SLA_Report_2026-08_extra.zip"' }));
    expect((await api.sliExport('2026-08', 'csv')).fileName).toBe('HCML_SLA_Report_2026-08_extra.zip');
    fetchMock.mockResolvedValueOnce(zip({ 'Content-Disposition': 'attachment; filename="report.zip.exe"' }));
    expect((await api.sliExport('2026-08', 'csv')).fileName).toBe('HCML_SLA_Report_2026-08_csv.zip');
    fetchMock.mockResolvedValueOnce(zip({ 'Content-Disposition': 'attachment; filename="HCML_SLA_Report_2026-08.pdf"' }));
    expect((await api.sliExport('2026-08', 'csv')).fileName).toBe('HCML_SLA_Report_2026-08_csv.zip');
  });

  it('refuses a 200 that is not a zip when a zip was asked for, whatever else it is', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(pdf());
    await expect(api.sliExport('2026-08', 'csv')).rejects.toThrow('The server answered with something that is not a zip file.');
    fetchMock.mockResolvedValueOnce(zip());
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('not a PDF file');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200, headers: { 'Content-Type': 'application/zip' } }));
    await expect(api.sliExport('2026-08', 'csv')).rejects.toThrow('The server sent an empty file.');
  });

  it('puts the style in the query: the decimal and the date for every file, the separator for a CSV only', async () => {
    const { api } = await load();
    fetchMock.mockImplementation(async (url: string) => (url.includes('format=csv') ? zip() : url.includes('format=xlsx') ? xlsx() : pdf()));
    const style = { decimal: 'comma', date: 'iso', separator: 'semicolon' } as const;
    await api.sliExport('2026-08', 'csv', undefined, style);
    await api.sliExport('2026-08', 'pdf', undefined, style);
    await api.sliExport('2026-08', 'xlsx', undefined, style);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/bff/api/sli/export?month=2026-08&format=csv&decimal=comma&date=iso&separator=semicolon',
      '/bff/api/sli/export?month=2026-08&format=pdf&decimal=comma&date=iso',
      '/bff/api/sli/export?month=2026-08&format=xlsx&decimal=comma&date=iso',
    ]);
  });

  it('asks with no style words at all when no style is given, so the server’s defaults stand', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(pdf());
    await api.sliExport('2026-08', 'pdf');
    expect(fetchMock.mock.calls[0][0]).toBe('/bff/api/sli/export?month=2026-08&format=pdf');
  });

  it('hands the abort signal to fetch, so a page that has gone can call the download off', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(xlsx());
    const stop = new AbortController();
    await api.sliExport('2026-08', 'xlsx', stop.signal);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(stop.signal);
  });

  it('goes to sign-in on a 401, as every read does, and remembers the page', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(401, { error: 'unauthorized' }));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('Unauthorized');
    expect(where.href).toBe('/login?next=' + encodeURIComponent('/sla?month=2026-08'));
  });

  it('fails with the BFF’s own message, and stays on the page', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(
      json(503, { error: 'zabbix_unavailable', message: 'Zabbix rejected the API token.' }),
    );
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('Zabbix rejected the API token.');
    fetchMock.mockResolvedValueOnce(json(400, { error: 'bad_request' }));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('bad_request');
    expect(where.href).toBe('');
  });

  it('says which request failed, and that nobody explained it, when the answer has no JSON body', async () => {
    const { api, HttpFailure } = await load();
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
    const failure = await api.sliExport('2026-08', 'pdf').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HttpFailure);
    expect(failure).toMatchObject({ status: 502, told: false, message: '/api/sli/export?month=2026-08&format=pdf: HTTP 502' });
  });

  it('marks a failure the BFF explained as told, and skips an empty or odd message for the next one', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(json(503, { error: 'zabbix_unavailable', message: 'Zabbix rejected the API token.' }));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toMatchObject({ status: 503, told: true });
    fetchMock.mockResolvedValueOnce(json(500, { error: 'internal', message: '' }));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toMatchObject({ message: 'internal', told: true });
    fetchMock.mockResolvedValueOnce(json(500, { error: 'internal', message: { nested: true } }));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toMatchObject({ message: 'internal', told: true });
    // Nothing usable in the body: no blank message and no "[object Object]", only the route and the status.
    fetchMock.mockResolvedValueOnce(json(500, { message: { nested: true }, error: ['x'] }));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toMatchObject({
      message: '/api/sli/export?month=2026-08&format=pdf: HTTP 500',
      told: false,
    });
  });

  it('refuses a 200 that is not the file asked for: a login page, a JSON body, or nothing at all', async () => {
    const { api } = await load();
    const html = () => new Response('<!doctype html><h1>Sign in</h1>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    fetchMock.mockResolvedValueOnce(html());
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('The server answered with something that is not a PDF file.');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api.sliExport('2026-08', 'xlsx')).rejects.toThrow('The server answered with something that is not an Excel file.');
    // The other format's type is not good enough either.
    fetchMock.mockResolvedValueOnce(pdf());
    await expect(api.sliExport('2026-08', 'xlsx')).rejects.toThrow('not an Excel file');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('not a PDF file');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('The server sent an empty file.');
  });

  it('takes the type however it is cased or parameterised', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(new Response('%PDF', { status: 200, headers: { 'Content-Type': 'Application/PDF; charset=binary' } }));
    expect((await api.sliExport('2026-08', 'pdf')).blob.size).toBe(4);
  });

  it('does not treat a failure as a file: nothing is read as a blob', async () => {
    const { api } = await load();
    const failure = json(500, { error: 'internal', message: 'The report could not be built.' });
    const blob = vi.spyOn(failure, 'blob');
    fetchMock.mockResolvedValue(failure);
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('The report could not be built.');
    expect(blob).not.toHaveBeenCalled();
  });

  it('passes a network failure on as it is', async () => {
    const { api } = await load();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.sliExport('2026-08', 'pdf')).rejects.toThrow('Failed to fetch');
    expect(where.href).toBe('');
  });
});

describe('api/ JSON reads, which share their GET with the download', () => {
  it('read JSON and carry the signal withSignal sets, so useAsync can still cancel them', async () => {
    const { api, withSignal } = await load();
    // A read has its own signal now (it carries a deadline too), so the proof is that the
    // page's abort reaches the pending fetch, not that the two signals are one object.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))),
        ),
    );
    const run = new AbortController();
    const read = withSignal(run.signal, () => api.health());
    expect(fetchMock.mock.calls[0][0]).toBe('/bff/api/health');
    run.abort();
    await expect(read).rejects.toThrow('cancelled');
  });
});

describe('fileNameFrom', () => {
  const fallback = 'HCML_SLA_Report_2026-08.pdf';

  it.each([
    ['a quoted name', 'attachment; filename="HCML_SLA_Report_2026-08.xlsx"', 'HCML_SLA_Report_2026-08.xlsx'],
    ['a bare name', 'attachment; filename=HCML_SLA_Report_2026-08.xlsx', 'HCML_SLA_Report_2026-08.xlsx'],
    ['a quoted name with spaces', 'attachment; filename="HCML SLA report.pdf"', 'HCML SLA report.pdf'],
    ['an escaped quote', 'attachment; filename="a\\"b.pdf"', 'a"b.pdf'],
    ['a semicolon inside the quotes', 'attachment; filename="a;b.pdf"', 'a;b.pdf'],
    ['spaces around the equals sign', 'attachment; filename = "x.pdf"', 'x.pdf'],
    ['upper case parameter names', 'Attachment; FILENAME="x.pdf"', 'x.pdf'],
    ['parameters after the name', 'attachment; filename="x.pdf"; size=120', 'x.pdf'],
    ['a UTF-8 name', "attachment; filename*=UTF-8''caf%C3%A9.pdf", 'café.pdf'],
    ['a UTF-8 name with a language tag', "attachment; filename*=utf-8'id'laporan%20SLA.pdf", 'laporan SLA.pdf'],
    [
      'both forms, where the UTF-8 one wins whichever comes first',
      `attachment; filename="cafe.pdf"; filename*=UTF-8''caf%C3%A9.pdf`,
      'café.pdf',
    ],
    [
      'both forms, UTF-8 first',
      `attachment; filename*=UTF-8''caf%C3%A9.pdf; filename="cafe.pdf"`,
      'café.pdf',
    ],
    ['a fake parameter hidden in another one’s quotes', 'attachment; note="; filename=evil.exe"; filename="x.pdf"', 'x.pdf'],
  ])('reads %s', async (_label, header, expected) => {
    const { fileNameFrom } = await load();
    expect(fileNameFrom(header, fallback)).toBe(expected);
  });

  it.each([
    ['no header at all', null],
    ['an empty header', ''],
    ['a header with no name', 'attachment'],
    ['an empty name', 'attachment; filename=""'],
    ['a name of spaces', 'attachment; filename="   "'],
    ['a name that is only a dot', 'attachment; filename="."'],
    ['a name that is only two dots', 'attachment; filename=".."'],
    ['a UTF-8 name in another charset', "attachment; filename*=iso-8859-1''caf%E9.pdf"],
    ['a UTF-8 name with a broken escape', "attachment; filename*=UTF-8''%E0%A4%A.pdf"],
  ])('falls back on %s', async (_label, header) => {
    const { fileNameFrom } = await load();
    expect(fileNameFrom(header, fallback)).toBe(fallback);
  });

  it('keeps the plain name when the UTF-8 one is broken', async () => {
    const { fileNameFrom } = await load();
    expect(fileNameFrom(`attachment; filename="plain.pdf"; filename*=UTF-8''%E0%A4%A.pdf`, fallback)).toBe(
      'plain.pdf',
    );
  });

  it('keeps only the last path segment, so a header cannot aim a download at another folder', async () => {
    const { fileNameFrom } = await load();
    expect(fileNameFrom('attachment; filename="../../etc/passwd"', fallback)).toBe('passwd');
    expect(fileNameFrom('attachment; filename="..\\\\..\\\\evil.pdf"', fallback)).toBe('evil.pdf');
    expect(fileNameFrom("attachment; filename*=UTF-8''..%2F..%2Fevil.pdf", fallback)).toBe('evil.pdf');
    expect(fileNameFrom('attachment; filename="reports/"', fallback)).toBe(fallback);
  });

  it('drops control characters', async () => {
    const { fileNameFrom } = await load();
    expect(fileNameFrom('attachment; filename="a\u0007b\u0000.pdf"', fallback)).toBe('ab.pdf');
  });
});

describe('reportFileName', () => {
  const disposition = (name: string) => `attachment; filename="${name}"`;

  it.each([
    ['the BFF’s own name', disposition('HCML_SLA_Report_2026-08.pdf'), 'pdf', 'HCML_SLA_Report_2026-08.pdf'],
    ['a name in capitals', disposition('REPORT.PDF'), 'pdf', 'REPORT.PDF'],
    ['a workbook name', disposition('HCML_SLA_Report_2026-08.xlsx'), 'xlsx', 'HCML_SLA_Report_2026-08.xlsx'],
    ['a name in a folder, cut to its last part', disposition('../../x.pdf'), 'pdf', 'x.pdf'],
  ])('keeps %s', async (_label, header, format, expected) => {
    const { reportFileName } = await load();
    expect(reportFileName(header, '2026-08', format as 'pdf' | 'xlsx')).toBe(expected);
  });

  it.each([
    ['no header', null, 'pdf'],
    ['a name that ends in another extension', disposition('report.command'), 'pdf'],
    ['a double extension', disposition('report.pdf.exe'), 'pdf'],
    ['a page', disposition('report.html'), 'pdf'],
    ['the other format’s extension', disposition('report.pdf'), 'xlsx'],
    ['a name with no extension', disposition('report'), 'pdf'],
    ['a right-to-left override that would flip the extension', disposition('report_\u202Efdp.exe'), 'pdf'],
    ['a zero-width character', disposition('rep\u200Bort.pdf'), 'pdf'],
    ['a byte order mark inside the name', disposition('rep\uFEFFort.pdf'), 'pdf'],
  ])('makes its own name for %s', async (_label, header, format) => {
    const { reportFileName } = await load();
    expect(reportFileName(header, '2026-08', format as 'pdf' | 'xlsx')).toBe(`HCML_SLA_Report_2026-08.${format}`);
  });
});


const INFO = { enabled: true, from: 'portal@example.com', recipients: ['ana@example.org'], max: 10, allowedDomains: [] as string[], kept: true };

describe('api.sliEmailInfo', () => {
  it('asks the BFF whether the report can be emailed, and returns what it says', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, INFO));
    expect(await api.sliEmailInfo()).toEqual(INFO);
    expect(fetchMock.mock.calls[0][0]).toBe('/bff/api/sli/email');
  });

  it.each([
    ['a flag that is text', { ...INFO, enabled: 'yes' }],
    ['recipients that are not a list', { ...INFO, recipients: 'ana@example.org' }],
    ['no limit on the list', { ...INFO, max: undefined }],
    ['domains that are not a list', { ...INFO, allowedDomains: 'example.org' }],
    ['no word on whether the list is kept', { ...INFO, kept: undefined }],
    ['the old shape, with a list called to', { enabled: true, from: 'portal@example.com', to: ['ana@example.org'] }],
  ])('refuses an answer with %s, rather than showing a button on a guess', async (_what, answer) => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, answer));
    await expect(api.sliEmailInfo()).rejects.toThrow();
  });
});

describe('api.sliEmail', () => {
  const answer = { sent: 2, refused: 0, month: '2026-08', files: [{ format: 'pdf', fileName: 'HCML_SLA_Report_2026-08.pdf', bytes: 1234 }], remembered: false };

  it('posts the month and what was asked for, with the CSRF header the cookie needs, and nothing else', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, answer));
    const style = { decimal: 'comma', date: 'iso', separator: 'semicolon' } as const;
    expect(await api.sliEmail('2026-08', { formats: ['pdf', 'csv'], to: ['ana@example.org'], remember: true, style })).toEqual(answer);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/sli/email');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-HCML-CSRF': '1' });
    expect(JSON.parse(String(init.body))).toEqual({ month: '2026-08', formats: ['pdf', 'csv'], to: ['ana@example.org'], remember: true, style });
  });

  it('leaves out what it was not asked to send', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, answer));
    await api.sliEmail('2026-08', { formats: ['pdf'] });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ month: '2026-08', formats: ['pdf'] });
  });

  it.each([
    [502, 'mail_error', 'The mail server refused the login. Check MAIL_USER and MAIL_PASS.'],
    [429, 'rate_limited', 'The limit is 5 report emails an hour for each person. Try again in about 59 minutes.'],
    [503, 'mail_disabled', 'Email is not set up on this portal.'],
    [400, 'bad_request', 'Recipients: "nope" is not a plain address such as name@example.com.'],
  ])('throws the BFF’s own sentence on a %i', async (status, error, message) => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(status, { error, message }));
    await expect(api.sliEmail('2026-08', { formats: ['pdf'] })).rejects.toThrow(message);
  });

  it('goes to sign-in on a 401, as every write does', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(401, { error: 'unauthorized' }));
    await expect(api.sliEmail('2026-08', { formats: ['pdf'] })).rejects.toThrow('Unauthorized');
    expect(where.href).toBe('/login?next=' + encodeURIComponent('/sla?month=2026-08'));
  });
});

const SCHEDULE = {
  available: true,
  why: '',
  timezone: 'Asia/Jakarta',
  schedule: { enabled: true, day: 1, time: '00:00', formats: ['pdf'], style: { decimal: 'dot', date: 'long', separator: 'comma' }, notify: ['boss@example.org'], setBy: 'ana', setAt: 1_800_000_000 },
  recipients: ['ana@example.org'],
  next: { month: '2026-10', at: 1_800_000_600, retrying: false },
  sends: [{ month: '2026-09', trigger: 'schedule', by: 'schedule', at: 1_800_000_000, outcome: 'sent', attempts: 1, formats: ['pdf'], recipients: 1, refused: 0, bytes: 100 }],
  max: 10,
  maxNotify: 3,
  allowedDomains: [] as string[],
};

describe('api.sliSchedule', () => {
  it('asks for the schedule and returns what the BFF says', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, SCHEDULE));
    expect(await api.sliSchedule()).toEqual(SCHEDULE);
    expect(fetchMock.mock.calls[0][0]).toBe('/bff/api/sli/schedule');
  });

  it('takes a portal with no schedule yet, and one with nothing next', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, { ...SCHEDULE, schedule: null, next: null, sends: [] }));
    expect(await api.sliSchedule()).toMatchObject({ schedule: null, next: null, sends: [] });
  });

  it.each([
    ['a flag that is text', { ...SCHEDULE, available: 'yes' }],
    ['no sentence for why', { ...SCHEDULE, why: undefined }],
    ['a schedule that is a number', { ...SCHEDULE, schedule: 5 }],
    ['a schedule with no day', { ...SCHEDULE, schedule: { ...SCHEDULE.schedule, day: undefined } }],
    ['a next send with no month', { ...SCHEDULE, next: { at: 1, retrying: false } }],
    ['sends that are not a list', { ...SCHEDULE, sends: {} }],
    ['a send with no count of people', { ...SCHEDULE, sends: [{ ...SCHEDULE.sends[0], recipients: undefined }] }],
    ['no limit for the people to tell', { ...SCHEDULE, maxNotify: undefined }],
  ])('refuses an answer with %s', async (_what, answer) => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, answer));
    await expect(api.sliSchedule()).rejects.toThrow();
  });
});

describe('api.sliScheduleSave', () => {
  const settings = { enabled: true, day: 5, time: '08:30', formats: ['pdf'] as const, recipients: ['ana@example.org'], notify: [] as string[] };

  it('puts the settings, with the CSRF header the cookie needs, and returns the schedule as it now stands', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, SCHEDULE));
    expect(await api.sliScheduleSave({ ...settings, formats: ['pdf'] })).toEqual(SCHEDULE);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/sli/schedule');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-HCML-CSRF': '1' });
    expect(JSON.parse(String(init.body))).toEqual({ ...settings, formats: ['pdf'] });
  });

  it('refuses an answer of the wrong shape after a save, as it does after a read', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, { ...SCHEDULE, recipients: 'ana@example.org' }));
    await expect(api.sliScheduleSave({ ...settings, formats: ['pdf'] })).rejects.toThrow();
  });

  it.each([
    [400, 'bad_request', 'day must be a whole number from 1 to 28.'],
    [503, 'schedule_unavailable', 'The portal has no data folder to keep a schedule in.'],
    [500, 'state_error', 'The portal could not save this. Check that its data folder can be written.'],
  ])('throws the BFF’s own sentence on a %i', async (status, error, message) => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(status, { error, message }));
    await expect(api.sliScheduleSave({ ...settings, formats: ['pdf'] })).rejects.toThrow(message);
  });

  it('goes to sign-in on a 401, as every write does', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(401, { error: 'unauthorized' }));
    await expect(api.sliScheduleSave({ ...settings, formats: ['pdf'] })).rejects.toThrow('Unauthorized');
  });
});
