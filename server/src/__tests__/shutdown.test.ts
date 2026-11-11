import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { SHUTDOWN_TIMEOUT_MS, closeWith, installShutdown } from '../http/shutdown.js';
import { streamRoutes } from '../routes/stream.js';
import { connectedClients } from '../services/stream.js';
import { invalidate } from '../core/cache.js';

/** SIGTERM and SIGINT close the BFF. The signals come from a stand-in emitter, never the real process. */
vi.mock('../domain/queries.js', () => ({
  getProblems: vi.fn().mockResolvedValue([]),
  cachedProblems: vi.fn().mockResolvedValue([]),
  PROBLEMS_TTL_MS: 15_000,
}));

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const fakeApp = (close: () => Promise<void>) => ({ log: logger(), close: vi.fn(close) }) as unknown as FastifyInstance & {
  close: ReturnType<typeof vi.fn>;
};

afterEach(() => vi.useRealTimers());

describe('installShutdown', () => {
  it('listens for SIGTERM and SIGINT only, and takes them off again', () => {
    const source = new EventEmitter();
    const off = installShutdown(fakeApp(async () => undefined), { source, exit: vi.fn() });
    expect(source.eventNames().sort()).toEqual(['SIGINT', 'SIGTERM']);
    off();
    expect(source.eventNames()).toEqual([]);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)('on %s closes the app once, then exits 0', async (signal) => {
    const source = new EventEmitter();
    const exit = vi.fn();
    let release: () => void = () => undefined;
    const app = fakeApp(() => new Promise<void>((resolve) => (release = resolve)));
    installShutdown(app, { source, exit });

    source.emit(signal, signal);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled(); // not before the close has finished

    release();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(app.log.info).toHaveBeenCalledWith(`${signal} received: closing the BFF`);
  });

  it('a second signal while closing exits at once, without closing twice', () => {
    const source = new EventEmitter();
    const exit = vi.fn();
    const app = fakeApp(() => new Promise<void>(() => undefined));
    installShutdown(app, { source, exit });

    source.emit('SIGINT', 'SIGINT');
    source.emit('SIGINT', 'SIGINT');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when the close takes longer than the limit, and not before', () => {
    vi.useFakeTimers();
    const source = new EventEmitter();
    const exit = vi.fn();
    const app = fakeApp(() => new Promise<void>(() => undefined)); // a request that never finishes
    installShutdown(app, { source, exit });

    source.emit('SIGTERM', 'SIGTERM');
    vi.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(app.log.error).toHaveBeenCalledWith(expect.stringContaining('exiting anyway'));
  });

  it('keeps the limit under the 10 s Docker waits before it kills the container', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it('exits 1 and logs when the close fails', async () => {
    const source = new EventEmitter();
    const exit = vi.fn();
    const app = fakeApp(() => Promise.reject(new Error('onClose hook failed')));
    installShutdown(app, { source, exit });

    source.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(app.log.error).toHaveBeenCalled();
  });

  it('with a real server and a screen still connected, closes, ends the stream and exits 0', async () => {
    invalidate('');
    const app = Fastify({ logger: false });
    await app.register(streamRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    let ended: Promise<void> = Promise.resolve();
    await new Promise<void>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/stream' }, (res) => {
        ended = new Promise<void>((end) => res.on('end', end).on('close', end));
        res.once('data', () => resolve());
      });
      req.on('error', reject);
    });
    expect(connectedClients()).toBe(1);

    const source = new EventEmitter();
    const exit = vi.fn();
    installShutdown(app, { source, exit });
    source.emit('SIGTERM', 'SIGTERM');

    await ended; // the BFF ended the stream itself
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: SHUTDOWN_TIMEOUT_MS - 1_000 });
    expect(connectedClients()).toBe(0);
    expect(app.server.listening).toBe(false);
  });
});

describe('closeWith', () => {
  it('pauses the schedule when the close begins, and waits for it only after the server has drained its requests', async () => {
    const app = Fastify({ logger: false });
    const events: string[] = [];
    let finish: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    app.get('/slow', async () => {
      events.push('request started');
      await slow;
      events.push('request finished');
      return { ok: true };
    });
    closeWith(app, {
      pause: () => void events.push('pause'),
      stop: async () => void events.push('stop'),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    // A connection of its own, closed after the answer: a kept-alive one would hold the close open until its timeout.
    const answered = new Promise<void>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/slow', agent: false }, (res) => {
          res.resume();
          res.on('end', resolve);
        })
        .on('error', reject);
    });
    await vi.waitFor(() => expect(events).toContain('request started'));
    const closing = app.close();
    await vi.waitFor(() => expect(events).toContain('pause'));
    expect(events).not.toContain('stop'); // the server is still waiting for the request
    finish();
    await closing;
    await answered;
    expect(events).toEqual(['request started', 'pause', 'request finished', 'stop']);
  });
});

describe('server/Dockerfile', () => {
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const lines = dockerfile.split('\n').map((l) => l.trim());

  it('starts node itself in exec form, so SIGTERM reaches it', () => {
    const cmd = lines.filter((l) => l.startsWith('CMD ') || l.startsWith('ENTRYPOINT '));
    expect(cmd).toEqual(['CMD ["node", "dist/index.js"]']);
  });

  it('takes the build commit and time as arguments and keeps them in the environment', () => {
    expect(lines).toContain('ARG BUILD_COMMIT=unknown');
    expect(lines).toContain('ARG BUILD_TIME=unknown');
    expect(lines).toContain('ENV BUILD_COMMIT=$BUILD_COMMIT BUILD_TIME=$BUILD_TIME');
    // After the final stage starts, or the running image would not have them.
    const final = lines.lastIndexOf(lines.filter((l) => l.startsWith('FROM '))[1]);
    expect(lines.indexOf('ARG BUILD_COMMIT=unknown')).toBeGreaterThan(final);
  });

  it('puts the build arguments after the final stage\'s npm layers, so a new commit does not redo `npm ci`', () => {
    const final = lines.lastIndexOf(lines.filter((l) => l.startsWith('FROM '))[1]);
    // The step goes on over several lines (it also removes npm), so match where it starts.
    const npm = lines.findIndex((l) => l.startsWith('RUN npm ci --omit=dev'));
    expect(npm).toBeGreaterThan(final); // a guard: this line must exist, or the checks below mean nothing
    for (const arg of ['ARG BUILD_COMMIT=unknown', 'ARG BUILD_TIME=unknown', 'ENV BUILD_COMMIT=$BUILD_COMMIT BUILD_TIME=$BUILD_TIME']) {
      expect(lines.indexOf(arg), arg).toBeGreaterThan(npm);
    }
  });
});

describe('index.ts', () => {
  /** The code alone: a call inside a comment is not a call. */
  const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const code = withoutComments(readFileSync(new URL('../index.ts', import.meta.url), 'utf8'));
  const callAt = (call: string) => code.search(new RegExp(`^[ \\t]*${call.replace(/[().]/g, '\\$&')};`, 'm'));

  it('installs the signal handlers once the server is listening', () => {
    const listen = code.indexOf('await app.listen(');
    expect(listen).toBeGreaterThan(-1);
    expect(callAt('installShutdown(app)')).toBeGreaterThan(listen);
    expect(code).toMatch(/import \{[^}]*\binstallShutdown\b[^}]*\} from '\.\/http\/shutdown\.js';/);
  });

  it('closes the monthly schedule through closeWith, not with a hook of its own', () => {
    expect(code).toMatch(/import \{[^}]*\bcloseWith\b[^}]*\} from '\.\/http\/shutdown\.js';/);
    expect(callAt('closeWith(app, reportSchedule)')).toBeGreaterThan(-1);
    expect(code).not.toMatch(/addHook\('onClose'/);
  });

  it('starts the first readiness check once the server is listening, on the check /api/health serves', () => {
    expect(code).toMatch(/const readiness = registerHealth\(app\);/);
    expect(callAt('readiness.warm()')).toBeGreaterThan(code.indexOf('await app.listen('));
  });

  it('does not count a call that is commented out', () => {
    expect(withoutComments('  installShutdown(app);\n').search(/^[ \t]*installShutdown\(app\);/m)).toBe(0);
    expect(withoutComments('// installShutdown(app);\n').search(/^[ \t]*installShutdown\(app\);/m)).toBe(-1);
  });
});
