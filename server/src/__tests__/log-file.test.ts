import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogStream, createRotatingFile, logFileStatus } from '../core/logFile.js';

// A disk that fills part-way: the next write lands `after` bytes and the one after that fails, which is how a full disk shows in `writeSync`.
const fsHooks = vi.hoisted(() => ({ cut: null as null | { after: number; phase: 'short' | 'fail' } }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeSync: (fd: number, buffer: NodeJS.ArrayBufferView, offset?: number, length?: number, position?: number | null) => {
      const cut = fsHooks.cut;
      if (cut?.phase === 'short') {
        cut.phase = 'fail';
        const start = offset ?? 0;
        return actual.writeSync(fd, buffer as Buffer, start, Math.min(cut.after, (buffer as Buffer).length - start));
      }
      if (cut?.phase === 'fail') {
        fsHooks.cut = null;
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
      }
      return actual.writeSync(fd, buffer as Buffer, offset, length, position);
    },
  };
});

/** The BFF's own copy of its log (SC-42), kept in a volume through a rebuild: it rotates by size and count and never throws. */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portal-log-'));
});
afterEach(() => {
  fsHooks.cut = null;
  rmSync(dir, { recursive: true, force: true });
});

/** One log line, with a number to tell it apart. */
const line = (n: number, pad = 20) => `${JSON.stringify({ n, pad: 'x'.repeat(pad) })}\n`;
const LINE = line(1).length;
const names = () => readdirSync(dir).sort();
const text = (file: string) => readFileSync(join(dir, file), 'utf8');
const numbers = (file: string) =>
  text(file)
    .split('\n')
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { n: number }).n);

const put = (s: Writable, data: string) =>
  new Promise<void>((resolve, reject) => s.write(data, (err) => (err ? reject(err) : resolve())));
const finish = (s: Writable) => new Promise<void>((resolve) => s.end(resolve));

describe('createRotatingFile', () => {
  it('makes the folder and appends each line in order', async () => {
    const s = createRotatingFile({ dir: join(dir, 'a', 'b'), maxBytes: 100_000, keep: 3 }, vi.fn());
    for (const n of [1, 2, 3]) await put(s, line(n));
    await finish(s);
    expect(readdirSync(join(dir, 'a', 'b'))).toEqual(['bff.log']);
    expect(readFileSync(join(dir, 'a', 'b', 'bff.log'), 'utf8')).toBe(line(1) + line(2) + line(3));
  });

  it('moves the file aside when the next line would pass the limit, and numbers the older ones', async () => {
    const s = createRotatingFile({ dir, maxBytes: LINE * 2, keep: 3 }, vi.fn());
    for (const n of [1, 2, 3, 4, 5]) await put(s, line(n));
    await finish(s);
    expect(names()).toEqual(['bff.log', 'bff.log.1', 'bff.log.2']);
    expect(numbers('bff.log')).toEqual([5]);
    expect(numbers('bff.log.1')).toEqual([3, 4]);
    expect(numbers('bff.log.2')).toEqual([1, 2]);
  });

  it('drops the oldest file once more than the number kept would exist', async () => {
    const s = createRotatingFile({ dir, maxBytes: LINE * 2, keep: 3 }, vi.fn());
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await put(s, line(n));
    await finish(s);
    expect(names()).toEqual(['bff.log', 'bff.log.1', 'bff.log.2']);
    expect(numbers('bff.log')).toEqual([7]);
    expect(numbers('bff.log.1')).toEqual([5, 6]);
    expect(numbers('bff.log.2')).toEqual([3, 4]);
  });

  it('keeps one file when told to keep one, starting it over at the limit', async () => {
    const s = createRotatingFile({ dir, maxBytes: LINE * 2, keep: 1 }, vi.fn());
    for (const n of [1, 2, 3]) await put(s, line(n));
    await finish(s);
    expect(names()).toEqual(['bff.log']);
    expect(numbers('bff.log')).toEqual([3]);
  });

  it('counts what is already in the file when it starts, so a restart does not overshoot the limit', async () => {
    writeFileSync(join(dir, 'bff.log'), line(1) + line(2));
    const s = createRotatingFile({ dir, maxBytes: LINE * 2, keep: 2 }, vi.fn());
    await put(s, line(3));
    await finish(s);
    expect(numbers('bff.log.1')).toEqual([1, 2]);
    expect(numbers('bff.log')).toEqual([3]);
  });

  it('never rotates a file that is still empty, however small the limit', async () => {
    const s = createRotatingFile({ dir, maxBytes: 1, keep: 3 }, vi.fn());
    await put(s, line(1));
    await finish(s);
    expect(names()).toEqual(['bff.log']);
    expect(numbers('bff.log')).toEqual([1]);
  });

  it('keeps the file private to the user the portal runs as, whatever the umask', async () => {
    const before = process.umask(0);
    try {
      const s = createRotatingFile({ dir, maxBytes: 1000, keep: 2 }, vi.fn());
      await put(s, line(1));
      await finish(s);
      expect(statSync(join(dir, 'bff.log')).mode & 0o077).toBe(0);
    } finally {
      process.umask(before);
    }
  });

  it('puts the line after a write that stopped part-way on a line of its own, so only the cut line is lost', async () => {
    const problem = vi.fn();
    const s = createRotatingFile({ dir, maxBytes: 100_000, keep: 3 }, problem);
    await put(s, line(1));
    fsHooks.cut = { after: 10, phase: 'short' };
    await put(s, line(2));
    await put(s, line(3));
    await put(s, line(4));
    await finish(s);
    expect(problem).toHaveBeenCalledTimes(1);
    // The cut line is ten bytes and a newline, the lines after it whole, and no line owes a newline to the one before it twice.
    expect(text('bff.log')).toBe(`${line(1)}${line(2).slice(0, 10)}\n${line(3)}${line(4)}`);
  });

  it('starts the file after a rotation clean, with no newline owed to a cut line of the file before', async () => {
    const s = createRotatingFile({ dir, maxBytes: LINE * 2, keep: 3 }, vi.fn());
    await put(s, line(1));
    fsHooks.cut = { after: 10, phase: 'short' };
    await put(s, line(2));
    await put(s, line(3));
    await put(s, line(4));
    await finish(s);
    // Line 2 was cut, and line 3 did not fit behind the fragment: it began the next file, which owes nothing to the one before.
    expect(text('bff.log').startsWith('{')).toBe(true);
    expect(numbers('bff.log')).toEqual([3, 4]);
  });

  it('does not throw when the folder cannot be made, tells the problem once, and swallows the lines', async () => {
    writeFileSync(join(dir, 'in-the-way'), 'a file where a folder should be');
    const problem = vi.fn();
    const s = createRotatingFile({ dir: join(dir, 'in-the-way', 'logs'), maxBytes: 1000, keep: 2 }, problem);
    for (const n of [1, 2, 3]) await put(s, line(n));
    await finish(s);
    expect(problem).toHaveBeenCalledTimes(1);
    expect(String(problem.mock.calls[0]![0])).toMatch(/log file/);
  });

  it('starts writing when the folder becomes usable again, and tells the problem again when it breaks again', async () => {
    const blocker = join(dir, 'in-the-way');
    writeFileSync(blocker, 'x');
    const problem = vi.fn();
    const s = createRotatingFile({ dir: join(blocker, 'logs'), maxBytes: LINE * 2, keep: 3 }, problem);
    await put(s, line(1));
    expect(problem).toHaveBeenCalledTimes(1);

    rmSync(blocker);
    mkdirSync(join(blocker, 'logs'), { recursive: true });
    await put(s, line(2));
    await put(s, line(3));
    expect(readFileSync(join(blocker, 'logs', 'bff.log'), 'utf8')).toBe(line(2) + line(3));
    expect(problem).toHaveBeenCalledTimes(1);

    // A folder where the oldest file should be: dropping it fails, which is a second failure after a good run.
    mkdirSync(join(blocker, 'logs', 'bff.log.2', 'taken'), { recursive: true });
    await put(s, line(4));
    await put(s, line(5));
    await finish(s);
    expect(problem).toHaveBeenCalledTimes(2);
  });
});

describe('createLogStream', () => {
  const capture = () => {
    const chunks: string[] = [];
    const out = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    return { out, text: () => chunks.join('') };
  };

  it('is nothing when no folder is named, so the log stays on stdout alone', () => {
    expect(createLogStream({ dir: '', fileMaxMb: 20, fileKeep: 10 })).toBeUndefined();
  });

  it('writes every line to the output and to the file, in the same order', async () => {
    const { out, text: seen } = capture();
    const s = createLogStream({ dir, fileMaxMb: 20, fileKeep: 10 }, out, vi.fn())!;
    for (const n of [1, 2, 3]) await put(s, line(n));
    await finish(s);
    expect(seen()).toBe(line(1) + line(2) + line(3));
    expect(text('bff.log')).toBe(line(1) + line(2) + line(3));
  });

  it('counts the limit in megabytes and the number of files as it is told', async () => {
    const { out } = capture();
    const s = createLogStream({ dir, fileMaxMb: 1, fileKeep: 2 }, out, vi.fn())!;
    const big = line(0, 100_000);
    for (let i = 0; i < 25; i++) await put(s, big);
    await finish(s);
    expect(names()).toEqual(['bff.log', 'bff.log.1']);
    expect(statSync(join(dir, 'bff.log')).size).toBeLessThanOrEqual(1024 * 1024);
    expect(statSync(join(dir, 'bff.log.1')).size).toBeGreaterThan(900 * 1024);
  });

  it('keeps the output going when the file cannot be written', async () => {
    writeFileSync(join(dir, 'in-the-way'), 'x');
    const { out, text: seen } = capture();
    const problem = vi.fn();
    const s = createLogStream({ dir: join(dir, 'in-the-way', 'logs'), fileMaxMb: 20, fileKeep: 10 }, out, problem)!;
    await put(s, line(1));
    await finish(s);
    expect(seen()).toBe(line(1));
    expect(problem).toHaveBeenCalledTimes(1);
  });

  it('takes Fastify’s log lines, as the BFF hands it to the logger', async () => {
    const { out } = capture();
    const stream = createLogStream({ dir, fileMaxMb: 20, fileKeep: 10 }, out, vi.fn())!;
    const app = Fastify({ logger: { level: 'info', stream } });
    app.get('/x', () => ({ ok: true }));
    await app.inject({ url: '/x' });
    await app.close();
    await finish(stream);
    const lines = text('bff.log')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { msg?: string });
    expect(lines.some((l) => l.msg === 'request completed')).toBe(true);
  });
});

describe('the settings', () => {
  afterEach(() => vi.unstubAllEnvs());

  const read = async (env: Record<string, string | undefined>) => {
    vi.resetModules();
    for (const [k, v] of Object.entries({ LOG_DIR: undefined, LOG_FILE_MAX_MB: undefined, LOG_FILE_KEEP: undefined, ...env })) vi.stubEnv(k, v);
    return (await import('../core/config.js')).config.log;
  };

  it('is off, 20 MB and ten files when nothing is set', async () => {
    expect(await read({})).toEqual({ dir: '', fileMaxMb: 20, fileKeep: 10 });
  });

  it('takes the folder and the two numbers as given', async () => {
    expect(await read({ LOG_DIR: ' /var/log/portal ', LOG_FILE_MAX_MB: '5', LOG_FILE_KEEP: '30' })).toEqual({ dir: '/var/log/portal', fileMaxMb: 5, fileKeep: 30 });
  });

  it('keeps at most 100 files, so that a typo cannot make every rotation a long run of renames', async () => {
    expect(await read({ LOG_FILE_KEEP: '1000000' })).toMatchObject({ fileKeep: 100 });
    expect(await read({ LOG_FILE_KEEP: '100' })).toMatchObject({ fileKeep: 100 });
    expect(await read({ LOG_FILE_KEEP: '99' })).toMatchObject({ fileKeep: 99 });
  });

  it('keeps at least one file of at least one megabyte, and falls back on a number it cannot read', async () => {
    expect(await read({ LOG_FILE_MAX_MB: '0', LOG_FILE_KEEP: '0' })).toMatchObject({ fileMaxMb: 1, fileKeep: 1 });
    expect(await read({ LOG_FILE_MAX_MB: '-4', LOG_FILE_KEEP: '2.9' })).toMatchObject({ fileMaxMb: 1, fileKeep: 2 });
    expect(await read({ LOG_FILE_MAX_MB: 'lots', LOG_FILE_KEEP: 'many' })).toMatchObject({ fileMaxMb: 20, fileKeep: 10 });
  });
});

// IN-83: the file could stop being written and nobody was told, since the lines still went to stdout. The signed-in health answer shows this.
describe('logFileStatus', () => {
  const capture = () => new Writable({ write: (_c, _e, cb) => cb() });

  it('is off, with nothing written, when no folder is named', () => {
    createLogStream({ dir: '', fileMaxMb: 20, fileKeep: 10 });
    expect(logFileStatus()).toEqual({ state: 'off', written: 0 });
  });

  it('is ok from the start, and counts the bytes written, across a rotation', async () => {
    const s = createLogStream({ dir, fileMaxMb: 1, fileKeep: 3 }, capture())!;
    expect(logFileStatus()).toEqual({ state: 'ok', written: 0 });
    for (const n of [1, 2, 3]) await put(s, line(n));
    expect(logFileStatus()).toEqual({ state: 'ok', written: LINE * 3 });
    await finish(s);
  });

  it('counts the bytes of every line written, across the rotations of a small file', async () => {
    const track = { failing: false, written: 0 };
    const s = createRotatingFile({ dir, maxBytes: LINE * 2, keep: 3 }, vi.fn(), track);
    for (const n of [1, 2, 3, 4, 5]) await put(s, line(n));
    await finish(s);
    expect(names()).toEqual(['bff.log', 'bff.log.1', 'bff.log.2']);
    expect(track).toEqual({ failing: false, written: LINE * 5 });
  });

  it('says failing while the file cannot be written, with the bytes that did land, and ok again once it can', async () => {
    const blocker = join(dir, 'in-the-way');
    writeFileSync(blocker, 'x');
    const problem = vi.fn();
    const s = createLogStream({ dir: join(blocker, 'logs'), fileMaxMb: 1, fileKeep: 3 }, capture(), problem)!;
    await put(s, line(1));
    expect(logFileStatus()).toEqual({ state: 'failing', written: 0 });

    rmSync(blocker);
    mkdirSync(join(blocker, 'logs'), { recursive: true });
    await put(s, line(2));
    expect(logFileStatus()).toEqual({ state: 'ok', written: LINE });
    await finish(s);
  });

  it('counts only what reached the file when a write stops part-way', async () => {
    const s = createLogStream({ dir, fileMaxMb: 1, fileKeep: 3 }, capture(), vi.fn())!;
    await put(s, line(1));
    fsHooks.cut = { after: 5, phase: 'short' };
    await put(s, line(2));
    expect(logFileStatus()).toEqual({ state: 'failing', written: LINE + 5 });
    await finish(s);
  });
});

