import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP writer, enough to package an .xlsx without a library. Plain
 * ZIP only (no zip64): a report is a few megabytes, so a package that outgrows
 * the 16-bit and 32-bit fields is a bug worth failing loudly on.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const MAX_ENTRIES = 0xffff;
// 0xffffffff itself is zip64's marker, so a plain zip stays below it.
const MAX_BYTES = 0xffffffff;
const CONTENT_TYPES = '[Content_Types].xml';

/** MS-DOS date and time fields, read in UTC so the same `now` gives the same bytes anywhere. */
function dosStamp(now: Date): { date: number; time: number } {
  const year = now.getUTCFullYear(); // NaN for an invalid date, which fails both bounds below
  const d = year >= 1980 && year <= 2107 ? now : new Date(Date.UTC(1980, 0, 1));
  return {
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}

/** Parts that do not shrink are stored, since deflate would only add bytes. */
function pack(data: Buffer): { method: 0 | 8; body: Buffer } {
  // The default level: level 9 took four times as long on a large sheet for 5% fewer bytes, and this call blocks the event loop.
  const deflated = deflateRawSync(data);
  return deflated.length < data.length ? { method: 8, body: deflated } : { method: 0, body: data };
}

export function zip(entries: ZipEntry[], now: Date = new Date()): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new RangeError(`A zip holds at most ${MAX_ENTRIES} entries without zip64; got ${entries.length}.`);
  }
  // The content-types part leads so a reader that streams the package finds it first.
  const ordered = [...entries.filter((e) => e.name === CONTENT_TYPES), ...entries.filter((e) => e.name !== CONTENT_TYPES)];
  const { date, time } = dosStamp(now);
  const seen = new Set<string>();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of ordered) {
    const name = Buffer.from(entry.name, 'utf8');
    if (name.length === 0 || name.length > 0xffff) throw new RangeError(`Bad zip entry name length: ${name.length}.`);
    if (seen.has(entry.name)) throw new Error(`Duplicate zip entry: ${entry.name}`);
    seen.add(entry.name);
    if (entry.data.length >= MAX_BYTES) throw new RangeError(`Zip entry ${entry.name} is over 4 GiB; zip64 is not supported.`);

    const { method, body } = pack(entry.data);
    const crc = crc32(entry.data);
    const needed = method === 8 ? 20 : 10;
    const flags = 0x0800; // names are UTF-8

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(needed, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(needed, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
    if (offset >= MAX_BYTES) throw new RangeError('The zip passes 4 GiB; zip64 is not supported.');
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
