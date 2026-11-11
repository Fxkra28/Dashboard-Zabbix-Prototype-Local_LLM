import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { Writable } from 'node:stream';
import { constants as zlibConstants, createGzip, type Gzip } from 'node:zlib';
import { cachedProblems, PROBLEMS_TTL_MS, type ZbxProblem } from '../domain/queries.js';
import { config } from '../core/config.js';
import { ZabbixApiError, ZabbixAuthError, ZabbixTimeoutError } from '../clients/zabbix.js';
import { SOURCE_DOWN } from '../http/errors.js';

/**
 * Live problems via SSE (setup.md §7).
 *
 * One ticker serves every connected screen. Every TICK_MS it reads the list through the same cache as GET
 * /api/problems, never taking a copy from an earlier tick, and sends a frame only when something a screen
 * shows has changed: a problem opened, resolved, acknowledged, suppressed or re-graded. A change in only
 * a name or host goes out at most every 30 s. A list that is identical to the last one sent is never sent again: the keep-alive
 * says the line and the data are still current. A frame carries only the fields the Dashboard reads
 * (frameJson), so no tags and no `opdata`. A screen that accepts gzip gets the frames compressed (about a tenth of the bytes),
 * flushed after every frame so that none waits in a buffer: a keep-alive stuck behind one would trip the page's 45 s watchdog.
 *
 * A timer per connection would serialise and send the whole list every tick whether or not anything
 * had changed: ~450 KB per screen per tick against HCML's Zabbix.
 *
 * Screens are counted: STREAM_MAX_CLIENTS in all and STREAM_MAX_PER_USER for one signed-in user
 * (one client address with auth off). A screen over either limit gets a 429, and a signed-in screen
 * is ended when its token expires, so the browser reconnects with the renewed cookie.
 */

/** One read of the problem list per tick, the pace its cache keeps. */
export const TICK_MS = PROBLEMS_TTL_MS;
/**
 * A tick always reads. The cache dates a list from the end of its read, so a list read for a second is 14 s old at the
 * next tick, and any age limit above 0 would skip that tick, and every other one after a read slower than the limit.
 */
const EVERY_TICK = { maxAgeMs: 0 } as const;
/** A name-only change waits until the sent list is this old. */
export const MAX_QUIET_MS = 30_000;
/** No screen waits longer than this for a frame; the page counts three missed as a dead line (web useSSE). */
const KEEPALIVE_MS = 15_000;
/** Data is required: an event with none is never delivered. */
export function pingFrame(ageMs?: number): string {
  return `event: ping\ndata: ${ageMs === undefined ? '{}' : JSON.stringify({ ageMs })}\n\n`;
}
/** setTimeout's longest delay; a token lasts 12 h, far less. */
const MAX_TIMER_MS = 2 ** 31 - 1;

// Pure parts (unit-tested)

/**
 * What a screen shows of the list, as one comparable string. Problem and host
 * names are left out on purpose: the slower update covers them. Sorted, so the
 * same problems returned in another order are not a change.
 */
export function fingerprint(problems: readonly ZbxProblem[]): string {
  return problems
    .map((p) => `${p.eventid}:${p.severity}:${p.acknowledged}:${p.suppressed ?? ''}:${p.r_eventid ?? ''}`)
    .sort()
    .join('|');
}

/**
 * What the Dashboard reads of a problem, and nothing else. `problem.get` with `output: 'extend'`
 * also returns fields no screen shows (`ns`, `correlationid`, `userid`, `urls`, `r_clock`, ...),
 * and the tags: an allowlist keeps a field Zabbix adds later out of every frame. `objectid` and
 * `object` stay because the page's `Problem` type requires them.
 */
function liveProblem(p: ZbxProblem) {
  return {
    eventid: p.eventid,
    objectid: p.objectid,
    object: p.object,
    name: p.name,
    severity: p.severity,
    clock: p.clock,
    r_eventid: p.r_eventid,
    acknowledged: p.acknowledged,
    suppressed: p.suppressed,
    host: p.host,
    hostid: p.hostid,
  };
}

/** The list as the screens get it: the fields above. A change in tags or `opdata` alone is not a change. */
export function frameJson(problems: readonly ZbxProblem[]): string {
  return JSON.stringify(problems.map(liveProblem));
}

/** The last list sent to the screens: its fingerprint, its JSON, and when. */
export interface Sent {
  fingerprint: string;
  json: string;
  at: number;
}

/**
 * Whether a fresh read is worth a frame. A change a screen shows goes at once.
 * A list identical to the last one sent never goes again. One where only a
 * name or tag moved goes once the next tick would be past MAX_QUIET_MS,
 * checked only every TICK_MS: a plain `>= MAX_QUIET_MS` let it wait up to 35 s.
 */
export function shouldSend(last: Sent | null, next: { fingerprint: string; json: string }, now: number): boolean {
  if (last === null || last.fingerprint !== next.fingerprint) return true;
  if (last.json === next.json) return false;
  return now + TICK_MS - last.at > MAX_QUIET_MS;
}

// The shared ticker

interface Frame {
  id: number;
  text: string;
}

interface Client {
  res: ServerResponse;
  /** Where frames are written: the response itself, or the gzip stream that feeds it. */
  out: Writable;
  gzip: Gzip | null;
  /** Who it counts against: the signed-in user, or the client address with auth off. */
  owner: string;
  /** `write()` returned false: data frames are skipped until 'drain'. */
  blocked: boolean;
  /** The frame this client last had written to it. */
  frameId: number;
  lastWrite: number;
}

const clients = new Set<Client>();
/** The latest frame: what a new connection gets first, and what a drained one catches up to. */
let latest: Frame | null = null;
let lastSent: Sent | null = null;
/** When a tick last got the list without a failure: what a keep-alive tells the page about its age. */
let lastReadAt: number | null = null;
let frameIds = 0;
let ticker: NodeJS.Timeout | null = null;
let ticking = false;
/** Reads are numbered so a slow one that lands late cannot replace a newer frame. */
let readsStarted = 0;
let readsApplied = 0;
/** The failure last reported, so a Zabbix outage is logged once rather than every tick. */
let lastError: string | null = null;
let log: FastifyBaseLogger | undefined;

/** The route module hands the app's logger over once, when it registers. */
export function useLogger(logger: FastifyBaseLogger): void {
  log = logger;
}

function write(client: Client, text: string, now: number): void {
  const { out } = client;
  if (out.destroyed || out.writableEnded) return;
  client.lastWrite = now;
  const room = out.write(text);
  // A sync flush: the frame leaves now, and the next one still compresses against it.
  client.gzip?.flush(zlibConstants.Z_SYNC_FLUSH);
  if (room) return;
  // The socket's buffer is full: a slow link, or a tab the browser throttles.
  // Stacking 450 KB frames behind it would only grow the BFF's memory.
  client.blocked = true;
  out.once('drain', () => {
    client.blocked = false;
    if (latest && client.frameId !== latest.id && clients.has(client)) deliver(client, latest, Date.now());
  });
}

function deliver(client: Client, frame: Frame, now: number): void {
  if (client.blocked) return;
  client.frameId = frame.id;
  write(client, frame.text, now);
}

function broadcast(text: string, now: number): void {
  latest = { id: ++frameIds, text };
  for (const client of clients) deliver(client, latest, now);
}

/**
 * What a screen may be told about a failed read: a Zabbix failure is errors.ts's one sentence with the method and setting in the log only;
 * anything else is a bug, whose wording stays in the log too.
 */
function publicMessage(err: unknown): string {
  const known = err instanceof ZabbixApiError || err instanceof ZabbixTimeoutError || err instanceof ZabbixAuthError;
  const message = known ? SOURCE_DOWN : 'The live stream hit an unexpected error. Tell an administrator.';
  // Logged when the failure changes, not when only the wording of the screen stays the same.
  const logged = known ? err.message : message;
  if (logged !== lastError) {
    if (err instanceof ZabbixApiError || err instanceof ZabbixTimeoutError) {
      log?.error({ detail: err.detail }, err.message);
    } else {
      log?.error(err);
    }
  }
  lastError = logged;
  return message;
}

async function refresh(force: boolean): Promise<void> {
  const read = ++readsStarted;
  try {
    let problems: ZbxProblem[] | null = null;
    let failure: unknown;
    try {
      problems = await cachedProblems(EVERY_TICK);
    } catch (err) {
      failure = err;
    }
    if (read < readsApplied || !clients.size) return;
    readsApplied = read;
    const now = Date.now();

    if (!problems) {
      // Sent every tick, as before, and the next good read goes out whatever
      // its fingerprint, so screens drop the error as soon as Zabbix is back.
      lastSent = null;
      lastReadAt = null;
      broadcast(`event: error\ndata: ${JSON.stringify({ message: publicMessage(failure) })}\n\n`, now);
      return;
    }
    lastError = null;
    lastReadAt = now;
    const next = { fingerprint: fingerprint(problems), json: frameJson(problems) };
    if (!force && !shouldSend(lastSent, next, now)) return;
    lastSent = { ...next, at: now };
    broadcast(`event: problems\ndata: ${next.json}\n\n`, now);
  } catch (err) {
    log?.error(err);
  }
}

function tick(): void {
  const now = Date.now();
  // Carries the list's age, since an unchanged list is not resent: the page
  // keeps its "data as of" moving from this (useSSE).
  const ping = pingFrame(lastReadAt === null ? undefined : Math.max(0, now - lastReadAt));
  for (const client of clients) {
    // A named event, not an SSE comment: the browser never reports comments, so
    // the page could not tell a quiet line from a dead one (useSSE's watchdog).
    // Judged one tick ahead, as shouldSend is: a timer that fires a millisecond early must not skip a ping and leave 30 s of silence.
    if (!client.blocked && now + TICK_MS - client.lastWrite > KEEPALIVE_MS) write(client, ping, now);
  }
  // Zabbix slower than the tick: let the read in flight finish rather than queue more.
  if (ticking) return;
  ticking = true;
  void refresh(false).then(() => {
    ticking = false;
  });
}

/** The most screens one connection may add, overall and for one owner. */
export interface StreamLimits {
  maxClients: number;
  maxPerUser: number;
}

/**
 * Why a new screen from `owner` is refused, or null when it may join. The text
 * goes in the 429 body: the browser's EventSource cannot read it, but curl and
 * the BFF log can.
 */
export function refusalFor(owner: string, limits: StreamLimits = config.stream): string | null {
  if (clients.size >= limits.maxClients) {
    return `The portal is already streaming to ${limits.maxClients} screens. Close one, or ask an admin to raise STREAM_MAX_CLIENTS.`;
  }
  let mine = 0;
  for (const c of clients) if (c.owner === owner) mine++;
  if (mine >= limits.maxPerUser) {
    return `This account already has ${limits.maxPerUser} live screens open. Close one and try again.`;
  }
  return null;
}

function remove(client: Client): void {
  if (!clients.delete(client) || clients.size || !ticker) return;
  clearInterval(ticker);
  ticker = null;
  latest = null;
  lastSent = null;
  lastReadAt = null;
}

/**
 * Add one screen. It gets the latest frame at once, or, for the first screen,
 * as soon as the first read lands, and the ticker runs while anyone listens.
 * Returns the function that removes it again.
 */
export function subscribe(res: ServerResponse, owner = '', options: { gzip?: boolean } = {}): () => void {
  const gzip = options.gzip ? createGzip({ level: 4 }) : null;
  const client: Client = { res, out: gzip ?? res, gzip, owner, blocked: false, frameId: 0, lastWrite: Date.now() };
  if (gzip) {
    gzip.pipe(res);
    // A compressor that fails ends only its own screen, which reconnects.
    gzip.on('error', (err) => {
      log?.error(err, 'live stream compression failed');
      remove(client);
      res.destroy();
    });
  }
  clients.add(client);
  if (!ticker) {
    ticker = setInterval(tick, TICK_MS);
    ticker.unref?.();
  }
  if (latest) deliver(client, latest, Date.now());
  else if (!ticking) {
    ticking = true;
    void refresh(false).then(() => {
      ticking = false;
    });
  }

  return () => {
    remove(client);
    // Nothing more goes to a screen that has left, and the compressor's memory goes with it.
    gzip?.destroy();
  };
}

/** Screens connected right now. */
export function connectedClients(): number {
  return clients.size;
}

/** End every live stream: close() would wait on an open one until Docker's kill. Browsers reconnect by themselves. */
export function endStreams(): number {
  const ended = [...clients];
  for (const client of ended) {
    remove(client);
    endClient(client);
  }
  return ended.length;
}

/** End one screen. A gzip one ends its compressor first, which writes the trailer and then ends the response. */
function endClient(client: Client): void {
  if (client.gzip) client.gzip.end();
  else if (!client.res.writableEnded) client.res.end();
}

/** End the screen that was given `res`: the route does this when the token behind it expires. */
export function endStreamOf(res: ServerResponse): void {
  const client = [...clients].find((c) => c.res === res);
  if (client) endClient(client);
  else if (!res.writableEnded) res.end();
}

/**
 * Send the list to every screen now. Called after an acknowledge or close,
 * once actions.ts has invalidated the cache: this only reads and pushes, so
 * the change shows without waiting for the next tick. Never rejects.
 */
export async function notifyProblemsChanged(): Promise<void> {
  if (clients.size) await refresh(true);
}

/** The signed-in user, or with auth off the client address. */
export function ownerOf(req: FastifyRequest): string {
  const sub = (req.user as { sub?: unknown } | undefined)?.sub;
  return typeof sub === 'string' && sub ? `user:${sub}` : `ip:${req.ip}`;
}

/** Milliseconds until the token this request came in with expires, or null with auth off. */
export function msUntilExpiry(req: FastifyRequest): number | null {
  const exp = (req.user as { exp?: unknown } | undefined)?.exp;
  return typeof exp === 'number' ? Math.min(Math.max(exp * 1000 - Date.now(), 0), MAX_TIMER_MS) : null;
}
