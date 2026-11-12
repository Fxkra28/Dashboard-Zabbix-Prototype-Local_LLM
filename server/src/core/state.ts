import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_RECIPIENTS, plainAddress } from './mailConfig.js';
import { DATES, DECIMALS, FORMAT_NAMES, SEPARATORS, type Format, type ReportStyle } from './reportChoices.js';

/**
 * The portal's one small file of its own, on a folder that outlives the container (PORTAL_STATE_DIR): the saved
 * recipients, the monthly schedule and a short record of what was sent. Never a report, a figure from Zabbix or a
 * password. Without the folder the portal keeps the same in memory and says that it is not kept (ADR 0003, amended).
 */

export const MAX_SENDS_KEPT = 24;
const MAX_NOTIFY = 3;
const FILE_NAME = 'portal-state.json';

export interface Schedule {
  enabled: boolean;
  /** 1 to 28, so that every month has the day. */
  day: number;
  /** 24 hours, in the report time zone. */
  time: string;
  formats: Format[];
  style: ReportStyle;
  /** Who is told when a send fails, besides the page and the log. */
  notify: string[];
  /** Unix seconds. A slot before this is never sent, so turning the schedule on does not send a month late. */
  enabledAt: number;
  setBy: string;
  setAt: number;
}

export type Outcome = 'sending' | 'sent' | 'failed' | 'missed';

export interface SendRecord {
  month: string;
  trigger: 'schedule' | 'manual';
  /** A user name, or "schedule". */
  by: string;
  /** Unix seconds of the last change to this record. */
  at: number;
  outcome: Outcome;
  attempts: number;
  formats: Format[];
  /** How many, never who. */
  recipients: number;
  refused: number;
  bytes: number;
  reason?: string;
  /** Unix seconds before which a scheduled send is not tried again. */
  nextAt?: number;
  /** How many notices were sent for it, so a restart does not send them again. */
  noticed?: number;
  /** A try ended with no word on whether the mail server took the message (a timeout), so no notice may say that nobody has it, whatever the later tries said. */
  unsure?: true;
}

export interface PortalState {
  version: 1;
  mail: { recipients: string[]; schedule: Schedule | null; sends: SendRecord[] };
}

export const emptyState = (): PortalState => ({ version: 1, mail: { recipients: [], schedule: null, sends: [] } });

export class StateWriteError extends Error {
  constructor(readonly detail: string) {
    super('The portal could not save this. Check that its data folder can be written.');
    this.name = 'StateWriteError';
  }
}

export interface StateStore {
  /** Whether what is kept survives a restart. */
  readonly durable: boolean;
  /** True from a save that did not go through until one that does: the folder stopped taking writes after the portal started. */
  failing(): boolean;
  /** A copy: changing it changes nothing kept. */
  read(): PortalState;
  /** Applies `edit` to a copy, checks the result, saves it, then makes it the state. One at a time, in the order asked. */
  change(edit: (draft: PortalState) => void): Promise<void>;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const OUTCOMES: readonly string[] = ['sending', 'sent', 'failed', 'missed'];
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const moment = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function formatsOf(v: unknown): Format[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.some((f) => !(FORMAT_NAMES as readonly unknown[]).includes(f))) return null;
  return FORMAT_NAMES.filter((f) => v.includes(f));
}

function styleOf(v: unknown): ReportStyle | null {
  if (!isObject(v)) return null;
  const { decimal, date, separator } = v;
  if (!(DECIMALS as readonly unknown[]).includes(decimal) || !(DATES as readonly unknown[]).includes(date) || !(SEPARATORS as readonly unknown[]).includes(separator)) return null;
  return { decimal, date, separator } as ReportStyle;
}

function addressesOf(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max || v.some((a) => !plainAddress(a))) return null;
  return v as string[];
}

function scheduleOf(v: unknown): Schedule | null {
  if (!isObject(v)) return null;
  const formats = formatsOf(v.formats);
  const style = styleOf(v.style);
  const notify = addressesOf(v.notify, MAX_NOTIFY);
  if (typeof v.enabled !== 'boolean' || !whole(v.day, 1, 28) || typeof v.time !== 'string' || !TIME.test(v.time)) return null;
  if (!formats || !style || !notify || !moment(v.enabledAt) || !moment(v.setAt) || typeof v.setBy !== 'string' || v.setBy.length > 64) return null;
  return { enabled: v.enabled, day: v.day, time: v.time, formats, style, notify: [...notify], enabledAt: v.enabledAt, setBy: v.setBy, setAt: v.setAt };
}

function sendOf(v: unknown): SendRecord | null {
  if (!isObject(v)) return null;
  const formats = formatsOf(v.formats);
  if (typeof v.month !== 'string' || !MONTH.test(v.month) || (v.trigger !== 'schedule' && v.trigger !== 'manual')) return null;
  if (typeof v.by !== 'string' || v.by === '' || v.by.length > 64 || !moment(v.at) || typeof v.outcome !== 'string' || !OUTCOMES.includes(v.outcome)) return null;
  if (!whole(v.attempts, 0, 999) || !formats || !whole(v.recipients, 0, 1000) || !whole(v.refused, 0, 1000) || !whole(v.bytes, 0, 2 ** 31)) return null;
  if (v.reason !== undefined && (typeof v.reason !== 'string' || v.reason.length > 40)) return null;
  if (v.nextAt !== undefined && !moment(v.nextAt)) return null;
  if (v.noticed !== undefined && !whole(v.noticed, 0, 9)) return null;
  if (v.unsure !== undefined && v.unsure !== true) return null;
  const record: SendRecord = { month: v.month, trigger: v.trigger, by: v.by, at: v.at, outcome: v.outcome as Outcome, attempts: v.attempts, formats, recipients: v.recipients, refused: v.refused, bytes: v.bytes };
  if (v.reason !== undefined) record.reason = v.reason as string;
  if (v.nextAt !== undefined) record.nextAt = v.nextAt as number;
  if (v.noticed !== undefined) record.noticed = v.noticed as number;
  if (v.unsure === true) record.unsure = true;
  return record;
}

/**
 * The state `raw` describes, repaired, with a line for each thing that had to go. Nothing here throws. `usable` is false for
 * something that is not this version's state at all, which is put aside and not repaired.
 */
export function readState(raw: unknown): { state: PortalState; repairs: string[]; usable: boolean } {
  const state = emptyState();
  const repairs: string[] = [];
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.mail)) {
    return { state, repairs: ['The state is not in a form this version reads.'], usable: false };
  }
  const mail = raw.mail;

  if (Array.isArray(mail.recipients)) {
    const seen = new Set<string>();
    for (const a of mail.recipients) {
      if (!plainAddress(a)) repairs.push('State: dropped a recipient that is not a plain address.');
      else if (!seen.has(a.toLowerCase())) {
        seen.add(a.toLowerCase());
        state.mail.recipients.push(a);
      }
    }
    if (state.mail.recipients.length > MAX_RECIPIENTS) {
      repairs.push(`State: cut the recipients to ${MAX_RECIPIENTS}.`);
      state.mail.recipients.length = MAX_RECIPIENTS;
    }
  } else if (mail.recipients !== undefined) {
    repairs.push('State: the recipients were not a list and were dropped.');
  }

  if (mail.schedule !== null && mail.schedule !== undefined) {
    const schedule = scheduleOf(mail.schedule);
    if (schedule) state.mail.schedule = schedule;
    else repairs.push('State: the schedule was not whole and was dropped.');
  }

  if (Array.isArray(mail.sends)) {
    for (const item of mail.sends) {
      const record = sendOf(item);
      if (record) state.mail.sends.push(record);
      else repairs.push('State: dropped a record of a send that was not whole.');
    }
    state.mail.sends = trimSends(state.mail.sends);
  } else if (mail.sends !== undefined) {
    repairs.push('State: the records of sends were not a list and were dropped.');
  }
  return { state, repairs, usable: true };
}

/** Over the limit, the oldest manual send goes first: the schedule's own records are what the planner reads to know a month went. */
function trimSends(sends: SendRecord[]): SendRecord[] {
  const kept = [...sends];
  while (kept.length > MAX_SENDS_KEPT) {
    const manual = kept.findIndex((r) => r.trigger === 'manual');
    kept.splice(manual >= 0 ? manual : 0, 1);
  }
  return kept;
}

async function writeAtomic(dir: string, state: PortalState): Promise<void> {
  const file = join(dir, FILE_NAME);
  const tmp = `${file}.tmp`;
  try {
    const handle = await open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

const copy = (state: PortalState): PortalState => structuredClone(state);

function memoryStore(initial: PortalState): StateStore {
  return keep(initial, false, async () => undefined);
}

/** A state kept in memory alone: what the portal runs on with no data folder, and what the tests start from. */
export const memoryState = (): StateStore => memoryStore(emptyState());

function keep(initial: PortalState, durable: boolean, persist: (next: PortalState) => Promise<void>): StateStore {
  let current = initial;
  let queue: Promise<unknown> = Promise.resolve();
  let failing = false;
  return {
    durable,
    failing: () => failing,
    read: () => copy(current),
    change(edit) {
      const run = async () => {
        const draft = copy(current);
        edit(draft);
        const { state, repairs } = readState(JSON.parse(JSON.stringify(draft)));
        if (repairs.length) throw new Error(`The state would be left unusable: ${repairs.join(' ')}`);
        try {
          await persist(state);
        } catch (err) {
          if (durable) failing = true;
          throw new StateWriteError(String((err as NodeJS.ErrnoException | undefined)?.code ?? err));
        }
        failing = false;
        current = state;
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

/**
 * Opens the state in `dir`, or in memory when `dir` is empty or cannot be written. Never throws: a portal that cannot keep
 * its recipients still serves monitoring data. A file it cannot read is put aside, not deleted, and the portal starts empty.
 */
export async function openState(dir: string, warn: (message: string) => void): Promise<StateStore> {
  if (dir === '') return memoryStore(emptyState());
  const file = join(dir, FILE_NAME);
  let reading = false;
  try {
    await mkdir(dir, { recursive: true });
    let text: string | null = null;
    reading = true;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    reading = false;

    let state = emptyState();
    let rewrite = text === null;
    if (text !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const read = readState(parsed);
      state = read.state;
      if (!read.usable) {
        await rename(file, `${file}.broken-${Date.now()}`);
        warn(`The portal's state file could not be read and was put aside as ${FILE_NAME}.broken-<time>. It starts empty.`);
        rewrite = true;
      } else if (read.repairs.length) {
        for (const line of new Set(read.repairs)) warn(line);
        rewrite = true;
      }
    }
    if (rewrite) await writeAtomic(dir, state);
    return keep(state, true, (next) => writeAtomic(dir, next));
  } catch {
    warn(
      (reading
        ? 'The portal cannot read its state file in its data folder (PORTAL_STATE_DIR), for example because the file belongs to another user.'
        : 'The portal cannot write to its data folder (PORTAL_STATE_DIR).') + ' The saved recipients and the schedule will not be kept across a restart.',
    );
    return memoryStore(emptyState());
  }
}
