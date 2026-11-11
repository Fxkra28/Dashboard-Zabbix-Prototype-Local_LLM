import { crc32, inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { zip } from '../export/zip.js';

/** A second, independent reader: the central directory, then each local header, then the data. */
interface Read {
  name: string;
  method: number;
  flags: number;
  crc: number;
  time: number;
  date: number;
  data: Buffer;
}

/** Reads the central directory, then each local header, which must say the same, then the data. */
function unzip(buf: Buffer): Read[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(end + 10);
  expect(buf.readUInt16LE(end + 8)).toBe(count);
  let at = buf.readUInt32LE(end + 16);
  expect(at + buf.readUInt32LE(end + 12)).toBe(end);

  // Collected, not asserted one by one: a 65,535 entry archive would otherwise cost over a million expect calls.
  const problems: string[] = [];
  const same = (what: string, got: unknown, want: unknown) => {
    if (got !== want) problems.push(`${what}: got ${String(got)}, want ${String(want)}`);
  };
  const out: Read[] = [];
  let next = 0; // where the next local header must start: entries sit back to back
  for (let i = 0; i < count; i++) {
    same(`entry ${i} central signature`, buf.readUInt32LE(at), 0x02014b50);
    const made = buf.readUInt16LE(at + 4);
    const needed = buf.readUInt16LE(at + 6);
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const time = buf.readUInt16LE(at + 12);
    const date = buf.readUInt16LE(at + 14);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nlen = buf.readUInt16LE(at + 28);
    const skip = buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nlen).toString('utf8');
    same(`${name}: version made by`, made, 20);
    same(`${name}: version needed`, needed, method === 8 ? 20 : 10);
    same(`${name}: extra field and comment`, skip, 0);
    same(`${name}: offset, entries sit back to back`, local, next);

    // The local header must agree with the central one on every field both carry: a reader that streams trusts it.
    same(`${name}: local signature`, buf.readUInt32LE(local), 0x04034b50);
    same(`${name}: local version needed`, buf.readUInt16LE(local + 4), needed);
    same(`${name}: local flags`, buf.readUInt16LE(local + 6), flags);
    same(`${name}: local method`, buf.readUInt16LE(local + 8), method);
    same(`${name}: local time`, buf.readUInt16LE(local + 10), time);
    same(`${name}: local date`, buf.readUInt16LE(local + 12), date);
    same(`${name}: local CRC-32`, buf.readUInt32LE(local + 14), crc);
    same(`${name}: local compressed size`, buf.readUInt32LE(local + 18), csize);
    same(`${name}: local uncompressed size`, buf.readUInt32LE(local + 22), usize);
    same(`${name}: local name length`, buf.readUInt16LE(local + 26), nlen);
    same(`${name}: local extra length`, buf.readUInt16LE(local + 28), 0);
    same(`${name}: local name`, buf.subarray(local + 30, local + 30 + nlen).toString('utf8'), name);

    const start = local + 30 + nlen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    same(`${name}: size of the data`, data.length, usize);
    same(`${name}: CRC-32 of the data`, crc32(data), crc);
    out.push({ name, method, flags, crc, time, date, data });
    next = start + csize;
    at += 46 + nlen + skip;
  }
  same('the directory starts where the last entry ends', buf.readUInt32LE(end + 16), next);
  expect(problems.slice(0, 5)).toEqual([]);
  return out;
}

const text = (s: string) => Buffer.from(s, 'utf8');

describe('zip', () => {
  const entries = [
    { name: 'a.txt', data: text('hello '.repeat(200)) },
    { name: '[Content_Types].xml', data: text('<Types/>') },
    { name: 'dir/b.bin', data: randomBytes(300) },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];

  it('round-trips every entry byte for byte', () => {
    const read = unzip(zip(entries));
    expect(read.map((r) => r.name).sort()).toEqual(entries.map((e) => e.name).sort());
    for (const r of read) {
      const want = entries.find((e) => e.name === r.name)!;
      expect(r.data.equals(want.data)).toBe(true);
      expect(r.crc).toBe(crc32(want.data));
    }
  });

  it('puts [Content_Types].xml first and keeps the rest in order', () => {
    expect(unzip(zip(entries)).map((r) => r.name)).toEqual(['[Content_Types].xml', 'a.txt', 'dir/b.bin', 'empty.txt']);
  });

  it('deflates what shrinks and stores what does not', () => {
    const byName = Object.fromEntries(unzip(zip(entries)).map((r) => [r.name, r.method]));
    expect(byName['a.txt']).toBe(8);
    expect(byName['dir/b.bin']).toBe(0);
    expect(byName['empty.txt']).toBe(0);
  });

  it('flags names as UTF-8 and reads them back', () => {
    const read = unzip(zip([{ name: 'xl/Zürich 東京.xml', data: text('x') }]));
    expect(read[0]!.name).toBe('xl/Zürich 東京.xml');
    expect(read[0]!.flags & 0x0800).toBe(0x0800);
  });

  it('stamps the DOS time from now, in UTC, so the bytes repeat', () => {
    const now = new Date('2026-10-01T07:20:42Z');
    const a = zip(entries, now);
    expect(a.equals(zip(entries, now))).toBe(true);
    const r = unzip(a)[0]!;
    expect(r.date).toBe(((2026 - 1980) << 9) | (10 << 5) | 1);
    expect(r.time).toBe((7 << 11) | (20 << 5) | 21);
    expect(a.equals(zip(entries, new Date('2026-10-01T07:20:44Z')))).toBe(false);
  });

  it('clamps a date outside what DOS can hold', () => {
    expect(unzip(zip(entries, new Date('1970-01-01T00:00:00Z')))[0]!.date).toBe((0 << 9) | (1 << 5) | 1);
    expect(unzip(zip(entries, new Date(Number.NaN)))[0]!.date).toBe((0 << 9) | (1 << 5) | 1);
  });

  it('writes an empty archive that is just the end record', () => {
    const empty = zip([]);
    expect(empty.length).toBe(22);
    expect(unzip(empty)).toEqual([]);
  });

  it('refuses more than 65,535 entries', () => {
    const many = Array.from({ length: 65536 }, (_, i) => ({ name: `p${i}`, data: Buffer.alloc(0) }));
    expect(() => zip(many)).toThrow(/65535 entries/);
    expect(unzip(zip(many.slice(0, 65535))).length).toBe(65535);
  });

  it('refuses a part of 4 GiB or more', () => {
    const huge = { name: 'big', data: { length: 2 ** 32 } as unknown as Buffer };
    expect(() => zip([huge])).toThrow(/4 GiB/);
  });

  it('refuses duplicate and empty names', () => {
    expect(() => zip([{ name: 'a', data: text('1') }, { name: 'a', data: text('2') }])).toThrow(/Duplicate/);
    expect(() => zip([{ name: '', data: text('1') }])).toThrow(/name/);
  });
});
