import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cached, invalidate } from '../core/cache.js';
import { sampleRangeReports } from './helpers/sliReportFixture.js';

/**
 * A range with no device in it is not mailed either (BK-51, FR-60), and the months it read are forgotten, as a month is, so the try after the cause was put right reads Zabbix again.
 * The reads are a stand-in that answers empty; the cache, the sender and `forgetAsk` are the real ones.
 */
vi.hoisted(() => {
  process.env.MAIL_PROVIDER = 'gmail';
  process.env.MAIL_USER = 'portal.reports@example.com';
  process.env.MAIL_PASS = 'not-a-real-password';
});

const mailer = vi.hoisted(() => ({ verify: vi.fn(), send: vi.fn() }));
vi.mock('../clients/mail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/mail.js')>()),
  createMailer: vi.fn(() => mailer),
}));
const reads = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../services/sliAsk.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/sliAsk.js')>()),
  readReport: reads.read,
}));

const { emailRangeReport } = await import('../services/sliMail.js');
const { parseAsk } = await import('../services/sliAsk.js');
const { EmptyReportError } = await import('../core/validate.js');

const at = (iso: string) => Date.parse(iso) / 1000;
const TO = ['ana@example.org'];
const KEYS = (month: string) => [`sli-data:availability:${month}:closed`, `sli-data:hcml-report:${month}:closed`, `derived-sli:availability:${month}:closed`, `derived-sli:hcml-report:${month}:closed`];

const emptied = (r: ReturnType<typeof sampleRangeReports>['strict']) => ({ ...r, hosts: [], overall: { ...r.overall, hosts: 0, withData: 0 } });
const seed = (months: string[]) => Promise.all(months.flatMap(KEYS).map((key) => cached(key, 60_000, async () => 'kept')));
/** Whether the key still holds what was put there: a drop makes the read below run its own function. */
const stillKept = async (key: string) => (await cached(key, 60_000, async () => 'read again')) === 'kept';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-17T03:00:00Z'));
  invalidate('');
  const { strict, hcml } = sampleRangeReports();
  reads.read.mockReset().mockImplementation(async (_ask: unknown, profile: string) => emptied(profile === 'hcml-report' ? hcml : strict));
  mailer.verify.mockReset().mockResolvedValue(undefined);
  mailer.send.mockReset().mockResolvedValue({ accepted: 1, refused: 0 });
});
afterEach(() => vi.useRealTimers());

const range = (from: string, to: string) => ({ ask: parseAsk({ from: at(from), to: at(to) }), formats: ['pdf' as const], to: TO, sentBy: 'ana' });

describe('a range with no device in it', () => {
  it('is not sent, and forgets the one month it read and none of the others', async () => {
    await seed(['2026-07', '2026-08']);
    await expect(emailRangeReport(range('2026-08-03T00:00:00+07:00', '2026-08-10T00:00:00+07:00'))).rejects.toBeInstanceOf(EmptyReportError);
    expect(mailer.send).not.toHaveBeenCalled();
    for (const key of KEYS('2026-08')) expect(await stillKept(key), key).toBe(false);
    for (const key of KEYS('2026-07')) expect(await stillKept(key), key).toBe(true);
  });

  it('forgets every month it touched when it spans two', async () => {
    await seed(['2026-07', '2026-08', '2026-06']);
    await expect(emailRangeReport(range('2026-07-30T00:00:00+07:00', '2026-08-03T00:00:00+07:00'))).rejects.toBeInstanceOf(EmptyReportError);
    for (const month of ['2026-07', '2026-08']) for (const key of KEYS(month)) expect(await stillKept(key), key).toBe(false);
    for (const key of KEYS('2026-06')) expect(await stillKept(key), key).toBe(true);
  });

  it('forgets only the month of a month in the hours of the day', async () => {
    await seed(['2026-07', '2026-08']);
    const input = { ask: parseAsk({ month: '2026-08', dayHours: '8-17' }), formats: ['pdf' as const], to: TO, sentBy: 'ana' };
    await expect(emailRangeReport(input)).rejects.toBeInstanceOf(EmptyReportError);
    for (const key of KEYS('2026-08')) expect(await stillKept(key), key).toBe(false);
    for (const key of KEYS('2026-07')) expect(await stillKept(key), key).toBe(true);
  });

  it('tries the mail login first, so a wrong password costs a second and not a minute of reading', async () => {
    mailer.verify.mockRejectedValue(new Error('535 not accepted'));
    await expect(emailRangeReport(range('2026-08-03T00:00:00+07:00', '2026-08-10T00:00:00+07:00'))).rejects.toThrow('535');
    expect(reads.read).not.toHaveBeenCalled();
  });
});
