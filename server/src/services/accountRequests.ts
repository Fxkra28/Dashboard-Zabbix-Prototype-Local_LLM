import { randomBytes } from 'node:crypto';
import { normalizeIP } from '@fastify/rate-limit';
import { config } from '../core/config.js';
import { MODULES, moduleRole, type ModuleId } from '../security/modules.js';
import { UserError, viewOf, type NewUser, type UserView } from '../security/accounts.js';
import { noRequests, openRequests, REQUEST_LIFE_SECONDS, REQUEST_NAME_MAX, REQUEST_PAGES_MAX, REQUEST_REASON_MAX, cleanText, type AccountRequest, type RequestStore } from '../security/requestStore.js';
import { userDirectory } from './userDirectory.js';

/**
 * Requests for an account (FR-62). A person who cannot sign in leaves a name, the pages they want and a reason; an administrator approves it, which creates the account with a temporary password
 * as the Users page always did, or refuses it. The one public route that writes to disk, so every limit is here: off unless the setting is on and the portal has a data folder, a cap on how many
 * are waiting, a limit for each address in a day, a request that is a copy of one waiting is dropped, and one nobody answered in thirty days expires.
 */

let current: RequestStore = noRequests();

/** Opens the file of requests. Never throws: with no data folder, or one that cannot be used, requests are off. */
export async function initRequests(warn: (message: string) => void): Promise<RequestStore> {
  if (!config.auth.accountRequests.enabled) return (current = noRequests());
  if (config.stateDir === '') {
    warn('ACCOUNT_REQUESTS is on but the portal has no data folder (PORTAL_STATE_DIR) to keep requests in, so requests for an account are off.');
    return (current = noRequests());
  }
  current = await openRequests(config.stateDir, warn);
  return current;
}

/** For the tests: put a store of their own in place. */
export function useRequestStore(store: RequestStore | null): void {
  current = store ?? noRequests();
}

/** Whether the form is offered and the endpoint answers: the setting, sign-in, and somewhere to keep the requests and to make the account. */
export const requestsOn = (): boolean => config.auth.enabled && config.auth.accountRequests.enabled && current.editable && userDirectory().store.editable;

/** The pages a person may ask for: those a guest can have, which is not the Users page or the scorecard. */
export const askablePages = (): { id: ModuleId; label: string }[] => MODULES.filter((m) => moduleRole(m.id) === 'guest').map((m) => ({ id: m.id, label: m.label }));

export interface RequestView {
  id: string;
  name: string;
  pages: ModuleId[];
  reason: string;
  created: number;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const live = (r: AccountRequest, now = nowSeconds()) => now - r.created < REQUEST_LIFE_SECONDS;

/** What the sign-in page asks before it offers the form. */
export function requestInfo(): { enabled: boolean; pages?: { id: ModuleId; label: string }[]; nameMax?: number; reasonMax?: number } {
  if (!requestsOn()) return { enabled: false };
  return { enabled: true, pages: askablePages(), nameMax: REQUEST_NAME_MAX, reasonMax: REQUEST_REASON_MAX };
}

// Requests per address in the last day, in memory: a restart forgets them, and the cap on what is waiting still holds.
const DAY = 86_400;
const ADDRESS_KEYS = 10_000;
const byAddress = new Map<string, number[]>();

/** Counts a request of `address` against its day, or says how long until it may ask again. */
function takeAddress(address: string, now: number): number | null {
  const recent = (byAddress.get(address) ?? []).filter((t) => now - t < DAY);
  if (recent.length >= config.auth.accountRequests.perAddressPerDay) {
    byAddress.set(address, recent);
    return Math.max(1, DAY - (now - recent[0]));
  }
  recent.push(now);
  byAddress.delete(address);
  byAddress.set(address, recent);
  if (byAddress.size > ADDRESS_KEYS) byAddress.delete(byAddress.keys().next().value as string);
  return null;
}

/** For the tests. */
export const forgetAddresses = (): void => byAddress.clear();

export class RequestRefused extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 429 | 503,
    readonly error: 'bad_request' | 'not_found' | 'rate_limited' | 'requests_full',
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'RequestRefused';
  }
}

export type Received = 'kept' | 'ignored';

/**
 * A request from a person who is not signed in. The answer is the same whether it was kept or was a copy of one waiting, so that the form says nothing about who is already known.
 * Whatever is wrong with what was typed is said in words.
 */
export async function receiveRequest(input: { name: string; pages: string[]; reason: string }, address: string): Promise<Received> {
  if (!requestsOn()) throw new RequestRefused('Requests for an account are not accepted on this portal.', 404, 'not_found');
  const name = cleanText(input.name, REQUEST_NAME_MAX);
  if (name.length < 2) throw new RequestRefused('Enter your name.', 400, 'bad_request');
  const asked = askablePages().map((p) => p.id);
  const pages = [...new Set(input.pages)];
  if (pages.length === 0) throw new RequestRefused('Choose at least one page.', 400, 'bad_request');
  if (pages.length > REQUEST_PAGES_MAX || pages.some((p) => !asked.includes(p as ModuleId))) throw new RequestRefused('Choose the pages from the list.', 400, 'bad_request');
  const reason = cleanText(input.reason, REQUEST_REASON_MAX, true);
  if (reason.length < 3) throw new RequestRefused('Say what you need the account for.', 400, 'bad_request');

  const now = nowSeconds();
  // A /64 is one person's, as the sign-in limits take it (security/auth.ts): a script on one network has as many addresses as it likes.
  const wait = takeAddress(normalizeIP(address), now);
  if (wait !== null) throw new RequestRefused('This address has left as many requests as it may for one day. Ask an administrator, or try again tomorrow.', 429, 'rate_limited', wait);

  let kept: Received = 'kept';
  await current.change((draft) => {
    // What nobody answered in thirty days goes first, so an old list does not fill the cap.
    for (let i = draft.length - 1; i >= 0; i--) if (!live(draft[i], now)) draft.splice(i, 1);
    // The cap is asked first: with the list full, a name that is waiting and one that is not get the same answer, so the form says nothing about who is waiting.
    if (draft.length >= config.auth.accountRequests.maxPending) throw new RequestRefused('The list of requests is full. Ask an administrator to clear it.', 503, 'requests_full');
    if (draft.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      kept = 'ignored';
      return;
    }
    draft.push({ id: randomBytes(12).toString('base64url'), name, pages: pages as ModuleId[], reason, created: now });
  });
  return kept;
}

/** The requests waiting, the oldest first. */
export function listRequests(): { enabled: boolean; max: number; requests: RequestView[] } {
  const now = nowSeconds();
  const requests = current.list().filter((r) => live(r, now)).sort((a, b) => a.created - b.created);
  return { enabled: requestsOn(), max: config.auth.accountRequests.maxPending, requests };
}

const notFound = () => new UserError('There is no such request: it may have been answered by another administrator.', 404, 'not_found');

/**
 * Makes the account the administrator typed, with the pages and the password they chose, and takes the request off the list. The request is taken first, in one step of the store, so that
 * of two administrators who answer it at once only one gets it. A refusal to make the account puts it back, so that it can be tried again.
 */
export async function approveRequest(id: string, user: NewUser, actor: string): Promise<UserView> {
  const claimed = await claim(id);
  try {
    return viewOf(await userDirectory().create(user, actor));
  } catch (err) {
    await current.change((draft) => void (draft.some((r) => r.id === claimed.id) || draft.push(claimed))).catch(() => undefined);
    throw err;
  }
}

/** Takes the request off the list. Returns its name, for the log. */
export async function refuseRequest(id: string): Promise<string> {
  return (await claim(id)).name;
}

/** Takes the request off the list in one step of the store and returns it; a request that is not there, or was taken a moment ago, is not found. */
async function claim(id: string): Promise<AccountRequest> {
  let taken: AccountRequest | undefined;
  await current.change((draft) => {
    const at = draft.findIndex((r) => r.id === id);
    if (at < 0) throw notFound();
    taken = draft.splice(at, 1)[0];
  });
  return taken!;
}
