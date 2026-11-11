import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import http, { type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { createGunzip } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ZbxProblem } from '../domain/queries.js';
import { invalidate } from '../core/cache.js';
import { config } from '../core/config.js';
import { ZabbixApiError } from '../clients/zabbix.js';
import { genReqId, registerRequestId } from '../http/requestId.js';
import { streamRoutes } from '../routes/stream.js';
import { MAX_QUIET_MS, TICK_MS, connectedClients, endStreamOf, endStreams, fingerprint, frameJson, notifyProblemsChanged, pingFrame, refusalFor, shouldSend, subscribe } from '../services/stream.js';

/**
 * The shared SSE ticker: one read per tick however many screens listen, a frame only when something
 * shown changed (an unchanged list is never resent), and no frames stacked behind a socket that is
 * not keeping up. And the limits on how many screens may listen, and the end of every stream on
 * shutdown.
 */
const { getProblemsMock } = vi.hoisted(() => ({ getProblemsMock: vi.fn() }));
// The real list cache over the stand-in, as queries.ts builds it.
vi.mock('../domain/queries.js', async () => {
  const { cached } = await import('../core/cache.js');
  return {
    getProblems: getProblemsMock,
    cachedProblems: (opts?: { maxAgeMs?: number }) => cached('problems', 15_000, getProblemsMock, opts),
    PROBLEMS_TTL_MS: 15_000,
  };
});

const problem = (over: Partial<ZbxProblem> = {}): ZbxProblem => ({
  eventid: '109',
  objectid: '25238',
  object: '0',
  name: 'High ICMP ping loss',
  severity: '2',
  clock: '1788838236',
  r_eventid: '0',
  acknowledged: '0',
  suppressed: '0',
  opdata: 'Loss: 20 %',
  host: '4.3.3 FPSO ARUBA 3',
  hostid: '10697',
  manualClose: false,
  ...over,
});

/** Enough of a ServerResponse to watch what the stream writes, with a buffer that can fill up. */
class FakeResponse extends EventEmitter {
  written: string[] = [];
  /** While true, write() reports a full buffer, as a slow socket does. */
  full = false;
  destroyed = false;
  writableEnded = false;
  write(text: string): boolean {
    this.written.push(text);
    return !this.full;
  }
  end(): void {
    this.writableEnded = true;
    this.emit('close');
  }
  frames(): string[] {
    // Data frames: the keep-alive is a named `ping` event too, but carries nothing.
    return this.written.filter((w) => w.startsWith('event: ') && !w.startsWith('event: ping'));
  }
  lastList(): ZbxProblem[] {
    const frame = this.frames().filter((f) => f.startsWith('event: problems')).at(-1) ?? '';
    return JSON.parse(frame.slice(frame.indexOf('data: ') + 6)) as ZbxProblem[];
  }
}

function screen(owner = ''): { res: FakeResponse; close: () => void } {
  const res = new FakeResponse();
  return { res, close: subscribe(res as unknown as ServerResponse, owner) };
}

/** Let the read the ticker started land and be broadcast. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function tick(ms = TICK_MS): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

function useClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T08:00:00Z'));
  invalidate('');
  getProblemsMock.mockReset();
}

afterEach(() => {
  vi.useRealTimers();
  expect(connectedClients()).toBe(0); // every test closes its screens, so the ticker stops
});

describe('fingerprint', () => {
  it('ignores order, opdata, names and times', () => {
    const a = problem({ eventid: '1' });
    const b = problem({ eventid: '2', severity: '4' });
    expect(fingerprint([a, b])).toBe(fingerprint([b, a]));
    expect(fingerprint([a])).toBe(fingerprint([{ ...a, opdata: 'Loss: 80 %', name: 'renamed', clock: '1' }]));
  });

  it('changes with anything a screen shows about a problem', () => {
    const base = fingerprint([problem()]);
    for (const over of [
      { acknowledged: '1' },
      { severity: '4' },
      { suppressed: '1' },
      { r_eventid: '110' },
      { eventid: '111' },
    ]) {
      expect(fingerprint([problem(over)]), JSON.stringify(over)).not.toBe(base);
    }
    expect(fingerprint([problem(), problem({ eventid: '200' })])).not.toBe(base);
    expect(fingerprint([])).not.toBe(base);
  });
});

/** A problem as `problem.get` with `output: 'extend'` and `selectTags` returns it, plus what getProblems adds. */
const zabbixRecord = (): ZbxProblem =>
  ({
    ...problem({ eventid: '1048213', objectid: '25238' }),
    source: '0',
    ns: '412003114',
    r_clock: '0',
    r_ns: '0',
    correlationid: '0',
    userid: '0',
    cause_eventid: '0',
    urls: [],
    tags: [
      { tag: 'service', value: 'network' },
      { tag: 'site', value: '4.3.3' },
      { tag: 'class', value: 'network-device' },
    ],
  }) as ZbxProblem;

describe('frameJson', () => {
  /** What the Dashboard reads of a problem (Overview, ProblemsTable, liveList, useChangeHighlight), and the two the page's type requires. */
  const SENT = ['eventid', 'objectid', 'object', 'name', 'severity', 'clock', 'r_eventid', 'acknowledged', 'suppressed', 'host', 'hostid'];

  it('sends the fields the Dashboard reads and no others, without touching the list it was given', () => {
    const list = [zabbixRecord(), problem({ eventid: '2', opdata: undefined })];
    const parsed = JSON.parse(frameJson(list)) as Record<string, unknown>[];
    expect(parsed).toHaveLength(2);
    expect(Object.keys(parsed[0]).sort()).toEqual([...SENT].sort());
    const { eventid, objectid, object, name, severity, clock, r_eventid, acknowledged, suppressed, host, hostid } = zabbixRecord();
    expect(parsed[0]).toEqual({ eventid, objectid, object, name, severity, clock, r_eventid, acknowledged, suppressed, host, hostid });
    expect(list[0].tags).toHaveLength(3);
    expect(list[1].opdata).toBeUndefined();
  });

  it('keeps out a field Zabbix adds later, which an allowlist does and "everything but opdata" did not', () => {
    const later = { ...zabbixRecord(), someNewZabbixField: 'x'.repeat(100) } as ZbxProblem;
    expect(frameJson([later])).not.toContain('someNewZabbixField');
    for (const gone of ['tags', 'r_clock', 'manualClose', 'opdata', 'correlationid', 'urls', '"ns"']) {
      expect(frameJson([zabbixRecord()]), gone).not.toContain(gone);
    }
  });

  it('is under 55 % of what the unfiltered record came to, on a typical record (IN-11)', () => {
    const unfiltered = JSON.stringify([{ ...zabbixRecord(), opdata: undefined }]).length;
    expect(frameJson([zabbixRecord()]).length / unfiltered).toBeLessThan(0.55);
  });

  it('is the same text for two lists that differ in opdata, tags or the flag for manual close only', () => {
    expect(frameJson([problem({ opdata: 'Loss: 20 %' })])).toBe(frameJson([problem({ opdata: 'Loss: 80 %' })]));
    expect(frameJson([problem({ tags: [{ tag: 'a', value: 'b' }] })])).toBe(frameJson([problem()]));
    expect(frameJson([problem({ manualClose: true })])).toBe(frameJson([problem()]));
    expect(frameJson([problem()])).not.toBe(frameJson([problem({ name: 'renamed' })]));
    expect(frameJson([problem()])).not.toBe(frameJson([problem({ host: 'renamed' })]));
  });
});

describe('shouldSend', () => {
  const now = 1_000_000;
  const list = (fingerprint: string, json = fingerprint) => ({ fingerprint, json });
  const sent = (fingerprint: string, at: number, json = fingerprint) => ({ fingerprint, json, at });

  it('sends the first list and any change a screen shows, at once', () => {
    expect(shouldSend(null, list('x'), now)).toBe(true);
    expect(shouldSend(sent('x', now - 1), list('y'), now)).toBe(true);
  });

  it('never resends a list identical to the last one sent, however old', () => {
    expect(shouldSend(sent('x', now - 5_000), list('x'), now)).toBe(false);
    expect(shouldSend(sent('x', now - MAX_QUIET_MS), list('x'), now)).toBe(false);
    expect(shouldSend(sent('x', now - 24 * 3_600_000), list('x'), now)).toBe(false);
  });

  it('holds back a change in only a name or tag until the next tick would be past 30 s', () => {
    const moved = list('x', 'x renamed');
    expect(shouldSend(sent('x', now - 5_000), moved, now)).toBe(false);
    expect(shouldSend(sent('x', now - (MAX_QUIET_MS - TICK_MS)), moved, now)).toBe(false);
    expect(shouldSend(sent('x', now - (MAX_QUIET_MS - TICK_MS) - 1), moved, now)).toBe(true);
    expect(shouldSend(sent('x', now - MAX_QUIET_MS), moved, now)).toBe(true);
  });
});

describe('pingFrame', () => {
  it('is a named event with data, and says how old the list is when it knows', () => {
    expect(pingFrame()).toBe('event: ping\ndata: {}\n\n');
    expect(pingFrame(4_200)).toBe('event: ping\ndata: {"ageMs":4200}\n\n');
  });
});

describe('shared ticker', () => {
  it('sends on connect, then only changes, keep-alives and a slow rename', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const a = screen();
    await settle();
    expect(a.res.frames()).toHaveLength(1);

    // Unchanged for two ticks: read again each time, no frame, and a keep-alive that says how old the list is.
    await tick();
    await tick();
    expect(getProblemsMock).toHaveBeenCalledTimes(3);
    expect(a.res.frames()).toHaveLength(1);
    expect(a.res.written.at(-1)).toBe(`event: ping\ndata: {"ageMs":${TICK_MS}}\n\n`);

    // A second screen gets the current list at once, without another read.
    const b = screen();
    expect(b.res.frames()).toHaveLength(1);
    expect(getProblemsMock).toHaveBeenCalledTimes(3);

    // Acknowledged: both screens get it on the next tick, from one read.
    getProblemsMock.mockResolvedValue([problem({ acknowledged: '1' })]);
    await tick();
    expect(getProblemsMock).toHaveBeenCalledTimes(4);
    expect(a.res.lastList()[0].acknowledged).toBe('1');
    expect(b.res.lastList()[0].acknowledged).toBe('1');

    // Only the name moves: held back until the list sent is 30 s old.
    getProblemsMock.mockResolvedValue([problem({ acknowledged: '1', name: 'High ICMP ping loss (renamed)' })]);
    await tick();
    expect(a.res.frames()).toHaveLength(2);
    await tick();
    expect(a.res.frames()).toHaveLength(3);
    expect(a.res.lastList()[0].name).toBe('High ICMP ping loss (renamed)');

    a.close();
    b.close();
  });

  it('pings on every tick even for a screen that joined a millisecond after the ticker, so none is silent for 30 s', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const a = screen();
    await settle();
    await tick(1);
    const b = screen(); // its last write is 1 ms after the ticker started, so at the first tick it is 14,999 ms old
    await tick(TICK_MS - 1);
    expect(b.res.written.filter((w) => w.startsWith('event: ping'))).toHaveLength(1);
    await tick();
    expect(b.res.written.filter((w) => w.startsWith('event: ping'))).toHaveLength(2);
    a.close();
    b.close();
  });

  // What a screen is given when it connects is never an old list passed off as a new one (FR-24): the page stamps the first frame
  // with its arrival time, which is right because the server only keeps a list that a read has confirmed in the last tick.
  it('gives a screen that joins during an outage the error and not the last list, and a screen that joins a quiet estate the list the last tick confirmed', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const first = screen();
    await settle();
    for (let i = 0; i < 4; i++) await tick(); // an hour could pass the same way: the list does not change and every tick reads it
    const quiet = screen();
    expect(quiet.res.written.map((w) => w.split('\n')[0])).toEqual(['event: problems']);

    getProblemsMock.mockRejectedValue(new Error('Zabbix is down'));
    await tick();
    const during = screen();
    expect(during.res.written.map((w) => w.split('\n')[0])).toEqual(['event: error']);
    first.close();
    quiet.close();
    during.close();
  });

  it('never resends an unchanged list, only keep-alives that say how old it is (IN-11)', async () => {
    useClock();
    // A fresh array each read, as Zabbix gives one: equal content, not the same object.
    getProblemsMock.mockImplementation(async () => [problem(), problem({ eventid: '110', severity: '4' })]);
    const a = screen();
    await settle();
    expect(a.res.frames()).toHaveLength(1);
    const first = a.res.frames()[0];

    // Two minutes: the old 30 s resend would have sent four more frames.
    const ticks = 120_000 / TICK_MS;
    for (let i = 0; i < ticks; i++) await tick();
    expect(getProblemsMock).toHaveBeenCalledTimes(ticks + 1); // still read every tick
    expect(a.res.frames()).toEqual([first]);

    const pings = a.res.written.filter((w) => w.startsWith('event: ping'));
    expect(pings.length).toBeGreaterThanOrEqual(ticks - 1); // one per 15 s of quiet
    for (const ping of pings) {
      const { ageMs } = JSON.parse(ping.slice(ping.indexOf('data: ') + 6)) as { ageMs: number };
      expect(ageMs).toBeLessThanOrEqual(TICK_MS);
    }

    // A screen joining now gets the list once, from the latest frame, not a fresh read.
    const b = screen();
    expect(b.res.frames()).toEqual([first]);

    a.close();
    b.close();
  });

  // The cache dates a list from the end of its read, so a read of d seconds leaves it 15 - d seconds old at the next tick.
  it.each([1_000, 8_000, 14_000])('reads the list at every tick when a read takes %i ms, not at every second one', async (readMs) => {
    useClock();
    getProblemsMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, readMs));
      return [problem()];
    });
    const a = screen();
    await tick(readMs);
    for (let i = 0; i < 8; i++) await tick();
    expect(getProblemsMock).toHaveBeenCalledTimes(9);

    // The keep-alive never claims a list older than the line has been quiet.
    const pings = a.res.written.filter((w) => w.startsWith('event: ping'));
    expect(pings.length).toBeGreaterThanOrEqual(7);
    for (const ping of pings) {
      const { ageMs } = JSON.parse(ping.slice(ping.indexOf('data: ') + 6)) as { ageMs: number };
      expect(ageMs).toBeLessThanOrEqual(TICK_MS);
    }
    a.close();
  });

  it('does not stack reads when one is slower than the tick: the next tick waits for it, then reads again', async () => {
    useClock();
    getProblemsMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      return [problem()];
    });
    const a = screen();
    await tick(20_000); // the first read lands at 20 s
    await tick(10_000); // 30 s: the tick starts the second, which runs to 50 s
    await tick(15_000); // 45 s: its tick finds that read still running
    expect(getProblemsMock).toHaveBeenCalledTimes(2);
    await tick(15_000); // 60 s: the tick after it lands starts the third
    expect(getProblemsMock).toHaveBeenCalledTimes(3);
    await tick(20_000); // let it land before the screen leaves, or the ticker stays marked as busy for the next test
    a.close();
  });

  it('sends a name-only change after 30 s, once and no more', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const a = screen();
    await settle();

    getProblemsMock.mockResolvedValue([problem({ name: 'Renamed trigger' })]);
    await tick();
    expect(a.res.frames()).toHaveLength(1); // 15 s: held back
    await tick();
    expect(a.res.frames()).toHaveLength(2); // 30 s: sent
    for (let i = 0; i < 12; i++) await tick();
    expect(a.res.frames()).toHaveLength(2); // then quiet again
    expect(a.res.lastList()[0].name).toBe('Renamed trigger');

    a.close();
  });

  it('sends no frame for opdata alone, even with one value moving on every read for an hour (IN-11)', async () => {
    useClock();
    let read = 0;
    getProblemsMock.mockImplementation(async () => {
      read++;
      const opdata = (i: number) => (i === 0 ? `Loss: ${read} %` : 'Loss: 20 %');
      return Array.from({ length: 400 }, (_, i) => problem({ eventid: String(1000 + i), opdata: opdata(i) }));
    });
    const a = screen();
    await settle();
    const hour = 3_600_000 / TICK_MS;
    for (let i = 0; i < hour; i++) await tick();
    expect(getProblemsMock).toHaveBeenCalledTimes(hour + 1); // still read every tick
    expect(a.res.frames()).toHaveLength(1); // the old 30 s resend would have made 121
    expect(a.res.frames()[0]).not.toContain('opdata');

    a.close();
  });

  it('skips frames for a screen whose socket is full, then catches it up with the latest only', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const slow = screen();
    await settle();
    const fast = screen();

    // Pushed as a write pushes them, not on a tick, whose keep-alive would be the write that fills the buffer.
    slow.res.full = true;
    getProblemsMock.mockResolvedValue([problem({ severity: '4' })]);
    invalidate('problems');
    await notifyProblemsChanged(); // written, but the buffer is now full
    getProblemsMock.mockResolvedValue([problem({ severity: '5' })]);
    invalidate('problems');
    await notifyProblemsChanged(); // skipped for the slow screen
    expect(slow.res.frames()).toHaveLength(2);
    expect(fast.res.frames()).toHaveLength(3);

    slow.res.full = false;
    slow.res.emit('drain');
    expect(slow.res.frames()).toHaveLength(3);
    expect(slow.res.lastList()[0].severity).toBe('5');

    slow.close();
    fast.close();
  });

  it('pushes a frame straight after a write, and stops reading once nobody listens', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const a = screen();
    await settle();

    invalidate('problems'); // what actions.ts does first
    getProblemsMock.mockResolvedValue([problem({ acknowledged: '1' })]);
    await notifyProblemsChanged();
    expect(a.res.frames()).toHaveLength(2);
    expect(a.res.lastList()[0].acknowledged).toBe('1');

    // Pushed even when Zabbix has not applied the change yet.
    await notifyProblemsChanged();
    expect(a.res.frames()).toHaveLength(3);

    a.close();
    const reads = getProblemsMock.mock.calls.length;
    await tick(60_000);
    await notifyProblemsChanged();
    expect(getProblemsMock).toHaveBeenCalledTimes(reads);
  });

  it('does not let a read from before the write land after the pushed list', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const a = screen();
    await settle();

    // A tick's read is still in flight when the acknowledge arrives…
    let releaseOld: (list: ZbxProblem[]) => void = () => {};
    getProblemsMock.mockImplementationOnce(() => new Promise<ZbxProblem[]>((resolve) => (releaseOld = resolve)));
    await tick();

    invalidate('problems');
    getProblemsMock.mockResolvedValue([problem({ acknowledged: '1' })]);
    await notifyProblemsChanged();
    expect(a.res.lastList()[0].acknowledged).toBe('1');

    // …and lands afterwards with the old state: dropped, not sent.
    releaseOld([problem()]);
    await settle();
    expect(a.res.frames()).toHaveLength(2);
    expect(a.res.lastList()[0].acknowledged).toBe('1');

    a.close();
  });

  it('reports a failed read without internal detail, and resends the list once Zabbix is back', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const a = screen();
    await settle();

    getProblemsMock.mockRejectedValue(
      new ZabbixApiError('problem.get: HTTP 500 Internal Server Error', 'ZBX_URL=http://zabbix.internal:8080'),
    );
    await tick();
    expect(a.res.frames()[1]).toMatch(/^event: error\n/);
    expect(a.res.frames()[1]).toContain('The data source is not answering.');
    expect(a.res.frames()[1]).not.toContain('problem.get');
    expect(a.res.frames()[1]).not.toContain('HTTP 500');
    expect(a.res.frames()[1]).not.toContain('zabbix.internal');

    getProblemsMock.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'hosts')"));
    await tick();
    expect(a.res.frames()[2]).toContain('unexpected error');
    expect(a.res.frames()[2]).not.toContain('hosts');

    // The same list as before the outage: sent anyway, which clears the error on screen.
    getProblemsMock.mockResolvedValue([problem()]);
    await tick();
    expect(a.res.frames()).toHaveLength(4);
    expect(a.res.frames()[3]).toMatch(/^event: problems\n/);

    a.close();
  });
});

describe('GET /api/stream', () => {
  it('streams over a real socket and forgets the screen when it disconnects', async () => {
    invalidate('');
    getProblemsMock.mockReset().mockResolvedValue([problem()]);
    const app = Fastify({ logger: false });
    await app.register(streamRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const first = await new Promise<{ type: string; body: string; req: http.ClientRequest }>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/stream' }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.includes('\n\n')) resolve({ type: String(res.headers['content-type']), body, req });
        });
      });
      req.on('error', reject);
    });
    expect(first.type).toBe('text/event-stream');
    expect(first.body).toMatch(/^event: problems\ndata: \[\{"eventid":"109"/);
    expect(first.body).not.toMatch(/manualClose|opdata/); // the allowlist, over the real socket
    expect(connectedClients()).toBe(1);

    first.req.destroy();
    await vi.waitFor(() => expect(connectedClients()).toBe(0));
    await app.close();
  });

  it('puts the request id in the headers it writes itself, which skip Fastify\'s reply headers (IN-09)', async () => {
    invalidate('');
    getProblemsMock.mockReset().mockResolvedValue([problem()]);
    const app = Fastify({ logger: false, genReqId });
    registerRequestId(app);
    await app.register(streamRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const ask = (headers: Record<string, string>) =>
      new Promise<{ id: string | string[] | undefined; req: http.ClientRequest }>((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/api/stream', headers }, (res) => resolve({ id: res.headers['x-request-id'], req }));
        req.on('error', reject);
      });

    const sent = await ask({ 'x-request-id': 'feedfacecafebeef0011223344556677' });
    expect(sent.id).toBe('feedfacecafebeef0011223344556677');
    const made = await ask({});
    expect(String(made.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    sent.req.destroy();
    made.req.destroy();
    await vi.waitFor(() => expect(connectedClients()).toBe(0));
    await app.close();
  });
});

describe('GET /api/stream compressed (IN-11)', () => {
  /** One screen over a real socket: the bytes off the wire, and the text they decode to (itself, when it asked for no gzip). */
  function openScreen(port: number, headers: Record<string, string> = {}) {
    const screen = { headers: {} as http.IncomingHttpHeaders, wire: 0, text: '', failure: null as Error | null, ended: false, req: undefined as unknown as http.ClientRequest };
    const answered = new Promise<void>((resolve, reject) => {
      screen.req = http.get({ host: '127.0.0.1', port, path: '/api/stream', headers }, (res) => {
        screen.headers = res.headers;
        res.on('data', (chunk: Buffer) => (screen.wire += chunk.length));
        const decoded = res.headers['content-encoding'] === 'gzip' ? res.pipe(createGunzip()) : res;
        decoded.setEncoding('utf8');
        decoded.on('data', (chunk: string) => (screen.text += chunk));
        decoded.on('error', (err: Error) => (screen.failure = err));
        decoded.on('end', () => (screen.ended = true));
        resolve();
      });
      screen.req.on('error', reject);
    });
    return { screen, answered };
  }
  const frameCount = (text: string) => text.split('event: problems').length - 1;

  async function appWith(list: ZbxProblem[]) {
    invalidate('');
    getProblemsMock.mockReset().mockResolvedValue(list);
    const app = Fastify({ logger: false });
    await app.register(streamRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    return { app, port: (app.server.address() as AddressInfo).port };
  }
  const many = (n: number, name = 'High ICMP ping loss') =>
    Array.from({ length: n }, (_, i) => problem({ eventid: String(1000 + i), name: `${name} on host ${i}`, host: `site-${i % 30}-core-${i}`, hostid: String(20000 + i) }));

  it('sends frames compressed to a screen that accepts gzip, each one readable as soon as it is written', async () => {
    const { app, port } = await appWith(many(400));
    const { screen, answered } = openScreen(port, { 'accept-encoding': 'gzip, deflate' });
    await answered;
    expect(screen.headers['content-encoding']).toBe('gzip');
    expect(screen.headers['content-type']).toBe('text/event-stream');
    expect(String(screen.headers.vary)).toMatch(/accept-encoding/i);

    // The first frame decodes while the stream is still open: it was flushed, not held for more.
    await vi.waitFor(() => expect(frameCount(screen.text)).toBe(1));
    expect(screen.ended).toBe(false);

    // And so does a later one, pushed after a write.
    getProblemsMock.mockResolvedValue(many(401));
    invalidate('');
    await notifyProblemsChanged();
    await vi.waitFor(() => expect(frameCount(screen.text)).toBe(2));
    expect(screen.ended).toBe(false);
    expect(screen.failure).toBeNull();

    // The bytes that crossed are a fraction of the text they carry.
    expect(screen.wire).toBeLessThan(screen.text.length * 0.25);

    screen.req.destroy();
    await vi.waitFor(() => expect(connectedClients()).toBe(0));
    await app.close();
  });

  it('decodes to exactly the text a screen with no gzip is sent', async () => {
    const { app, port } = await appWith(many(60));
    const packed = openScreen(port, { 'accept-encoding': 'gzip' });
    const plain = openScreen(port);
    await Promise.all([packed.answered, plain.answered]);
    await vi.waitFor(() => expect(frameCount(packed.screen.text)).toBe(1));
    await vi.waitFor(() => expect(frameCount(plain.screen.text)).toBe(1));
    expect(plain.screen.headers['content-encoding']).toBeUndefined();
    expect(String(plain.screen.headers.vary)).toMatch(/accept-encoding/i);
    expect(packed.screen.text).toBe(plain.screen.text);

    packed.screen.req.destroy();
    plain.screen.req.destroy();
    await vi.waitFor(() => expect(connectedClients()).toBe(0));
    await app.close();
  });

  it('sends plain text to a screen that refuses gzip, or asks only for another coding', async () => {
    const { app, port } = await appWith(many(5));
    const refused = openScreen(port, { 'accept-encoding': 'gzip;q=0, identity' });
    const brotli = openScreen(port, { 'accept-encoding': 'br' });
    await Promise.all([refused.answered, brotli.answered]);
    expect(refused.screen.headers['content-encoding']).toBeUndefined();
    expect(brotli.screen.headers['content-encoding']).toBeUndefined();
    await vi.waitFor(() => expect(frameCount(refused.screen.text)).toBe(1));

    refused.screen.req.destroy();
    brotli.screen.req.destroy();
    await vi.waitFor(() => expect(connectedClients()).toBe(0));
    await app.close();
  });

  it('ends a compressed stream with its trailer when the server shuts it, so the screen sees a clean end', async () => {
    const { app, port } = await appWith(many(20));
    const { screen, answered } = openScreen(port, { 'accept-encoding': 'gzip' });
    await answered;
    await vi.waitFor(() => expect(frameCount(screen.text)).toBe(1));

    expect(endStreams()).toBe(1);
    await vi.waitFor(() => expect(screen.ended).toBe(true));
    expect(screen.failure).toBeNull();
    expect(connectedClients()).toBe(0);
    await app.close();
  });

  it('endStreamOf() ends a compressed screen cleanly, and a plain response that was never subscribed', async () => {
    const dest = new PassThrough();
    const chunks: Buffer[] = [];
    dest.on('data', (c: Buffer) => chunks.push(c));
    const gone = subscribe(dest as unknown as ServerResponse, 'user:ana', { gzip: true });
    expect(connectedClients()).toBe(1);

    const decoded = new Promise<string>((resolve, reject) => {
      const gunzip = createGunzip();
      let text = '';
      gunzip.setEncoding('utf8');
      gunzip.on('data', (d: string) => (text += d));
      gunzip.on('error', reject);
      gunzip.on('end', () => resolve(text));
      dest.on('end', () => gunzip.end(Buffer.concat(chunks)));
    });
    endStreamOf(dest as unknown as ServerResponse);
    // The response ends once the compressor has written its trailer; the route's close handler then removes the screen.
    await expect(decoded).resolves.toBe('');
    gone();
    expect(connectedClients()).toBe(0);

    const stranger = new PassThrough();
    endStreamOf(stranger as unknown as ServerResponse);
    expect(stranger.writableEnded).toBe(true);
  });
});

describe('limits on live screens (SC-15)', () => {
  const limits = { maxClients: 3, maxPerUser: 2 };

  it('refuses a user past the per-user cap, and anyone past the overall cap, then admits again once one leaves', () => {
    expect(refusalFor('user:ana', limits)).toBeNull();
    const a1 = screen('user:ana');
    const a2 = screen('user:ana');
    expect(refusalFor('user:ana', limits)).toMatch(/This account already has 2 live screens open/);
    expect(refusalFor('user:budi', limits)).toBeNull(); // another account is not held back by ana's
    const b1 = screen('user:budi');
    expect(refusalFor('user:budi', limits)).toMatch(/already streaming to 3 screens.*STREAM_MAX_CLIENTS/);
    expect(refusalFor('user:cici', limits)).toMatch(/already streaming to 3 screens/);

    a1.close();
    expect(refusalFor('user:ana', limits)).toBeNull();
    expect(refusalFor('user:cici', limits)).toBeNull();
    a2.close();
    b1.close();
  });

  it('defaults to 100 screens and 5 per user, and cannot be set below 1', () => {
    expect(config.stream).toEqual({ maxClients: 100, maxPerUser: 5 });
  });

  /** A real listening BFF whose requests arrive as the user named in `x-test-user`, with `exp` from `x-test-exp`. */
  async function listening(prepare?: (app: FastifyInstance) => Promise<void>) {
    invalidate('');
    getProblemsMock.mockReset().mockResolvedValue([problem()]);
    const app = Fastify({ logger: false });
    await prepare?.(app);
    app.addHook('onRequest', async (req) => {
      const sub = req.headers['x-test-user'];
      const exp = req.headers['x-test-exp'];
      if (typeof sub === 'string') (req as unknown as { user: object }).user = { sub, ...(exp ? { exp: Number(exp) } : {}) };
    });
    await app.register(streamRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const open = (headers: Record<string, string> = {}) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; req: http.ClientRequest; ended: Promise<void> }>(
        (resolve, reject) => {
          const req = http.get({ host: '127.0.0.1', port, path: '/api/stream', headers, agent: false }, (res) => {
            let body = '';
            let done = false;
            const ended = new Promise<void>((end) => res.on('end', end).on('close', end));
            const settle = () => {
              if (done) return;
              done = true;
              resolve({ status: res.statusCode ?? 0, headers: res.headers, body, req, ended });
            };
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
              if (body.includes('\n\n')) settle();
            });
            res.on('end', settle);
          });
          req.on('error', reject);
        },
      );
    return { app, open };
  }

  it('answers a screen over the per-user cap with a 429 and a reason, and keeps the others streaming', async () => {
    const { app, open } = await listening();
    const was = config.stream.maxPerUser;
    config.stream.maxPerUser = 2;
    try {
      const one = await open({ 'x-test-user': 'ana' });
      const two = await open({ 'x-test-user': 'ana' });
      expect([one.status, two.status]).toEqual([200, 200]);
      expect(connectedClients()).toBe(2);

      const refused = await open({ 'x-test-user': 'ana' });
      expect(refused.status).toBe(429);
      expect(refused.headers['content-type']).toMatch(/application\/json/);
      expect(refused.headers['retry-after']).toBe('30');
      expect(JSON.parse(refused.body)).toEqual({
        error: 'too_many_streams',
        message: 'This account already has 2 live screens open. Close one and try again.',
      });
      expect(connectedClients()).toBe(2);

      // Another account is unaffected; the same account is admitted once a screen closes.
      const budi = await open({ 'x-test-user': 'budi' });
      expect(budi.status).toBe(200);
      one.req.destroy();
      await vi.waitFor(() => expect(connectedClients()).toBe(2));
      const again = await open({ 'x-test-user': 'ana' });
      expect(again.status).toBe(200);

      for (const s of [two, budi, again]) s.req.destroy();
      await vi.waitFor(() => expect(connectedClients()).toBe(0));
    } finally {
      config.stream.maxPerUser = was;
      await app.close();
    }
  });

  it('answers a screen over the overall cap with a 429, whoever it is', async () => {
    const { app, open } = await listening();
    const was = config.stream.maxClients;
    config.stream.maxClients = 2;
    try {
      const one = await open({ 'x-test-user': 'ana' });
      const two = await open({ 'x-test-user': 'budi' });
      const refused = await open({ 'x-test-user': 'cici' });
      expect(refused.status).toBe(429);
      expect(JSON.parse(refused.body).message).toMatch(/already streaming to 2 screens/);
      expect(connectedClients()).toBe(2);
      for (const s of [one, two]) s.req.destroy();
      await vi.waitFor(() => expect(connectedClients()).toBe(0));
    } finally {
      config.stream.maxClients = was;
      await app.close();
    }
  });

  it('counts a client address as the owner when nobody is signed in (auth off)', async () => {
    const { app, open } = await listening();
    const was = config.stream.maxPerUser;
    config.stream.maxPerUser = 1;
    try {
      const one = await open();
      expect(one.status).toBe(200);
      expect((await open()).status).toBe(429);
      one.req.destroy();
      await vi.waitFor(() => expect(connectedClients()).toBe(0));
    } finally {
      config.stream.maxPerUser = was;
      await app.close();
    }
  });

  it('ends a signed-in stream when its token expires, so the browser reconnects with the renewed cookie', async () => {
    const { app, open } = await listening();
    try {
      const exp = Math.floor(Date.now() / 1000) + 1;
      const s = await open({ 'x-test-user': 'ana', 'x-test-exp': String(exp) });
      expect(s.status).toBe(200);
      expect(connectedClients()).toBe(1);
      await s.ended; // the BFF ended it: nothing here closed the socket
      await vi.waitFor(() => expect(connectedClients()).toBe(0), { timeout: 2_000 });

      // A token already expired by the time it is read: ended at once.
      const stale = await open({ 'x-test-user': 'ana', 'x-test-exp': String(Math.floor(Date.now() / 1000) - 60) });
      await stale.ended;
      await vi.waitFor(() => expect(connectedClients()).toBe(0));
    } finally {
      await app.close();
    }
  });

  it('with the real sign-in guard, counts the user the token names and ends the stream when that token expires', async () => {
    const { setupAuth, tokenClaims } = await import('../security/auth.js');
    const was = { auth: config.auth.enabled, perUser: config.stream.maxPerUser, users: process.env.PORTAL_USERS };
    config.auth.enabled = true;
    config.stream.maxPerUser = 1;
    // Both users must be listed, and a token must carry this portal's issuer and audience: the guard checks both.
    process.env.PORTAL_USERS = 'ana:ana-test-pass:viewer,budi:budi-test-pass:viewer';
    let sign: (name: string, expiresIn: string) => string = () => '';
    const { app, open } = await listening(async (a) => {
      await setupAuth(a);
      sign = (name, expiresIn) => a.jwt.sign({ sub: name, role: 'viewer', ...tokenClaims(config.auth.sessionCookie) }, { expiresIn });
    });
    try {
      expect((await open()).status).toBe(401); // the guard still runs first
      const ana = await open({ authorization: `Bearer ${sign('ana', '2s')}` });
      expect(ana.status).toBe(200);
      const again = await open({ authorization: `Bearer ${sign('ana', '1h')}` });
      expect(again.status).toBe(429); // a second token for the same user is the same user
      const budi = await open({ authorization: `Bearer ${sign('budi', '1h')}` });
      expect(budi.status).toBe(200);

      await ana.ended; // ended by the BFF when ana's 2 s token ran out
      await vi.waitFor(() => expect(connectedClients()).toBe(1));
      budi.req.destroy();
      await vi.waitFor(() => expect(connectedClients()).toBe(0));
    } finally {
      config.auth.enabled = was.auth;
      config.stream.maxPerUser = was.perUser;
      if (was.users === undefined) delete process.env.PORTAL_USERS;
      else process.env.PORTAL_USERS = was.users;
      await app.close();
    }
  });

  it('drops the expiry timer when a signed-in screen leaves early, rather than holding it for the token\'s 12 h', async () => {
    const { app, open } = await listening();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // after the server is up: only the route's timer is counted
    try {
      const exp = String(Math.floor(Date.now() / 1000) + 12 * 3600);
      const s = await open({ 'x-test-user': 'ana', 'x-test-exp': exp });
      expect(s.status).toBe(200);
      expect(vi.getTimerCount()).toBe(1);
      s.req.destroy();
      await vi.waitFor(() => expect(connectedClients()).toBe(0));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it('leaves a stream with no expiry (auth off) open', async () => {
    const { app, open } = await listening();
    try {
      const s = await open();
      let ended = false;
      void s.ended.then(() => (ended = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(ended).toBe(false);
      expect(connectedClients()).toBe(1);
      s.req.destroy();
      await vi.waitFor(() => expect(connectedClients()).toBe(0));
    } finally {
      await app.close();
    }
  });
});

describe('closing the server (BK-06)', () => {
  it('ends every stream, so app.close() finishes while screens are still connected', async () => {
    invalidate('');
    getProblemsMock.mockReset().mockResolvedValue([problem()]);
    const app = Fastify({ logger: false });
    await app.register(streamRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const ended: Promise<void>[] = [];
    const opened = await Promise.all(
      [0, 1, 2].map(
        () =>
          new Promise<void>((resolve, reject) => {
            const req = http.get({ host: '127.0.0.1', port, path: '/api/stream' }, (res) => {
              ended.push(new Promise<void>((end) => res.on('end', end).on('close', end)));
              res.once('data', () => resolve());
            });
            req.on('error', reject);
          }),
      ),
    );
    expect(opened).toHaveLength(3);
    expect(connectedClients()).toBe(3);

    // Without the stream's preClose hook this never resolves: the test times out.
    await app.close();
    await Promise.all(ended); // every screen saw its stream end
    expect(connectedClients()).toBe(0);
  });

  it('endStreams() ends and forgets every screen, and stops the ticker', async () => {
    useClock();
    getProblemsMock.mockResolvedValue([problem()]);
    const a = screen('user:ana');
    const b = screen('user:budi');
    await settle();

    expect(endStreams()).toBe(2);
    expect(a.res.writableEnded && b.res.writableEnded).toBe(true);
    expect(connectedClients()).toBe(0);
    const reads = getProblemsMock.mock.calls.length;
    await tick(60_000);
    expect(getProblemsMock).toHaveBeenCalledTimes(reads);
    expect(endStreams()).toBe(0);
  });
});
