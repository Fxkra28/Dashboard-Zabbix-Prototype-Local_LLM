import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_RECIPIENTS } from '../core/mailConfig.js';
import { MAX_SENDS_KEPT, StateWriteError, emptyState, openState, readState, type PortalState, type Schedule, type SendRecord } from '../core/state.js';

/**
 * The portal's one small file of its own: the saved recipients, the monthly schedule and a short record of what was
 * sent. Real files in a real folder, since the promise is about what survives a restart. No addresses are real.
 */

let dir: string;
let said: string[];
const warn = (m: string) => void said.push(m);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portal-state-'));
  said = [];
});
afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  enabled: true,
  day: 1,
  time: '00:00',
  formats: ['pdf'],
  style: { decimal: 'dot', date: 'long', separator: 'comma' },
  notify: [],
  enabledAt: 1_800_000_000,
  setBy: 'ana',
  setAt: 1_800_000_000,
  ...over,
});
const send = (over: Partial<SendRecord> = {}): SendRecord => ({
  month: '2026-10',
  trigger: 'schedule',
  by: 'schedule',
  at: 1_800_000_100,
  outcome: 'sent',
  attempts: 1,
  formats: ['pdf'],
  recipients: 2,
  refused: 0,
  bytes: 1234,
  ...over,
});
const FILE = () => join(dir, 'portal-state.json');
const rawFile = () => JSON.parse(readFileSync(FILE(), 'utf8')) as unknown;

describe('a portal with no place to keep it', () => {
  it('starts empty, says it is not kept, and works in memory for as long as the portal runs', async () => {
    const store = await openState('', warn);
    expect(store.durable).toBe(false);
    expect(store.read()).toEqual(emptyState());
    await store.change((s) => void (s.mail.recipients = ['ana@example.org']));
    expect(store.read().mail.recipients).toEqual(['ana@example.org']);
    expect(said).toEqual([]);
  });

  it('hands out copies, so a caller cannot change what is kept by changing what it was given', async () => {
    const store = await openState('', warn);
    await store.change((s) => void (s.mail.recipients = ['ana@example.org']));
    const copy = store.read();
    copy.mail.recipients.push('spy@example.net');
    copy.mail.sends.push(send());
    expect(store.read().mail.recipients).toEqual(['ana@example.org']);
    expect(store.read().mail.sends).toEqual([]);
  });

  it('hands the edit a copy too: an edit that throws leaves the state as it was', async () => {
    const store = await openState('', warn);
    await store.change((s) => void (s.mail.recipients = ['ana@example.org']));
    await expect(
      store.change((s) => {
        s.mail.recipients.push('budi@example.org');
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(store.read().mail.recipients).toEqual(['ana@example.org']);
  });
});

describe('a folder to keep it in', () => {
  it('writes the empty state at once, so a folder that cannot be written is found at start-up and not at the first save', async () => {
    const store = await openState(dir, warn);
    expect(store.durable).toBe(true);
    expect(rawFile()).toEqual({ version: 1, mail: { recipients: [], schedule: null, sends: [] } });
  });

  it('keeps what was changed, and a new store over the same folder reads it back', async () => {
    const first = await openState(dir, warn);
    await first.change((s) => {
      s.mail.recipients = ['ana@example.org', 'budi@example.org'];
      s.mail.schedule = schedule({ day: 5, time: '08:30', formats: ['pdf', 'csv'], notify: ['ana@example.org'] });
      s.mail.sends.push(
        send({ month: '2026-09', outcome: 'failed', attempts: 4, reason: 'login' }),
        send({ month: '2026-08', outcome: 'sending', attempts: 2, reason: 'zabbix', nextAt: 1_800_000_900, noticed: 1 }),
        send(),
      );
    });
    const second = await openState(dir, warn);
    expect(second.read()).toEqual(first.read());
    expect(second.read().mail.schedule).toMatchObject({ day: 5, time: '08:30', formats: ['pdf', 'csv'] });
    expect(said).toEqual([]);
  });

  it('keeps the file to its owner, since it holds addresses', async () => {
    await openState(dir, warn);
    expect(statSync(FILE()).mode & 0o777).toBe(0o600);
  });

  it('leaves no half-written file behind', async () => {
    const store = await openState(dir, warn);
    await store.change((s) => void (s.mail.recipients = ['ana@example.org']));
    expect(readdirSync(dir)).toEqual(['portal-state.json']);
  });

  it('makes the folder when it is not there yet', async () => {
    const nested = join(dir, 'a', 'b');
    const store = await openState(nested, warn);
    expect(store.durable).toBe(true);
    expect(existsSync(join(nested, 'portal-state.json'))).toBe(true);
  });

  it('holds no address or password in the log line it writes on failure', async () => {
    const store = await openState(dir, warn);
    await store.change((s) => void (s.mail.recipients = ['secret.person@example.org']));
    expect(said.join(' ')).not.toContain('secret.person');
  });

  it('applies two changes made at once one after the other, with neither lost', async () => {
    const store = await openState(dir, warn);
    await Promise.all([
      store.change((s) => void s.mail.recipients.push('a@example.org')),
      store.change((s) => void s.mail.recipients.push('b@example.org')),
      store.change((s) => void s.mail.recipients.push('c@example.org')),
    ]);
    expect(store.read().mail.recipients).toEqual(['a@example.org', 'b@example.org', 'c@example.org']);
    expect((rawFile() as PortalState).mail.recipients).toEqual(['a@example.org', 'b@example.org', 'c@example.org']);
  });

  it('keeps a change that follows one that failed', async () => {
    const store = await openState(dir, warn);
    await expect(store.change(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    await store.change((s) => void (s.mail.recipients = ['ana@example.org']));
    expect(store.read().mail.recipients).toEqual(['ana@example.org']);
  });

  it('keeps the newest 24 sends and drops the oldest', async () => {
    expect(MAX_SENDS_KEPT).toBe(24);
    const store = await openState(dir, warn);
    await store.change((s) => {
      for (let i = 0; i < 29; i++) s.mail.sends.push(send({ month: `2025-${String((i % 12) + 1).padStart(2, '0')}`, at: 1_800_000_000 + i, attempts: i + 1 }));
    });
    const kept = store.read().mail.sends;
    expect(kept).toHaveLength(24);
    expect(kept[0]!.attempts).toBe(6);
    expect(kept.at(-1)!.attempts).toBe(29);
  });

  it('drops the manual sends before the schedule’s own, so a busy week cannot make the portal forget a month it sent', async () => {
    const store = await openState(dir, warn);
    await store.change((s) => {
      s.mail.sends.push(send({ month: '2026-10', at: 1_800_000_001 }));
      for (let i = 0; i < 30; i++) s.mail.sends.push(send({ trigger: 'manual', by: 'ana', at: 1_800_000_100 + i, attempts: i + 1 }));
    });
    const kept = store.read().mail.sends;
    expect(kept).toHaveLength(24);
    expect(kept.filter((r) => r.trigger === 'schedule')).toHaveLength(1);
    expect(kept.filter((r) => r.trigger === 'manual').map((r) => r.attempts)).toEqual(Array.from({ length: 23 }, (_, i) => i + 8));
  });

  it('drops the schedule’s own oldest record only when there is no manual send left to drop', async () => {
    const store = await openState(dir, warn);
    await store.change((s) => {
      for (let i = 0; i < 26; i++) s.mail.sends.push(send({ month: `2025-${String((i % 12) + 1).padStart(2, '0')}`, attempts: i + 1 }));
    });
    const kept = store.read().mail.sends;
    expect(kept).toHaveLength(24);
    expect(kept[0]!.attempts).toBe(3);
  });

  it('keeps the schedule’s own records when a file with too many is read at start-up', () => {
    const raw = { version: 1, mail: { recipients: [], schedule: null, sends: [send({ attempts: 1 }), ...Array.from({ length: 28 }, (_, i) => send({ trigger: 'manual', by: 'ana', attempts: i + 2 }))] } };
    const { state } = readState(raw);
    expect(state.mail.sends).toHaveLength(24);
    expect(state.mail.sends[0]).toMatchObject({ trigger: 'schedule', attempts: 1 });
  });

  it('removes the temporary file when a save fails, and leaves nothing half written', async () => {
    const store = await openState(dir, warn);
    // A folder where the file belongs: the new file cannot be moved over it.
    rmSync(FILE());
    mkdirSync(FILE());
    await expect(store.change((s) => void (s.mail.recipients = ['ana@example.org']))).rejects.toBeInstanceOf(StateWriteError);
    expect(readdirSync(dir)).toEqual(['portal-state.json']);
    expect(statSync(FILE()).isDirectory()).toBe(true);
  });
});

describe('a file that cannot be used', () => {
  const broken = () => readdirSync(dir).filter((f) => f.startsWith('portal-state.json.broken-'));

  it.each([
    ['text that is not JSON', 'not json at all'],
    ['an empty file', ''],
    ['JSON that is not an object', '[1,2,3]'],
    ['a file from another version', JSON.stringify({ version: 2, mail: { recipients: [], schedule: null, sends: [] } })],
    ['an object with no version', JSON.stringify({ mail: { recipients: [], schedule: null, sends: [] } })],
    ['an object with no mail part', JSON.stringify({ version: 1 })],
    ['an object whose mail part is a list', JSON.stringify({ version: 1, mail: [] })],
  ])('is put aside, not deleted, and the portal starts empty and says so: %s', async (_what, content) => {
    writeFileSync(FILE(), content);
    const store = await openState(dir, warn);
    expect(store.read()).toEqual(emptyState());
    expect(broken()).toHaveLength(1);
    expect(readFileSync(join(dir, broken()[0]!), 'utf8')).toBe(content);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/put aside/);
    expect(rawFile()).toEqual({ version: 1, mail: { recipients: [], schedule: null, sends: [] } });
  });
});

describe('a file with something wrong in part of it', () => {
  const write = (mail: unknown) => writeFileSync(FILE(), JSON.stringify({ version: 1, mail }));

  it('drops a recipient that is not a plain address, and keeps the rest, saying so', async () => {
    write({ recipients: ['ana@example.org', 'nope', 'ana@example.org\r\nBcc: x@example.net', 42, 'budi@example.org'], schedule: null, sends: [] });
    const store = await openState(dir, warn);
    expect(store.read().mail.recipients).toEqual(['ana@example.org', 'budi@example.org']);
    expect(said.join(' ')).toMatch(/recipient/);
  });

  it('keeps at most the limit of recipients', async () => {
    write({ recipients: Array.from({ length: 14 }, (_, i) => `p${i}@example.org`), schedule: null, sends: [] });
    expect((await openState(dir, warn)).read().mail.recipients).toHaveLength(10);
  });

  it('keeps a list of exactly the limit whole, and says nothing', async () => {
    const list = Array.from({ length: MAX_RECIPIENTS }, (_, i) => `p${i}@example.org`);
    write({ recipients: list, schedule: null, sends: [] });
    expect((await openState(dir, warn)).read().mail.recipients).toEqual(list);
    expect(said).toEqual([]);
  });

  it('cuts a list that is one over the limit to its first addresses, and says so', async () => {
    const list = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `p${i}@example.org`);
    write({ recipients: list, schedule: null, sends: [] });
    expect((await openState(dir, warn)).read().mail.recipients).toEqual(list.slice(0, MAX_RECIPIENTS));
    expect(said.join(' ')).toContain(`cut the recipients to ${MAX_RECIPIENTS}`);
  });

  it.each([
    ['a day past 28', { day: 31 }],
    ['a day of zero', { day: 0 }],
    ['a day that is not whole', { day: 1.5 }],
    ['a time that is not a time', { time: '25:00' }],
    ['a time with seconds', { time: '08:00:00' }],
    ['no files', { formats: [] }],
    ['a file kind it does not make', { formats: ['pdf', 'exe'] }],
    ['a separator it does not know', { style: { decimal: 'dot', date: 'long', separator: 'tab' } }],
    ['a date style it does not know', { style: { decimal: 'dot', date: 'short', separator: 'comma' } }],
    ['a decimal mark it does not know', { style: { decimal: 'point', date: 'long', separator: 'comma' } }],
    ['a time of 99:99', { time: '99:99' }],
    ['a time of 8:00', { time: '8:00' }],
    ['more than three people to tell', { notify: ['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org'] }],
    ['someone to tell who is not an address', { notify: ['nope'] }],
    ['a switch that is not a switch', { enabled: 'yes' }],
    ['a time of enabling that is not a number', { enabledAt: 'yesterday' }],
  ])('drops a schedule with %s, rather than guess what was meant, and says so', async (_what, over) => {
    write({ recipients: [], schedule: { ...schedule(), ...over }, sends: [] });
    const store = await openState(dir, warn);
    expect(store.read().mail.schedule).toBeNull();
    expect(said.join(' ')).toMatch(/schedule/);
  });

  it('takes a schedule that is whole', async () => {
    write({ recipients: [], schedule: schedule({ day: 28, time: '23:59', formats: ['xlsx', 'csv', 'pdf'] }), sends: [] });
    const store = await openState(dir, warn);
    expect(store.read().mail.schedule).toMatchObject({ day: 28, time: '23:59', formats: ['pdf', 'xlsx', 'csv'] });
    expect(said).toEqual([]);
  });

  it.each([
    ['a month that is not one', { month: 'October' }],
    ['a month of 13', { month: '2026-13' }],
    ['a trigger it does not know', { trigger: 'robot' }],
    ['no name for who sent it', { by: '' }],
    ['a name too long', { by: 'x'.repeat(65) }],
    ['an outcome it does not know', { outcome: 'exploded' }],
    ['a negative count of tries', { attempts: -1 }],
    ['a count of tries that is not whole', { attempts: 1.5 }],
    ['no files', { formats: [] }],
    ['a file kind it does not make', { formats: ['exe'] }],
    ['a negative count of people', { recipients: -1 }],
    ['a negative count refused', { refused: -1 }],
    ['a size that is text', { bytes: 'big' }],
    ['a reason too long', { reason: 'x'.repeat(41) }],
    ['a reason that is not text', { reason: 5 }],
    ['a next try that is not a time', { nextAt: -5 }],
    ['a count of notices out of range', { noticed: 10 }],
  ])('drops a record with %s, and says so', async (_what, over) => {
    write({ recipients: [], schedule: null, sends: [{ ...send(), ...over }, send({ month: '2026-09' })] });
    const store = await openState(dir, warn);
    expect(store.read().mail.sends.map((r) => r.month)).toEqual(['2026-09']);
    expect(said.join(' ')).toMatch(/record/);
  });

  it('keeps a record that carries a reason, a next try and a count of notices, as it was', async () => {
    const full = send({ outcome: 'sending', reason: 'zabbix', nextAt: 1_800_000_900, noticed: 1 });
    write({ recipients: [], schedule: null, sends: [full] });
    expect((await openState(dir, warn)).read().mail.sends).toEqual([full]);
    expect(said).toEqual([]);
  });

  it('keeps a recipient once, whatever its case', async () => {
    write({ recipients: ['ana@example.org', 'ANA@example.org', 'budi@example.org'], schedule: null, sends: [] });
    expect((await openState(dir, warn)).read().mail.recipients).toEqual(['ana@example.org', 'budi@example.org']);
  });

  it('writes a repaired file back, so the repair is made once and not said at every start', async () => {
    write({ recipients: ['ana@example.org', 'nope'], schedule: null, sends: [] });
    await openState(dir, warn);
    expect(said).toHaveLength(1);
    expect((rawFile() as PortalState).mail.recipients).toEqual(['ana@example.org']);
    said.length = 0;
    await openState(dir, warn);
    expect(said).toEqual([]);
  });

  it('says what it repaired, once for each kind of thing, however many there were', async () => {
    write({ recipients: ['a', 'b', 'c'], schedule: null, sends: [] });
    await openState(dir, warn);
    expect(said).toEqual(['State: dropped a recipient that is not a plain address.']);
  });

  it('drops a record of a send that is not whole, and keeps the others', async () => {
    write({
      recipients: [],
      schedule: null,
      sends: [send(), { month: 'October', outcome: 'sent' }, send({ outcome: 'exploded' as never }), 'x', send({ month: '2026-09', outcome: 'missed', reason: 'zabbix' })],
    });
    const store = await openState(dir, warn);
    expect(store.read().mail.sends.map((r) => r.month)).toEqual(['2026-10', '2026-09']);
    expect(said.join(' ')).toMatch(/record/);
  });

  it('drops a field that was never part of the state, so it cannot grow', async () => {
    writeFileSync(FILE(), JSON.stringify({ version: 1, extra: 1, mail: { recipients: [], schedule: null, sends: [], note: 'x' } }));
    const store = await openState(dir, warn);
    expect(Object.keys(store.read())).toEqual(['version', 'mail']);
    expect(Object.keys(store.read().mail)).toEqual(['recipients', 'schedule', 'sends']);
  });
});

describe('readState on its own', () => {
  it('reports what it repaired, one line for each', () => {
    const { state, repairs } = readState({ version: 1, mail: { recipients: ['nope', 'ana@example.org'], schedule: { nonsense: true }, sends: [{}] } });
    expect(state.mail.recipients).toEqual(['ana@example.org']);
    expect(state.mail.schedule).toBeNull();
    expect(repairs).toHaveLength(3);
  });

  it('is not fooled by a name an object inherits', () => {
    const { state } = readState(JSON.parse('{"version":1,"mail":{"recipients":["constructor"],"schedule":null,"sends":[],"__proto__":{"recipients":["x@example.org"]}}}'));
    expect(state.mail.recipients).toEqual([]);
  });
});

describe('a state file that cannot be read (IN-63)', () => {
  // A folder where the file should be fails the read for every user, so the case holds as root too.
  it('says it cannot read it, and not that the folder cannot be written, and runs without keeping anything', async () => {
    mkdirSync(FILE());
    const store = await openState(dir, warn);
    expect(store.durable).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/cannot read/);
    expect(said[0]).not.toMatch(/cannot write/);
    expect(said[0]).toMatch(/PORTAL_STATE_DIR/);
    expect(said[0]).toMatch(/not be kept/);
  });

  it('names the likely cause for a person to look at: the file belonging to another user', async () => {
    mkdirSync(FILE());
    await openState(dir, warn);
    expect(said[0]).toMatch(/another user/);
  });
});

describe('a folder that cannot be written', () => {
  const root = typeof process.getuid === 'function' && process.getuid() === 0;

  it.skipIf(root)('is found at start-up: the portal runs without keeping anything and says so', async () => {
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    const store = await openState(locked, warn);
    chmodSync(locked, 0o700);
    expect(store.durable).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/not kept|not be kept/);
    expect(said[0]).toMatch(/cannot write/);
    expect(said[0]).not.toMatch(/cannot read/);
  });

  it.skipIf(root)('refuses a change it cannot save, says so in a plain sentence, and keeps the state it had', async () => {
    const store = await openState(dir, warn);
    await store.change((s) => void (s.mail.recipients = ['ana@example.org']));
    chmodSync(dir, 0o500);
    const failure = await store.change((s) => void (s.mail.recipients = ['budi@example.org'])).catch((e: unknown) => e);
    chmodSync(dir, 0o700);
    expect(failure).toBeInstanceOf(StateWriteError);
    expect((failure as Error).message).toBe('The portal could not save this. Check that its data folder can be written.');
    expect(store.read().mail.recipients).toEqual(['ana@example.org']);
    expect((rawFile() as PortalState).mail.recipients).toEqual(['ana@example.org']);
  });

  it.skipIf(root)('says it is failing after a save that did not go through, and stops saying so after one that does', async () => {
    const store = await openState(dir, warn);
    expect(store.failing()).toBe(false);
    chmodSync(dir, 0o500);
    await store.change((s) => void (s.mail.recipients = ['budi@example.org'])).catch(() => undefined);
    chmodSync(dir, 0o700);
    expect(store.failing()).toBe(true);
    await store.change(() => undefined);
    expect(store.failing()).toBe(false);
  });

  it('is never failing when nothing is kept on disk', async () => {
    const store = await openState('', warn);
    await store.change((s) => void (s.mail.recipients = ['ana@example.org']));
    expect(store.failing()).toBe(false);
  });

  it('does not put the folder’s path into the sentence a person reads', async () => {
    const store = await openState('', warn);
    expect(new StateWriteError('x').message).not.toContain(dir);
    expect(store.durable).toBe(false);
  });
});

describe('a change that would leave the state unusable', () => {
  it('is refused before anything is written, since it is a mistake in the code and not in the data', async () => {
    const store = await openState(dir, warn);
    const before = readFileSync(FILE(), 'utf8');
    await expect(store.change((s) => void (s.mail.schedule = schedule({ day: 40 })))).rejects.toThrow(/schedule/);
    await expect(store.change((s) => void (s.mail.recipients = ['nope']))).rejects.toThrow(/recipient/);
    expect(readFileSync(FILE(), 'utf8')).toBe(before);
    expect(store.read()).toEqual(emptyState());
  });
});
