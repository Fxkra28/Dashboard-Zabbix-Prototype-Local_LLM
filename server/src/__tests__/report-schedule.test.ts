import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailError } from '../clients/mail.js';
import { ZabbixApiError, ZabbixAuthError, ZabbixTimeoutError } from '../clients/zabbix.js';
import { memoryState, openState, StateWriteError, type Schedule, type StateStore } from '../core/state.js';
import { BadRequestError } from '../core/validate.js';
import { createReportSchedule, type ScheduleDeps } from '../services/reportSchedule.js';
import { CATCH_UP_SECONDS, SETTLE_SECONDS } from '../sli/schedule.js';
import type { EmailRequest } from '../services/sliMail.js';

/**
 * The monthly send: when it goes, that it goes once, what it does when something stops it, and who is told. The clock,
 * the state folder and the senders are stand-ins that the test drives, so a month passes in a line.
 */

const at = (iso: string) => Date.parse(iso) / 1000;
const SLOT = at('2026-11-01T00:00:00+07:00');
const READY = SLOT + SETTLE_SECONDS;
const SEED = ['ana@example.org', 'budi@example.org'];

let dir: string;
let state: StateStore;
let now: number;
let sent: EmailRequest[];
let notices: { to: string[]; subject: string; text: string }[];
let logged: { level: string; line: Record<string, unknown>; msg: string }[];
let sendResult: Error | null;
let noticeResult: Error | null;
let settings: ReturnType<ScheduleDeps['settings']>;

const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  enabled: true,
  day: 1,
  time: '00:00',
  formats: ['pdf', 'csv'],
  style: { decimal: 'comma', date: 'iso', separator: 'semicolon' },
  notify: ['boss@example.org'],
  enabledAt: at('2026-10-20T00:00:00+07:00'),
  setBy: 'ana',
  setAt: at('2026-10-20T00:00:00+07:00'),
  ...over,
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'schedule-'));
  state = await openState(dir, () => undefined);
  now = READY;
  sent = [];
  notices = [];
  logged = [];
  sendResult = null;
  noticeResult = null;
  settings = { enabled: true, schedule: true, allowedDomains: [], to: SEED };
  await state.change((d) => {
    d.mail.recipients = SEED;
    d.mail.schedule = schedule();
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function build(over: Partial<ScheduleDeps> = {}) {
  return createReportSchedule({
    now: () => now,
    state: () => state,
    settings: () => settings,
    send: async (req) => {
      sent.push(req);
      if (sendResult) throw sendResult;
      return { files: req.formats.map((format) => ({ format, fileName: `f.${format}`, bytes: 500 })), accepted: req.to.length, refused: 0, bytes: 1000 };
    },
    notice: async (to, subject, text) => {
      if (noticeResult) throw noticeResult;
      notices.push({ to, subject, text });
    },
    timezone: 'Asia/Jakarta',
    log: {
      info: (line, msg) => void logged.push({ level: 'info', line: line as Record<string, unknown>, msg }),
      warn: (line, msg) => void logged.push({ level: 'warn', line: line as Record<string, unknown>, msg }),
      error: (line, msg) => void logged.push({ level: 'error', line: line as Record<string, unknown>, msg }),
    },
    ...over,
  });
}
const records = () => state.read().mail.sends;
const own = () => records().filter((r) => r.trigger === 'schedule');

describe('a state folder that stops taking writes', () => {
  // A stand-in for the store that behaves as the real one does: it is failing from a save that fails until one that works.
  const stopWriting = () => {
    const real = state;
    const flag = { broken: true, failing: true, writes: 0 };
    state = {
      ...real,
      failing: () => flag.failing,
      change: async (edit) => {
        flag.writes++;
        flag.failing = flag.broken;
        if (flag.broken) throw new StateWriteError('EROFS');
        return real.change(edit);
      },
    };
    return flag;
  };

  it('says what is wrong, in a sentence, while the folder cannot be written, and nothing once it can', async () => {
    const job = build();
    expect(job.problem()).toBe('');
    const flag = stopWriting();
    expect(job.problem()).toMatch(/could not write its data folder/);
    flag.failing = false;
    expect(job.problem()).toBe('');
  });

  it('sends nothing it cannot make a record of, and says so once in the log, at error level, however many minutes pass', async () => {
    stopWriting();
    const job = build();
    for (let i = 0; i < 4; i++) {
      await job.tick();
      now += 60;
    }
    expect(sent).toEqual([]);
    const said = logged.filter((l) => l.line.event === 'report_state_unwritable');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ level: 'error', line: { reason: 'EROFS' } });
  });

  it('tries a write at every tick while it is failing, to find out when the folder is back, and goes on at once when it is', async () => {
    const flag = stopWriting();
    const job = build();
    await job.tick();
    const before = flag.writes;
    now += 60;
    await job.tick();
    expect(flag.writes).toBeGreaterThan(before);
    flag.broken = false;
    now += 60;
    await job.tick();
    expect(sent).toHaveLength(1);
    expect(own()[0]).toMatchObject({ outcome: 'sent' });
  });

  it('finds out that the folder is back even when nothing is due, so the page stops saying it is not', async () => {
    const flag = stopWriting();
    flag.broken = false;
    now = READY - 3600;
    const job = build();
    expect(job.problem()).not.toBe('');
    await job.tick();
    expect(job.problem()).toBe('');
    expect(sent).toEqual([]);
  });

  it('says it again when the folder fails a second time after it was back', async () => {
    const flag = stopWriting();
    const job = build();
    await job.tick();
    flag.broken = false;
    await job.tick();
    expect(sent).toHaveLength(1);
    state = { ...state, failing: () => true, change: async () => Promise.reject(new StateWriteError('ENOSPC')) };
    now = at('2026-12-01T00:10:00+07:00');
    await job.tick();
    expect(logged.filter((l) => l.line.event === 'report_state_unwritable').map((l) => l.line.reason)).toEqual(['EROFS', 'ENOSPC']);
  });
});

describe('when it sends', () => {
  it('does nothing until the wait after the slot is over', async () => {
    const job = build();
    now = READY - 1;
    await job.tick();
    expect(sent).toEqual([]);
    expect(records()).toEqual([]);
  });

  it('sends the month that has closed, in the files, to the people and in the style the schedule holds', async () => {
    await build().tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      month: '2026-10',
      formats: ['pdf', 'csv'],
      to: SEED,
      style: { decimal: 'comma', date: 'iso', separator: 'semicolon' },
      sentBy: 'the monthly schedule',
    });
  });

  it('keeps a record of it: sent, by the schedule, how many it reached and never who', async () => {
    await build().tick();
    expect(own()).toEqual([
      expect.objectContaining({ month: '2026-10', trigger: 'schedule', by: 'schedule', outcome: 'sent', attempts: 1, formats: ['pdf', 'csv'], recipients: 2, refused: 0, bytes: 1000, at: READY }),
    ]);
    expect(own()[0]!.nextAt).toBeUndefined();
    expect(own()[0]!.reason).toBeUndefined();
    // The schedule holds who to tell; the record of a send holds only counts.
    expect(JSON.stringify(state.read().mail.sends)).not.toMatch(/@/);
  });

  it('writes the log line the manual send writes, marked as the schedule’s and with domains and no address', async () => {
    await build().tick();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'info',
      msg: 'report email sent',
      line: { event: 'report_email', trigger: 'schedule', user: 'schedule', report: 'sla', month: '2026-10', formats: ['pdf', 'csv'], bytes: 1000, recipients: 2, refused: 0, domains: ['example.org'], outcome: 'sent' },
    });
    expect(JSON.stringify(logged)).not.toMatch(/ana@|budi@|boss@/);
  });

  it('sends a month once: a second look a minute later, and one after a restart, find it done', async () => {
    const job = build();
    await job.tick();
    now += 60;
    await job.tick();
    await build().tick();
    expect(sent).toHaveLength(1);
  });

  it('sends a month it finds late, when the portal was not running at its slot, for up to a week', async () => {
    now = SLOT + 3 * 86400;
    await build().tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.month).toBe('2026-10');
  });

  it('does not send a slot that came before the schedule was turned on', async () => {
    await state.change((d) => void (d.mail.schedule = schedule({ enabledAt: SLOT + 3600 })));
    await build().tick();
    expect(sent).toEqual([]);
  });

  it('does nothing when the schedule is off, or there is none', async () => {
    await state.change((d) => void (d.mail.schedule = schedule({ enabled: false })));
    await build().tick();
    await state.change((d) => void (d.mail.schedule = null));
    await build().tick();
    expect(sent).toEqual([]);
  });

  it('sends the next month when its slot comes', async () => {
    const job = build();
    await job.tick();
    now = at('2026-12-01T00:10:00+07:00');
    await job.tick();
    expect(sent.map((r) => r.month)).toEqual(['2026-10', '2026-11']);
    expect(own().map((r) => r.month)).toEqual(['2026-10', '2026-11']);
  });

  it('sends one at a time: a look made while a send is under way does nothing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const job = build({
      send: async (req) => {
        sent.push(req);
        await gate;
        return { files: [], accepted: 2, refused: 0, bytes: 10 };
      },
    });
    const first = job.tick();
    await job.tick();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    release();
    await first;
    expect(own()[0]).toMatchObject({ outcome: 'sent' });
  });
});

describe('a send that fails after the schedule moved (reviewer, 11 November)', () => {
  it('leaves the month as the move recorded it, failed because it changed, with no retry and no notice', async () => {
    now = READY;
    const job = build({
      send: async (req) => {
        sent.push(req);
        // What the schedule route does when the day or the time moves while a month is still being tried.
        await state.change((d) => {
          for (const r of d.mail.sends) {
            if (r.trigger !== 'schedule' || r.outcome !== 'sending') continue;
            r.outcome = 'failed';
            r.reason = 'changed';
            delete r.nextAt;
          }
          d.mail.schedule = schedule({ day: 5 });
        });
        throw new MailError('connect', 'ECONNECTION');
      },
    });
    await job.tick();
    expect(sent).toHaveLength(1);
    expect(own()).toHaveLength(1);
    expect(own()[0]).toMatchObject({ month: '2026-10', outcome: 'failed', reason: 'changed' });
    expect(own()[0]!.nextAt).toBeUndefined();
    expect(notices).toEqual([]);
  });
});

describe('where it can run', () => {
  it.each([
    ['email is not set up', { enabled: false }, /Email is not set up/],
    ['the schedule is switched off on this machine', { schedule: false }, /MAIL_SCHEDULE=off/],
  ])('does nothing and says why when %s', async (_what, over, why) => {
    settings = { ...settings, ...over };
    const job = build();
    await job.tick();
    expect(sent).toEqual([]);
    expect(job.availability()).toMatchObject({ available: false });
    expect(job.availability().why).toMatch(why);
  });

  it('does nothing and says why when the portal has no folder to keep the schedule in', async () => {
    state = memoryState();
    await state.change((d) => void (d.mail.schedule = schedule()));
    const job = build();
    await job.tick();
    expect(sent).toEqual([]);
    expect(job.availability()).toMatchObject({ available: false });
    expect(job.availability().why).toMatch(/PORTAL_STATE_DIR/);
  });

  it('gives the reason the settings name when email is set up and refused, and not the one for an email that is not set up', () => {
    settings = { ...settings, enabled: false, off: 'Email is off while sign-in is off.' };
    expect(build().availability()).toEqual({ available: false, why: 'Email is off while sign-in is off.' });
    settings = { ...settings, off: '' };
    expect(build().availability().why).toContain('Email is not set up');
  });

  it('is available when email is on, the switch is on and the state is kept', () => {
    expect(build().availability()).toEqual({ available: true, why: '' });
  });
});

describe('who it sends to', () => {
  it('uses the portal’s saved list, and falls back to the list MAIL_TO started with', async () => {
    await state.change((d) => void (d.mail.recipients = ['cici@example.org']));
    await build().tick();
    expect(sent[0]!.to).toEqual(['cici@example.org']);

    await state.change((d) => {
      d.mail.recipients = [];
      d.mail.sends = [];
    });
    await build().tick();
    expect(sent[1]!.to).toEqual(SEED);
  });

  it('will not send to a list that no longer fits the domains the portal may send to, and says so', async () => {
    settings = { ...settings, allowedDomains: ['hcml.co.id'] };
    await build().tick();
    expect(sent).toEqual([]);
    expect(own()[0]).toMatchObject({ outcome: 'sending', reason: 'recipients', attempts: 1 });
    expect(notices).toEqual([]);
  });

  it('will not send when there is nobody to send to', async () => {
    settings = { ...settings, to: [] };
    await state.change((d) => void (d.mail.recipients = []));
    await build().tick();
    expect(sent).toEqual([]);
    expect(own()[0]).toMatchObject({ reason: 'recipients' });
  });
});

describe('when something stops it', () => {
  it('tries again in 15 minutes, then an hour, then every four hours', async () => {
    sendResult = new MailError('connect', 'ECONNECTION');
    const job = build();
    await job.tick();
    expect(own()[0]).toMatchObject({ outcome: 'sending', attempts: 1, reason: 'connect', nextAt: READY + 900 });

    now = READY + 899;
    await job.tick();
    expect(sent).toHaveLength(1);

    now = READY + 900;
    await job.tick();
    expect(own()[0]).toMatchObject({ attempts: 2, nextAt: READY + 900 + 3600 });

    now = READY + 900 + 3600;
    await job.tick();
    expect(own()[0]).toMatchObject({ attempts: 3, nextAt: READY + 900 + 3600 + 14400 });

    now = READY + 900 + 3600 + 14400;
    await job.tick();
    expect(own()[0]).toMatchObject({ attempts: 4, nextAt: READY + 900 + 3600 + 2 * 14400 });
    expect(sent).toHaveLength(4);
  });

  it('sends the report when a later try works, and says how many tries it took', async () => {
    sendResult = new MailError('timeout', 'ETIMEDOUT');
    const job = build();
    await job.tick();
    sendResult = null;
    now = READY + 900;
    await job.tick();
    expect(own()[0]).toMatchObject({ outcome: 'sent', attempts: 2, recipients: 2 });
    expect(own()[0]!.nextAt).toBeUndefined();
    expect(own()[0]!.reason).toBeUndefined();
    now += 3600;
    await job.tick();
    expect(sent).toHaveLength(2);
  });

  it('logs each failed try as a warning: the reason as a word, and what the server said as a detail for whoever reads the log', async () => {
    sendResult = new MailError('login', '535 5.7.8 password rejected');
    await build().tick();
    expect(logged[0]).toMatchObject({
      level: 'warn',
      msg: 'report email failed',
      line: { trigger: 'schedule', outcome: 'failed', reason: 'login', detail: '535 5.7.8 password rejected', month: '2026-10' },
    });
  });

  it('keeps what the server said out of the record and out of every notice', async () => {
    sendResult = new MailError('login', '535 5.7.8 password rejected');
    const job = build();
    await job.tick();
    now = READY + 900;
    await job.tick();
    now += 3600;
    await job.tick();
    expect(notices).toHaveLength(1);
    expect(JSON.stringify(state.read())).not.toContain('password rejected');
    expect(JSON.stringify(notices)).not.toContain('password rejected');
  });

  it('gives the log the words of a failure that is not a mail error, with an address in them masked', async () => {
    sendResult = new Error('cannot route to ana@example.org');
    await build().tick();
    const line = logged[0]!.line as { detail: string };
    expect(line.detail).toBe('Error: cannot route to [address]');
  });

  it('gives the log no more than the name of a Zabbix failure, whose words name HCML’s server', async () => {
    sendResult = new ZabbixApiError('call to zabbix.internal failed');
    await build().tick();
    expect((logged[0]!.line as { detail: string }).detail).toBe('ZabbixApiError');
  });

  it('tells the people who asked, once, after the third failed try, and says when it will stop trying', async () => {
    sendResult = new MailError('login', '535');
    const job = build();
    await job.tick();
    now = READY + 900;
    await job.tick();
    expect(notices).toEqual([]);
    now = READY + 900 + 3600;
    await job.tick();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.to).toEqual(['boss@example.org']);
    expect(notices[0]!.subject).toBe('HCML SLA report for October 2026 has not been sent yet');
    expect(notices[0]!.text).toContain('has not managed to send the SLA report for October 2026');
    expect(notices[0]!.text).toContain('The mail server refused the login.');
    expect(notices[0]!.text).toContain('keep trying until 8 Nov 2026 00:00 (Asia/Jakarta)');
    expect(notices[0]!.text).toContain('Email report');

    now += 14400;
    await job.tick();
    now += 14400;
    await job.tick();
    expect(notices).toHaveLength(1);
    expect(own()[0]).toMatchObject({ noticed: 1 });
  });

  it('does not tell again after a restart: the count of notices is kept with the record', async () => {
    sendResult = new MailError('login', '535');
    await build().tick();
    now = READY + 900;
    await build().tick();
    now = READY + 900 + 3600;
    await build().tick();
    now += 14400;
    await build().tick();
    expect(notices).toHaveLength(1);
  });

  it('gives up when the next try would come after the week is over, and tells them once more', async () => {
    sendResult = new MailError('connect', 'ECONNECTION');
    const job = build();
    await job.tick();
    // Step through the week as the schedule would.
    for (let guard = 0; guard < 80 && own()[0]?.outcome === 'sending'; guard++) {
      now = own()[0]!.nextAt!;
      await job.tick();
    }
    expect(own()[0]).toMatchObject({ outcome: 'failed', reason: 'connect' });
    expect(own()[0]!.nextAt).toBeUndefined();
    expect(own()[0]!.at).toBeLessThanOrEqual(SLOT + CATCH_UP_SECONDS);
    expect(notices.map((n) => n.subject)).toEqual(['HCML SLA report for October 2026 has not been sent yet', 'HCML SLA report for October 2026 was not sent']);
    expect(notices[1]!.text).toContain('stopped trying');
    expect(notices[1]!.text).toContain('Email report');

    const count = sent.length;
    now += 86400;
    await job.tick();
    expect(sent).toHaveLength(count);
  });

  it('marks a month missed, and says so, when the portal was not running through the whole week', async () => {
    now = SLOT + CATCH_UP_SECONDS + 1;
    await build().tick();
    expect(sent).toEqual([]);
    expect(own()[0]).toMatchObject({ month: '2026-10', outcome: 'missed', attempts: 0, reason: 'not running' });
    expect(notices).toHaveLength(1);
    expect(notices[0]!.subject).toBe('HCML SLA report for October 2026 was missed');
    expect(notices[0]!.text).toContain('not running');
    await build().tick();
    expect(notices).toHaveLength(1);
  });

  describe('a portal that was off through more than one slot (BK-45)', () => {
    const DEC = at('2026-12-04T10:00:00+07:00');
    const fromAugust = () => state.change((d) => void (d.mail.schedule = schedule({ enabledAt: at('2026-08-20T00:00:00+07:00') })));

    it('sends the newest month and records the older one as missed, without sending it late', async () => {
      now = DEC;
      await build().tick();
      expect(sent.map((r) => r.month)).toEqual(['2026-11']);
      expect(own().map((r) => [r.month, r.outcome])).toEqual([['2026-10', 'missed'], ['2026-11', 'sent']]);
      expect(own()[0]).toMatchObject({ attempts: 0, reason: 'not running', noticed: 2 });
    });

    it('tells the people to tell once, for the month that went by', async () => {
      now = DEC;
      const job = build();
      await job.tick();
      expect(notices.map((n) => n.subject)).toEqual(['HCML SLA report for October 2026 was missed']);
      await job.tick();
      now += 60;
      await job.tick();
      expect(notices).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it('tells them once, in one message, when several months went by, and names each with the time it was due', async () => {
      await fromAugust();
      now = DEC;
      await build().tick();
      expect(sent.map((r) => r.month)).toEqual(['2026-11']);
      expect(own().filter((r) => r.outcome === 'missed').map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.subject).toBe('HCML SLA reports for August 2026, September 2026 and October 2026 were not sent');
      for (const due of ['1 Sep 2026 00:00', '1 Oct 2026 00:00', '1 Nov 2026 00:00']) expect(notices[0]!.text).toContain(due);
      expect(notices[0]!.text).toContain('Email report');
    });

    it('counts the twelve months before the newest slot and the newest as well, so a very long stop is thirteen months and one message (reviewer, 11 November)', async () => {
      await state.change((d) => void (d.mail.schedule = schedule({ enabledAt: at('2025-02-20T00:00:00+07:00') })));
      now = SLOT + CATCH_UP_SECONDS + 1;
      await build().tick();
      expect(sent).toEqual([]);
      expect(own().filter((r) => r.outcome === 'missed')).toHaveLength(13);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.text).toContain('for 13 months');
    });

    it('judges what is due again after it has told the people, so a schedule turned off meanwhile sends nothing (reviewer, 11 November)', async () => {
      await fromAugust();
      now = DEC;
      const job = build({
        notice: async (to, subject, text) => {
          notices.push({ to, subject, text });
          await state.change((d) => void (d.mail.schedule = schedule({ enabled: false, enabledAt: at('2026-08-20T00:00:00+07:00') })));
        },
      });
      await job.tick();
      expect(notices).toHaveLength(1);
      expect(sent).toEqual([]);
    });

    it('sends the files the schedule holds now, not the ones it held when the notice began (reviewer, 11 November)', async () => {
      await fromAugust();
      now = DEC;
      const job = build({
        notice: async (to, subject, text) => {
          notices.push({ to, subject, text });
          await state.change((d) => void (d.mail.schedule = schedule({ formats: ['xlsx'], enabledAt: at('2026-08-20T00:00:00+07:00') })));
        },
      });
      await job.tick();
      expect(sent.map((r) => r.formats)).toEqual([['xlsx']]);
    });

    it('puts the month whose own week ran out into the same message', async () => {
      await state.change((d) => void (d.mail.schedule = schedule({ enabledAt: at('2026-09-20T00:00:00+07:00') })));
      now = SLOT + CATCH_UP_SECONDS + 1;
      await build().tick();
      expect(sent).toEqual([]);
      expect(own().map((r) => [r.month, r.outcome])).toEqual([['2026-09', 'missed'], ['2026-10', 'missed']]);
      expect(notices.map((n) => n.subject)).toEqual(['HCML SLA reports for September 2026 and October 2026 were not sent']);
    });

    it('calls an older month that was tried and never ended failed, and says the portal stopped trying', async () => {
      await state.change((d) =>
        d.mail.sends.push({ month: '2026-10', trigger: 'schedule', by: 'schedule', at: at('2026-11-01T00:30:00+07:00'), outcome: 'sending', attempts: 2, nextAt: at('2026-11-01T01:30:00+07:00'), reason: 'connect', formats: ['pdf'], recipients: 0, refused: 0, bytes: 0 }),
      );
      now = DEC;
      await build().tick();
      expect(own().find((r) => r.month === '2026-10')).toMatchObject({ outcome: 'failed', reason: 'connect', attempts: 2, noticed: 2 });
      expect(own().find((r) => r.month === '2026-10')!.nextAt).toBeUndefined();
      expect(notices.map((n) => n.subject)).toEqual(['HCML SLA report for October 2026 was not sent']);
      expect(notices[0]!.text).toContain('stopped trying');
    });

    it('writes a log line for each month it skips, as a skipped month and not as a failed send, with no address in it (BK-55)', async () => {
      await fromAugust();
      now = DEC;
      await build().tick();
      const lines = logged.filter((l) => l.line.event === 'report_skipped');
      expect(lines.map((l) => l.line.month)).toEqual(['2026-08', '2026-09', '2026-10']);
      expect(lines.every((l) => l.line.outcome === 'missed' && /skipped/.test(l.msg) && !/failed/.test(l.msg))).toBe(true);
      // Nothing was tried for any of the three months, so none of them is a line of a send that failed (the newest month was sent, and that line is a success).
      expect(logged.filter((l) => l.line.event === 'report_email' && l.line.outcome !== 'sent')).toEqual([]);
      expect(JSON.stringify(lines)).not.toMatch(/ana@|budi@|boss@/);
    });

    it('still records the months when the notice cannot be sent, and does not try the notice again', async () => {
      noticeResult = new MailError('login', '535');
      now = DEC;
      const job = build();
      await job.tick();
      expect(own().find((r) => r.month === '2026-10')).toMatchObject({ outcome: 'missed', noticed: 2 });
      expect(logged.some((l) => l.line.event === 'report_notice_failed')).toBe(true);
      noticeResult = null;
      now += 60;
      await job.tick();
      expect(notices).toEqual([]);
    });

    it('records nothing while the schedule is off or email is off', async () => {
      now = DEC;
      await state.change((d) => void (d.mail.schedule = schedule({ enabled: false })));
      await build().tick();
      settings = { ...settings, enabled: false };
      await state.change((d) => void (d.mail.schedule = schedule()));
      await build().tick();
      expect(own()).toEqual([]);
      expect(notices).toEqual([]);
    });

    it('writes the message of several months with no dash standing for punctuation and no address', async () => {
      await fromAugust();
      now = DEC;
      await build().tick();
      const text = `${notices[0]!.subject}\n${notices[0]!.text}`;
      expect(text).not.toMatch(new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`));
      expect(text).not.toMatch(/ana@|budi@/);
    });
  });

  it('ends a send that was tried, and was under way when the week ended, as failed and not missed', async () => {
    sendResult = new MailError('connect', 'ECONNECTION');
    await build().tick();
    now = SLOT + CATCH_UP_SECONDS + 1;
    await build().tick();
    expect(own()[0]).toMatchObject({ outcome: 'failed', reason: 'connect' });
  });

  it.each([
    ['a Zabbix error', () => new ZabbixApiError('x', 'http://zabbix.internal')],
    ['a Zabbix timeout', () => new ZabbixTimeoutError('x', 'http://zabbix.internal')],
    ['a Zabbix login that failed', () => new ZabbixAuthError('x')],
  ])('reads %s as a failure to read Zabbix', async (_what, make) => {
    sendResult = make();
    await build().tick();
    expect(own()[0]).toMatchObject({ reason: 'zabbix' });
  });

  it('hands the send the moment of the look as its clock, so the files carry it', async () => {
    await build().tick();
    expect(sent[0]!.now).toEqual(new Date(READY * 1000));
  });

  it('gives up exactly when the next try would pass the week, and not a second before', async () => {
    sendResult = new MailError('connect', 'x');
    // A failure at slot + week - 900 s would try again at the very end of the week: still allowed.
    now = SLOT + CATCH_UP_SECONDS - 900;
    await build().tick();
    expect(own()[0]).toMatchObject({ outcome: 'sending', nextAt: SLOT + CATCH_UP_SECONDS });

    await state.change((d) => void (d.mail.sends = []));
    now = SLOT + CATCH_UP_SECONDS - 899;
    await build().tick();
    expect(own()[0]).toMatchObject({ outcome: 'failed' });
    expect(own()[0]!.nextAt).toBeUndefined();
  });

  it('tells them it stopped trying, not that the report was missed, when a send that was tried runs out of days', async () => {
    sendResult = new MailError('connect', 'ECONNECTION');
    await build().tick();
    now = SLOT + CATCH_UP_SECONDS + 1;
    await build().tick();
    expect(notices.map((n) => n.subject)).toEqual(['HCML SLA report for October 2026 was not sent']);
    expect(notices[0]!.text).toContain('stopped trying');
  });

  it('reads a failure to reach Zabbix as that, tells them in words that fit, and goes on trying', async () => {
    sendResult = new ZabbixApiError('Zabbix could not answer.', 'http://zabbix.internal/api_jsonrpc.php');
    const job = build();
    await job.tick();
    expect(own()[0]).toMatchObject({ outcome: 'sending', reason: 'zabbix' });
    now = READY + 900;
    await job.tick();
    now += 3600;
    await job.tick();
    expect(notices[0]!.text).toContain('could not read the figures from Zabbix');
    expect(notices[0]!.text).not.toContain('zabbix.internal');
    expect(JSON.stringify(logged)).not.toContain('zabbix.internal');
  });

  it('reads any other failure as an error, and does not put its words in a notice', async () => {
    sendResult = new Error('Cannot read properties of undefined (reading secret)');
    const job = build();
    await job.tick();
    expect(own()[0]).toMatchObject({ reason: 'error' });
    now = READY + 900;
    await job.tick();
    now += 3600;
    await job.tick();
    expect(notices[0]!.text).toContain('The reason is in the portal log.');
    expect(notices[0]!.text).not.toContain('secret');
  });

  it('names the time of the last try in the notice at the end of the week, not the time the notice is written', async () => {
    const lastTry = READY + 900;
    await state.change((d) =>
      d.mail.sends.push({ month: '2026-10', trigger: 'schedule', by: 'schedule', at: lastTry, outcome: 'sending', attempts: 2, formats: ['pdf'], recipients: 0, refused: 0, bytes: 0, reason: 'connect', nextAt: lastTry + 3600 }),
    );
    now = SLOT + CATCH_UP_SECONDS + 7200;
    await build().tick();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain('the last try was at 1 Nov 2026 00:25 (Asia/Jakarta)');
    expect(own()[0]).toMatchObject({ outcome: 'failed', at: lastTry });
  });

  it('tells only the people who are still inside the domains a report may go to', async () => {
    settings = { ...settings, allowedDomains: ['example.org'] };
    await state.change((d) => void (d.mail.schedule = schedule({ notify: ['boss@example.org', 'out@elsewhere.net'] })));
    sendResult = new MailError('login', '535');
    const job = build();
    await job.tick();
    now = READY + 900;
    await job.tick();
    now += 3600;
    await job.tick();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.to).toEqual(['boss@example.org']);
  });

  it('sends no notice when nobody who asked is inside those domains', async () => {
    settings = { ...settings, allowedDomains: ['example.org'] };
    await state.change((d) => void (d.mail.schedule = schedule({ notify: ['out@elsewhere.net'] })));
    sendResult = new MailError('login', '535');
    const job = build();
    await job.tick();
    now = READY + 900;
    await job.tick();
    now += 3600;
    await job.tick();
    expect(notices).toEqual([]);
  });

  it('carries on from a send that a restart cut off in the middle', async () => {
    await state.change((d) =>
      d.mail.sends.push({ month: '2026-10', trigger: 'schedule', by: 'schedule', at: READY, outcome: 'sending', attempts: 1, formats: ['pdf'], recipients: 0, refused: 0, bytes: 0 }),
    );
    await build().tick();
    expect(sent).toHaveLength(1);
    expect(own()[0]).toMatchObject({ outcome: 'sent', attempts: 2 });
  });

  it('sends nobody a notice when it was told no one to tell, and still records and logs the failure', async () => {
    await state.change((d) => void (d.mail.schedule = schedule({ notify: [] })));
    sendResult = new MailError('login', '535');
    const job = build();
    await job.tick();
    now = READY + 900;
    await job.tick();
    now += 3600;
    await job.tick();
    expect(notices).toEqual([]);
    expect(own()[0]).toMatchObject({ attempts: 3, noticed: 1 });
    expect(logged.filter((l) => l.level === 'warn')).toHaveLength(3);
  });

  it('goes on when a notice cannot be sent, and says so in the log', async () => {
    sendResult = new MailError('login', '535');
    noticeResult = new MailError('login', '535');
    const job = build();
    await job.tick();
    now = READY + 900;
    await job.tick();
    now += 3600;
    await job.tick();
    expect(own()[0]).toMatchObject({ attempts: 3, outcome: 'sending' });
    expect(logged.some((l) => l.line.event === 'report_notice_failed')).toBe(true);
  });

  it('writes notices with no dash standing for punctuation and no address but the one they go to', async () => {
    sendResult = new MailError('connect', 'ECONNECTION');
    const job = build();
    await job.tick();
    for (let guard = 0; guard < 80 && own()[0]?.outcome === 'sending'; guard++) {
      now = own()[0]!.nextAt!;
      await job.tick();
    }
    for (const n of notices) {
      expect(`${n.subject}\n${n.text}`).not.toMatch(new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`));
      expect(n.text).not.toMatch(/ana@|budi@/);
    }
  });
});

describe('what the page is told', () => {
  it('names the next send before it, after it, and while a retry is waiting', async () => {
    const job = build();
    now = SLOT - 1000;
    expect(job.next()).toEqual({ month: '2026-10', at: READY, retrying: false });
    now = READY;
    await job.tick();
    expect(job.next()).toEqual({ month: '2026-11', at: at('2026-12-01T00:10:00+07:00'), retrying: false });

    await state.change((d) => void (d.mail.sends = []));
    sendResult = new MailError('connect', 'x');
    await job.tick();
    expect(job.next()).toEqual({ month: '2026-10', at: READY + 900, retrying: true });
  });

  it('says a send is a retry when one is due again', async () => {
    sendResult = new MailError('connect', 'x');
    const job = build();
    await job.tick();
    now = READY + 900;
    expect(job.next()).toEqual({ month: '2026-10', at: READY + 900, retrying: true });
  });

  it('names no next send when the schedule is off', async () => {
    await state.change((d) => void (d.mail.schedule = null));
    expect(build().next()).toBeNull();
  });
});

describe('starting and stopping', () => {
  // Memory in place of files: fake timers do not move real disk work, and nothing here is about the disk.
  const kept = async (): Promise<StateStore> => {
    const memory = Object.assign(memoryState(), { durable: true });
    await memory.change((d) => {
      d.mail.recipients = SEED;
      d.mail.schedule = schedule();
    });
    return memory;
  };
  beforeEach(async () => {
    vi.useFakeTimers();
    state = await kept();
  });
  afterEach(() => vi.useRealTimers());

  it('looks every minute and not oftener: a month cleared after the first look is sent again only at the next minute', async () => {
    const job = build();
    job.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(1);
    await state.change((d) => void (d.mail.sends = []));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toHaveLength(2);
    job.stop();
  });

  it('does not send when it is stopped before the first look', async () => {
    const job = build();
    job.start();
    job.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sent).toEqual([]);
  });

  it('keeps neither of its timers alive', () => {
    const job = build();
    const interval = vi.spyOn(globalThis, 'setInterval');
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    job.start();
    expect((interval.mock.results[0]!.value as NodeJS.Timeout).hasRef()).toBe(false);
    expect((timeout.mock.results[0]!.value as NodeJS.Timeout).hasRef()).toBe(false);
    job.stop();
  });

  it('looks once a minute while it runs, and not after it is stopped', async () => {
    const job = build();
    job.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);
    await state.change((d) => void (d.mail.sends = []));
    job.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sent).toHaveLength(1);
  });

  it('does not keep the process alive', () => {
    const job = build();
    const spy = vi.spyOn(globalThis, 'setInterval');
    job.start();
    const timer = spy.mock.results[0]!.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    job.stop();
  });

  it('looks soon after it starts, not only a minute later', async () => {
    const job = build();
    job.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
    job.stop();
  });

  it('starts once however often it is asked', () => {
    const job = build();
    const spy = vi.spyOn(globalThis, 'setInterval');
    job.start();
    job.start();
    expect(spy).toHaveBeenCalledTimes(1);
    job.stop();
  });

  it('survives a look that fails, and logs it', async () => {
    const broken = Object.assign(memoryState(), { durable: true });
    broken.read = () => {
      throw new Error('boom');
    };
    const job = build({ state: () => broken, settings: () => settings });
    job.start();
    await vi.advanceTimersByTimeAsync(70_000);
    expect(logged.some((l) => l.line.event === 'report_schedule_error')).toBe(true);
    job.stop();
  });
});

describe('a refused recipient list is a mistake in the data, not a crash', () => {
  it('records the reason as recipients when the check throws', async () => {
    settings = { ...settings, allowedDomains: ['hcml.co.id'] };
    const job = build({
      send: async () => {
        throw new BadRequestError('nope');
      },
    });
    await job.tick();
    expect(own()[0]).toMatchObject({ reason: 'recipients' });
  });
});

describe('a send that the mail server took and the state could not record', () => {
  // Writes work until the message has gone, and fail from then on, as a disk that fills or goes read-only in the middle of a send would.
  const breakAfterSend = () => {
    const real = state;
    const flag = { broken: false };
    state = {
      ...real,
      failing: () => flag.broken,
      change: async (edit) => {
        if (flag.broken) throw new StateWriteError('ENOSPC');
        return real.change(edit);
      },
    };
    return flag;
  };
  const sendThenBreak =
    (flag: { broken: boolean }): ScheduleDeps['send'] =>
    async (req) => {
      sent.push(req);
      flag.broken = true;
      return { files: req.formats.map((format) => ({ format, fileName: `f.${format}`, bytes: 500 })), accepted: req.to.length, refused: 0, bytes: 1000 };
    };

  it('does not send the month again when the folder is back, and records it as sent', async () => {
    const flag = breakAfterSend();
    const job = build({ send: sendThenBreak(flag) });
    await job.tick();
    expect(sent).toHaveLength(1);
    flag.broken = false;
    now += 60;
    await job.tick();
    now += 3600;
    await job.tick();
    expect(sent).toHaveLength(1);
    expect(own()).toEqual([expect.objectContaining({ month: '2026-10', outcome: 'sent', recipients: 2 })]);
  });

  it('writes the report_email line when the mail server takes the message, before a save is tried', async () => {
    const flag = breakAfterSend();
    await build({ send: sendThenBreak(flag) }).tick();
    const lines = logged.filter((l) => l.line.event === 'report_email');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'info', line: { outcome: 'sent', recipients: 2 } });
  });

  it('still says, once, that the folder cannot be written', async () => {
    const flag = breakAfterSend();
    await build({ send: sendThenBreak(flag) }).tick();
    expect(logged.filter((l) => l.line.event === 'report_state_unwritable')).toHaveLength(1);
  });

  it('records it as sent, and not as changed, when the schedule was moved while the folder was down', async () => {
    const flag = breakAfterSend();
    const job = build({ send: sendThenBreak(flag) });
    await job.tick();
    flag.broken = false;
    // What the route does when the day moves: the month still being tried is given up, and the new slot starts from now.
    await state.change((d) => {
      for (const r of d.mail.sends) {
        r.outcome = 'failed';
        r.reason = 'changed';
        delete r.nextAt;
      }
      d.mail.schedule = schedule({ day: 2, enabledAt: now });
    });
    now += 60;
    await job.tick();
    expect(sent).toHaveLength(1);
    expect(own()).toEqual([expect.objectContaining({ month: '2026-10', outcome: 'sent', recipients: 2 })]);
    expect(own()[0]).not.toHaveProperty('reason');
  });

  it('records it as sent, and tells nobody that it was not sent, when the folder is back only after the week of retries has ended', async () => {
    const flag = breakAfterSend();
    const job = build({ send: sendThenBreak(flag) });
    await job.tick();
    flag.broken = false;
    now += CATCH_UP_SECONDS + 3600;
    await job.tick();
    expect(own()).toEqual([expect.objectContaining({ month: '2026-10', outcome: 'sent' })]);
    expect(notices).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('records it as sent even when the schedule has been switched off since', async () => {
    const flag = breakAfterSend();
    const job = build({ send: sendThenBreak(flag) });
    await job.tick();
    flag.broken = false;
    await state.change((d) => {
      d.mail.schedule = schedule({ enabled: false });
    });
    now += 60;
    await job.tick();
    expect(own()).toEqual([expect.objectContaining({ month: '2026-10', outcome: 'sent' })]);
  });

  it('records it when the record of the month is gone from the state, instead of failing at every minute', async () => {
    const flag = breakAfterSend();
    const job = build({ send: sendThenBreak(flag) });
    await job.tick();
    flag.broken = false;
    await state.change((d) => {
      d.mail.sends = [];
    });
    now += 60;
    await job.tick();
    now += 60;
    await job.tick();
    expect(sent).toHaveLength(1);
    expect(own()).toEqual([expect.objectContaining({ month: '2026-10', outcome: 'sent', recipients: 2 })]);
    expect(logged.filter((l) => l.line.event === 'report_schedule_error')).toEqual([]);
  });
});

describe('stopping while a send is running', () => {
  const held = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    return { gate, release: () => release() };
  };

  it('waits for the running send to be recorded before it returns', async () => {
    const hold = held();
    const job = build({
      send: async (req) => {
        sent.push(req);
        await hold.gate;
        return { files: [], accepted: req.to.length, refused: 0, bytes: 1000 };
      },
    });
    const ticking = job.tick();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    let stopped = false;
    const stopping = job.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    hold.release();
    await stopping;
    expect(stopped).toBe(true);
    await ticking;
    expect(own()).toEqual([expect.objectContaining({ outcome: 'sent' })]);
  });

  it('does not wait for ever on a send that never ends', async () => {
    const job = build({ send: () => new Promise(() => undefined), stopWaitMs: 30 });
    void job.tick();
    await vi.waitFor(() => expect(own()).toHaveLength(1));
    const t0 = Date.now();
    await job.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('returns at once when nothing is running', async () => {
    const job = build();
    job.start();
    const t0 = performance.now();
    await job.stop();
    expect(performance.now() - t0).toBeLessThan(200);
    expect(sent).toEqual([]);
  });
});

describe('a recipient the mail server refused', () => {
  const taking =
    (accepted: number, refused: number): ScheduleDeps['send'] =>
    async (req) => {
      sent.push(req);
      return { files: [], accepted, refused, bytes: 1000 };
    };

  it('logs the send at warning level, with the numbers', async () => {
    await build({ send: taking(1, 1) }).tick();
    const line = logged.find((l) => l.line.event === 'report_email')!;
    expect(line).toMatchObject({ level: 'warn', line: { outcome: 'sent', recipients: 1, refused: 1 } });
  });

  it('tells the people to tell, once, with the numbers and never an address', async () => {
    const job = build({ send: taking(1, 1) });
    await job.tick();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.to).toEqual(['boss@example.org']);
    expect(notices[0]!.subject).toMatch(/October 2026.*did not reach everyone/);
    expect(notices[0]!.text).toMatch(/took it for 1 of 2 addresses and refused 1/);
    expect(notices[0]!.text).not.toMatch(/ana@|budi@/);
    now += 3600;
    await job.tick();
    expect(notices).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('still counts the month as sent', async () => {
    await build({ send: taking(1, 1) }).tick();
    expect(own()).toEqual([expect.objectContaining({ outcome: 'sent', recipients: 1, refused: 1 })]);
  });

  it('says nothing when every address took the message', async () => {
    await build({ send: taking(2, 0) }).tick();
    expect(notices).toEqual([]);
    expect(logged.find((l) => l.line.event === 'report_email')).toMatchObject({ level: 'info' });
  });

  it('logs and goes on when the notice cannot be sent', async () => {
    noticeResult = new MailError('connect', 'x');
    await build({ send: taking(1, 1) }).tick();
    expect(logged.filter((l) => l.line.event === 'report_notice_failed')).toHaveLength(1);
    expect(own()[0]).toMatchObject({ outcome: 'sent' });
  });

  it('does not lose the notice to a save that fails after the month was recorded', async () => {
    // Two saves are the record before the send and the record of it. A third has nothing to write, and must not be needed.
    const real = state;
    let writes = 0;
    state = {
      ...real,
      change: async (edit) => {
        writes++;
        if (writes === 3) throw new StateWriteError('ENOSPC');
        return real.change(edit);
      },
    };
    await build({ send: taking(1, 1) }).tick();
    expect(notices).toHaveLength(1);
  });
});

describe('closing the portal', () => {
  afterEach(() => vi.useRealTimers());

  it('starts no new check once it is paused, however long the server takes to drain', async () => {
    vi.useFakeTimers();
    const job = build();
    job.start();
    job.pause();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sent).toEqual([]);
  });

  it('counts the wait for a running check from the pause and not from the stop', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const job = build({ send: () => new Promise(() => undefined), stopWaitMs: 600 });
    void job.tick();
    await vi.waitFor(() => expect(own()).toHaveLength(1));
    job.pause();
    vi.setSystemTime(450); // the server spent 450 ms draining its requests
    const t0 = performance.now();
    await job.stop();
    // 150 ms are left of the 600; counted from the stop, it would be all 600.
    expect(performance.now() - t0).toBeLessThan(400);
  });

  it('does not wait at all when the drain has already used the whole wait', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const job = build({ send: () => new Promise(() => undefined), stopWaitMs: 600 });
    void job.tick();
    await vi.waitFor(() => expect(own()).toHaveLength(1));
    job.pause();
    vi.setSystemTime(700);
    const t0 = performance.now();
    await job.stop();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('a report with no device in it (BK-51)', () => {
  it('counts as a failed try with its own reason, and is tried again', async () => {
    const { EmptyReportError } = await import('../core/validate.js');
    sendResult = new EmptyReportError('The report has no device in it.');
    const job = build();
    await job.tick();
    expect(own()[0]).toMatchObject({ outcome: 'sending', attempts: 1, reason: 'empty', nextAt: READY + 900 });
    // The log says how this try ended; the record says that another one is planned.
    expect(logged.some((l) => l.line.event === 'report_email' && l.line.outcome === 'failed' && l.line.reason === 'empty')).toBe(true);
  });

  it('tells the people after the third try, in words that say what was empty', async () => {
    const { EmptyReportError } = await import('../core/validate.js');
    sendResult = new EmptyReportError('The report has no device in it.');
    const job = build();
    await job.tick();
    now = READY + 900;
    await job.tick();
    now = READY + 900 + 3600;
    await job.tick();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toMatch(/no device/i);
    expect(notices[0]!.text).toContain('SLA triggers');
  });

  it('is never recorded as sent', async () => {
    const { EmptyReportError } = await import('../core/validate.js');
    sendResult = new EmptyReportError('The report has no device in it.');
    await build().tick();
    expect(own().some((r) => r.outcome === 'sent')).toBe(false);
  });
});

describe('what the people are told when the last try may have gone through (BK-52)', () => {
  const giveUp = async () => {
    const job = build();
    await job.tick();
    for (let guard = 0; guard < 80 && own()[0]?.outcome === 'sending'; guard++) {
      now = own()[0]!.nextAt!;
      await job.tick();
    }
  };

  it('does not say that nobody has received a report whose last try timed out', async () => {
    sendResult = new MailError('timeout', 'ETIMEDOUT');
    await giveUp();
    const last = notices[notices.length - 1]!;
    expect(last.subject).toBe('HCML SLA report for October 2026 was not sent');
    expect(last.text).not.toContain('Nobody has received it');
    expect(last.text).toContain('may or may not');
    expect(last.text).toContain('ask the people');
    expect(last.text).toContain('It may have reached some or all of the people.');
  });

  it('keeps the doubt of an earlier timeout through later tries that failed for certain', async () => {
    const job = build();
    sendResult = new MailError('timeout', 'ETIMEDOUT');
    await job.tick();
    expect(own()[0]).toMatchObject({ outcome: 'sending', reason: 'timeout', unsure: true });
    sendResult = new MailError('connect', 'ECONNREFUSED');
    for (let guard = 0; guard < 80 && own()[0]?.outcome === 'sending'; guard++) {
      now = own()[0]!.nextAt!;
      await job.tick();
    }
    const last = notices[notices.length - 1]!;
    expect(last.subject).toBe('HCML SLA report for October 2026 was not sent');
    expect(last.text).not.toContain('Nobody has received it');
    expect(last.text).toContain('It may have reached some or all of the people.');
    // The page and the log say how the last try ended; the doubt is the scheduler's own.
    expect(own()[0]).toMatchObject({ outcome: 'failed', reason: 'connect', unsure: true });
  });

  it('does not mark a month that only ever failed for certain', async () => {
    sendResult = new MailError('connect', 'ECONNREFUSED');
    await giveUp();
    expect(own()[0]!.unsure).toBeUndefined();
    expect(notices[notices.length - 1]!.text).toContain('Nobody has received it');
  });

  it('forgets the doubt once a try gets through', async () => {
    const job = build();
    sendResult = new MailError('timeout', 'ETIMEDOUT');
    await job.tick();
    expect(own()[0]!.unsure).toBe(true);
    sendResult = null;
    now = own()[0]!.nextAt!;
    await job.tick();
    expect(own()[0]).toMatchObject({ outcome: 'sent' });
    expect(own()[0]!.unsure).toBeUndefined();
  });

  it('does not say that nobody has it when the last try never ended, as when the portal stopped in the middle of a send', async () => {
    await state.change((d) =>
      d.mail.sends.push({ month: '2026-10', trigger: 'schedule', by: 'schedule', at: SLOT + 30, outcome: 'sending', attempts: 1, formats: ['pdf'], recipients: 0, refused: 0, bytes: 0 }),
    );
    now = SLOT + CATCH_UP_SECONDS + 1;
    await build().tick();
    const last = notices[notices.length - 1]!;
    expect(last.subject).toBe('HCML SLA report for October 2026 was not sent');
    expect(last.text).not.toContain('Nobody has received it');
    expect(last.text).toContain('It may have reached some or all of the people.');
  });

  describe('when several months went by', () => {
    const DEC = at('2026-12-04T10:00:00+07:00');
    const fromAugust = () => state.change((d) => void (d.mail.schedule = schedule({ enabledAt: at('2026-08-20T00:00:00+07:00') })));

    it('says that nobody has received them when no try was made for any month', async () => {
      await fromAugust();
      now = DEC;
      await build().tick();
      const text = notices[0]!.text;
      expect(text).toContain('Nobody has received them.');
      expect(text).not.toContain('may have reached');
    });

    it('names the month whose last try timed out as one that may have reached the people, and still says the others were not sent', async () => {
      await fromAugust();
      await state.change((d) =>
        d.mail.sends.push({ month: '2026-09', trigger: 'schedule', by: 'schedule', at: at('2026-10-01T00:30:00+07:00'), outcome: 'sending', attempts: 2, nextAt: at('2026-10-01T01:30:00+07:00'), reason: 'timeout', unsure: true, formats: ['pdf'], recipients: 0, refused: 0, bytes: 0 }),
      );
      now = DEC;
      await build().tick();
      const text = notices[0]!.text;
      expect(text).not.toContain('Nobody has received them.');
      expect(text).toContain('The report for September 2026 may have reached some or all of the people; the others were not sent.');
    });

    it('says the same for a month whose try never ended', async () => {
      await fromAugust();
      await state.change((d) =>
        d.mail.sends.push({ month: '2026-10', trigger: 'schedule', by: 'schedule', at: at('2026-11-01T00:30:00+07:00'), outcome: 'sending', attempts: 1, formats: ['pdf'], recipients: 0, refused: 0, bytes: 0 }),
      );
      now = DEC;
      await build().tick();
      expect(notices[0]!.text).toContain('The report for October 2026 may have reached some or all of the people; the others were not sent.');
    });
  });

  it('still says that nobody has received it when the mail server refused the login', async () => {
    sendResult = new MailError('login', '535');
    await giveUp();
    expect(notices[notices.length - 1]!.text).toContain('Nobody has received it');
  });
});
