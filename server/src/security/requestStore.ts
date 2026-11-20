import { mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../core/state.js';
import { isModuleId, type ModuleId } from './modules.js';

/**
 * The requests for an account (FR-62), in `requests.json` on the state volume, mode 0600, written whole and safely. A request is a name, the pages asked for and a reason, left by a
 * person who is not signed in: the one thing a stranger can write to the disk of this portal, so it holds little, is capped, and expires. Without a data folder nothing is kept
 * and requests are off. A file that cannot be read is put aside and the list starts empty: a request is cheap to make again, unlike a user.
 */

export interface AccountRequest {
  /** What the administrator's buttons name. */
  id: string;
  /** The name the person goes by, as they typed it. */
  name: string;
  pages: ModuleId[];
  reason: string;
  /** Unix seconds. */
  created: number;
}

export const REQUEST_NAME_MAX = 80;
export const REQUEST_REASON_MAX = 500;
export const REQUEST_PAGES_MAX = 20;
/** A request nobody has answered in this long is dropped. */
export const REQUEST_LIFE_SECONDS = 30 * 86_400;
const FILE_NAME = 'requests.json';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Text from a person who is not signed in, made safe to keep and to show: control characters and the marks that reorder text are dropped, runs of blanks become one. */
export function cleanText(raw: string, max: number, keepLines = false): string {
  const stripped = raw.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (keepLines && (c === '\n' || c === '\r') ? '\n' : ' '));
  const squeezed = keepLines ? stripped.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n') : stripped.replace(/\s+/g, ' ');
  return squeezed.trim().slice(0, max);
}

/** The requests a file holds that read well, and whether it is of a kind this build reads at all. */
export function readRequests(raw: unknown): { requests: AccountRequest[]; dropped: number; usable: boolean } {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.requests)) return { requests: [], dropped: 0, usable: false };
  const requests: AccountRequest[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const item of raw.requests) {
    const ok =
      isObject(item) &&
      typeof item.id === 'string' &&
      /^[A-Za-z0-9_-]{8,64}$/.test(item.id) &&
      !ids.has(item.id) &&
      typeof item.name === 'string' &&
      item.name !== '' &&
      item.name.length <= REQUEST_NAME_MAX &&
      Array.isArray(item.pages) &&
      item.pages.length <= REQUEST_PAGES_MAX &&
      item.pages.every(isModuleId) &&
      typeof item.reason === 'string' &&
      item.reason.length <= REQUEST_REASON_MAX &&
      typeof item.created === 'number' &&
      Number.isFinite(item.created) &&
      item.created >= 0;
    if (!ok) {
      dropped++;
      continue;
    }
    const r = item as unknown as AccountRequest;
    ids.add(r.id);
    requests.push({ id: r.id, name: r.name, pages: [...new Set(r.pages)], reason: r.reason, created: r.created });
  }
  return { requests, dropped, usable: true };
}

export class RequestsWriteError extends Error {
  constructor(readonly detail: string) {
    super('The portal could not save the requests. Check that its data folder can be written.');
    this.name = 'RequestsWriteError';
  }
}

export interface RequestStore {
  /** Whether requests can be kept: a store of a data folder, or one a test made. */
  readonly editable: boolean;
  /** Copies: changing them changes nothing kept. */
  list(): AccountRequest[];
  /** Applies `edit` to a copy of the requests, checks the result, saves it, then makes it the requests. One at a time, in the order asked. */
  change(edit: (draft: AccountRequest[]) => void): Promise<void>;
}

const copy = (requests: AccountRequest[]): AccountRequest[] => structuredClone(requests);

function keep(initial: AccountRequest[], editable: boolean, persist: (next: AccountRequest[]) => Promise<void>): RequestStore {
  let current = initial;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    editable,
    list: () => copy(current),
    change(edit) {
      const run = async () => {
        if (!editable) throw new RequestsWriteError('not editable');
        const draft = copy(current);
        edit(draft);
        const { requests, dropped } = readRequests(JSON.parse(JSON.stringify({ version: 1, requests: draft })));
        if (dropped > 0 || requests.length !== draft.length) throw new Error('The requests would be left unusable.');
        try {
          await persist(requests);
        } catch (err) {
          throw new RequestsWriteError(String((err as NodeJS.ErrnoException | undefined)?.code ?? err));
        }
        current = requests;
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

/** What the portal runs on with no data folder: nothing is kept, and requests are off. */
export const noRequests = (): RequestStore => keep([], false, async () => undefined);

/** Requests kept in memory that can be changed, for the tests. */
export const memoryRequests = (initial: AccountRequest[] = []): RequestStore => keep(copy(initial), true, async () => undefined);

/** Opens the requests in `dir`, or a store that keeps none when `dir` is empty or cannot be used. Never throws. */
export async function openRequests(dir: string, warn: (message: string) => void): Promise<RequestStore> {
  if (dir === '') return noRequests();
  const file = join(dir, FILE_NAME);
  const persist = (next: AccountRequest[]) => writeJsonAtomic(file, { version: 1, requests: next });
  try {
    await mkdir(dir, { recursive: true });
    let text: string | null = null;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    let requests: AccountRequest[] = [];
    if (text !== null) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = undefined;
      }
      const read = readRequests(raw);
      if (read.usable) {
        requests = read.requests;
        if (read.dropped > 0) warn(`${read.dropped} request${read.dropped === 1 ? '' : 's'} for an account in ${FILE_NAME} ${read.dropped === 1 ? 'was' : 'were'} not whole and ${read.dropped === 1 ? 'was' : 'were'} dropped.`);
      } else {
        await rename(file, `${file}.broken-${Date.now()}`);
        warn(`The portal's file of requests for an account (${FILE_NAME}) could not be read and was put aside as ${FILE_NAME}.broken-<time>. The list starts empty.`);
      }
    }
    return keep(requests, true, persist);
  } catch {
    warn('The portal cannot read or write its data folder (PORTAL_STATE_DIR) for the requests for an account, so they are off.');
    return noRequests();
  }
}
