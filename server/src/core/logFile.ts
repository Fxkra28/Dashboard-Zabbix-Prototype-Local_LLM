import { closeSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';

/** The BFF's own copy of its log in a folder that outlives the container (SC-42), rotated by size and count. It never throws: a log that cannot be kept must not stop the portal. */

const FILE = 'bff.log';
const NEWLINE = Buffer.from('\n');

export interface RotatingFileOptions {
  dir: string;
  /** A file is moved aside when the next line would take it past this. */
  maxBytes: number;
  /** Files kept, the current one included. */
  keep: number;
}

/** Told when the file cannot be written: once for each run of failures. */
export type Problem = (message: string) => void;

const toStderr: Problem = (message) => void process.stderr.write(`${message}\n`);

/** What a file reports about itself: whether its last write failed, and the bytes that reached it since the start. */
export interface Track {
  failing: boolean;
  written: number;
}

export interface LogFileStatus {
  /** `off` when no folder is named; `failing` while the file cannot be written. */
  state: 'off' | 'ok' | 'failing';
  written: number;
}

// The one file of this process. Shown in the signed-in health answer, so that a log that stopped is not found out at the next rebuild (IN-83).
let configured = false;
const shared: Track = { failing: false, written: 0 };

export const logFileStatus = (): LogFileStatus => ({ state: !configured ? 'off' : shared.failing ? 'failing' : 'ok', written: shared.written });

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `rename`, where a missing source just means that file was never made. */
function renameIfThere(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export function createRotatingFile(opts: RotatingFileOptions, onProblem: Problem = toStderr, track: Track = { failing: false, written: 0 }): Writable {
  const path = join(opts.dir, FILE);
  let fd: number | null = null;
  let size = 0;
  // A write that stopped part-way left a line without its end: the next one starts on a new line.
  let torn = false;

  const close = () => {
    if (fd === null) return;
    try {
      closeSync(fd);
    } catch {
      // Nothing to do with a descriptor that will not close.
    }
    fd = null;
  };

  // Opened when a line first needs it, and again after a failure, so a folder that becomes usable starts working without a restart.
  const open = () => {
    mkdirSync(opts.dir, { recursive: true });
    fd = openSync(path, 'a', 0o600);
    size = fstatSync(fd).size;
  };

  const rotate = () => {
    close();
    if (opts.keep <= 1) rmSync(path, { force: true });
    else {
      rmSync(`${path}.${opts.keep - 1}`, { force: true });
      for (let i = opts.keep - 2; i >= 1; i--) renameIfThere(`${path}.${i}`, `${path}.${i + 1}`);
      renameSync(path, `${path}.1`);
    }
    open();
    torn = false;
  };

  const append = (chunk: Buffer) => {
    if (fd === null) open();
    // A file with nothing in it is never rotated, so a limit smaller than one line cannot loop.
    if (size > 0 && size + chunk.length > opts.maxBytes) rotate();
    const line = torn ? Buffer.concat([NEWLINE, chunk]) : chunk;
    let done = 0;
    try {
      while (done < line.length) {
        const n = writeSync(fd!, line, done);
        done += n;
        size += n;
        track.written += n;
      }
    } catch (err) {
      torn = torn || done > 0;
      throw err;
    }
    torn = false;
  };

  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      try {
        append(chunk);
        track.failing = false;
      } catch (err) {
        close();
        if (!track.failing) {
          track.failing = true;
          onProblem(`The log file ${path} cannot be written (${reason(err)}). Lines still go to the container's own log.`);
        }
      }
      done();
    },
    final(done) {
      close();
      done();
    },
  });
}

export interface LogSettings {
  /** Empty: no file, the log goes to stdout alone. */
  dir: string;
  fileMaxMb: number;
  fileKeep: number;
}

/** What Fastify's logger writes to: every line to `out` first, then to the file. Nothing when no folder is named. */
export function createLogStream(
  settings: LogSettings,
  out: NodeJS.WritableStream = process.stdout,
  onProblem?: Problem,
): Writable | undefined {
  configured = Boolean(settings.dir);
  shared.failing = false;
  shared.written = 0;
  if (!settings.dir) return undefined;
  const file = createRotatingFile({ dir: settings.dir, maxBytes: settings.fileMaxMb * 1024 * 1024, keep: settings.fileKeep }, onProblem, shared);
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      out.write(chunk);
      file.write(chunk);
      done();
    },
    // Not `out`: stdout cannot be ended.
    final(done) {
      file.end(done);
    },
  });
}
