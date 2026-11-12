import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../core/cache.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * A report with no device in it is not mailed (BK-51), and the try after it must read Zabbix again: a closed month is kept for a
 * day, and an empty report kept as the month's answer would make every retry of the week, and every send by hand, fail the same way
 * for a day after the cause was put right. The engine is a stand-in whose answer the test changes; the cache and the mail route are the real ones.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:admin-pass:admin';
  process.env.MAIL_PROVIDER = 'gmail';
  process.env.MAIL_USER = 'portal.reports@example.com';
  process.env.MAIL_PASS = 'not-a-real-password';
  process.env.MAIL_TO = 'ana@example.org, budi@example.org';
});

const mailer = vi.hoisted(() => ({ verify: vi.fn(), send: vi.fn() }));
vi.mock('../clients/mail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/mail.js')>()),
  createMailer: vi.fn(() => mailer),
}));
const compute = vi.hoisted(() => vi.fn());
vi.mock('../sli/engine.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sli/engine.js')>()),
  computeSli: compute,
}));

const { emailReport } = await import('../services/sliMail.js');
const { EmptyReportError } = await import('../core/validate.js');

const { strict, hcml } = sampleSliReports();
const emptied = (r: typeof strict) => ({ ...r, hosts: [], overall: { ...r.overall, hosts: 0, withData: 0 } });
const request = { month: '2026-08', formats: ['pdf' as const], to: ['ana@example.org', 'budi@example.org'], sentBy: 'ana' };

let nothingThere = true;
beforeEach(() => {
  // The month must be closed (and its ten minutes over), as it is when the monthly send runs.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-17T03:00:00Z'));
  invalidate('');
  nothingThere = true;
  compute.mockReset().mockImplementation(async (req: { profile: string }) => {
    const whole = req.profile === 'hcml-report' ? hcml : strict;
    return nothingThere ? emptied(whole) : whole;
  });
  mailer.verify.mockReset().mockResolvedValue(undefined);
  mailer.send.mockReset().mockResolvedValue({ accepted: 2, refused: 0 });
});
afterEach(() => vi.useRealTimers());

describe('the try after an empty report (BK-51)', () => {
  it('reads Zabbix again, instead of answering from what the first read left in the cache', async () => {
    await expect(emailReport(request)).rejects.toBeInstanceOf(EmptyReportError);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(mailer.send).not.toHaveBeenCalled();

    nothingThere = false;
    const done = await emailReport(request);
    expect(compute).toHaveBeenCalledTimes(4);
    expect(done.accepted).toBe(2);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('keeps a report that has devices in the cache, so the fix costs nothing when nothing was empty', async () => {
    nothingThere = false;
    await emailReport(request);
    await emailReport(request);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  it('does not touch what is kept for another month', async () => {
    nothingThere = false;
    await emailReport({ ...request, month: '2026-07' });
    expect(compute).toHaveBeenCalledTimes(2);
    nothingThere = true;
    await expect(emailReport(request)).rejects.toBeInstanceOf(EmptyReportError);
    nothingThere = false;
    await emailReport({ ...request, month: '2026-07' });
    // July was kept and is not read again; August was empty twice over and is not kept.
    expect(compute).toHaveBeenCalledTimes(4);
  });
});
