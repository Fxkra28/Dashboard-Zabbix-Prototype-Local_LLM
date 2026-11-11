/**
 * Check the derived SLA against HCML's own Availability Reports.
 *
 *   npx tsx scripts/validate-sli.ts [months…]        (default 2026-06 2026-07 2026-08)
 *
 * Reads `~/Downloads/Availability_Report_<month>.xlsx` (override the folder
 * with REPORT_DIR) in memory and compares it with the running BFF's
 * `GET /api/sli?month=…&profile=hcml-report` (override with BFF_URL; behind
 * nginx that is the portal's address plus /bff). A month with no spreadsheet
 * is skipped. With sign-in on, set PORTAL_USER and PORTAL_PASSWORD.
 *
 * Exit 0: every month checked passed. 1: one failed. 2: nothing was checked
 * or the portal could not be reached or signed in to.
 *
 * Read-only on both sides. The reports hold HCML's real host names and event
 * ids, so nothing from them is written anywhere, only a pass/fail summary and
 * the differences are printed.
 *
 * Acceptance: identical host set and category counts; overall and every
 * category within 0.005 pp; every host within 0.01 pp; 95% of hosts within
 * 60 s of downtime; incident count within ±2 of the report's event rows.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

// a minimal xlsx reader: zip central directory + sheet XML

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function readSheets(path: string): Map<string, Record<string, string>[]> {
  const files = unzip(readFileSync(path));
  const text = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const strings = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  const out = new Map<string, Record<string, string>[]>();
  for (const m of text('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const xml = text(`xl/${rels.get(m[2])}`);
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
      const cells: Record<string, string> = {};
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1];
        const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1];
        cells[c[1]] = v !== undefined ? (c[2].includes('t="s"') ? strings[Number(v)] : decode(v)) : decode(inline ?? '');
      }
      return cells;
    });
    const [header, ...body] = rows;
    out.set(
      decode(m[1]),
      body.map((row) => Object.fromEntries(Object.entries(header ?? {}).map(([col, name]) => [name, row[col] ?? '']))),
    );
  }
  return out;
}


interface SliReport {
  overall: { hosts: number; sli: number | null };
  categories: { name: string; hosts: number; sli: number | null }[];
  hosts: { name: string; sli: number | null; downtime: number; incidents: number; category: string }[];
  stats: { ms: number };
}

const months = process.argv.slice(2).length ? process.argv.slice(2) : ['2026-06', '2026-07', '2026-08'];
const dir = process.env.REPORT_DIR || join(homedir(), 'Downloads');
const bff = (process.env.BFF_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

/** The session cookie of PORTAL_USER, for a portal with sign-in on; undefined when no account is given. */
async function signIn(): Promise<string | undefined> {
  const { PORTAL_USER: user, PORTAL_PASSWORD: password } = process.env;
  if (!user || !password) return undefined;
  const res = await fetch(`${bff}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hcml-csrf': '1' },
    body: JSON.stringify({ username: user, password }),
  });
  if (!res.ok) throw new Error(`sign-in as ${user} was refused: the portal answered ${res.status}.`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function main(): Promise<number> {
  let failed = false;
  let checked = 0;
  let cookie: string | undefined;
  let signedIn = false;

  for (const month of months) {
    const file = join(dir, `Availability_Report_${month}.xlsx`);
    if (!existsSync(file)) {
      console.log(`${month} skipped: no spreadsheet at ${file}`);
      continue;
    }
    const sheets = readSheets(file);
    const overallRow = sheets.get('Overall')?.[0] ?? {};
    const summary = sheets.get('Summary') ?? [];
    const detail = sheets.get('Detail Host') ?? [];
    const events = sheets.get('Event Detail') ?? [];

    if (!signedIn) {
      cookie = await signIn();
      signedIn = true;
    }
    const res = await fetch(`${bff}/api/sli?month=${month}&profile=hcml-report`, { headers: cookie ? { cookie } : {} });
    if (res.status === 401) throw new Error(`${month}: the portal wants a sign-in. Set PORTAL_USER and PORTAL_PASSWORD.`);
    if (!res.ok) throw new Error(`${month}: BFF answered ${res.status} ${await res.text()}`);
    const d = (await res.json()) as SliReport;

    const problems: string[] = [];
    const check = (ok: boolean, msg: string) => {
      if (!ok) problems.push(msg);
    };

    const reportOverall = Number(overallRow['Overall Availability %']);
    check(d.overall.hosts === detail.length, `host count ${d.overall.hosts} vs report ${detail.length}`);
    check(
      d.overall.sli !== null && Math.abs(d.overall.sli - reportOverall) <= 0.005,
      `overall ${d.overall.sli?.toFixed(4)} vs report ${reportOverall.toFixed(4)}`,
    );

    for (const row of summary) {
      const name = row['Template Category'];
      // The Summary sheet repeats the overall figure as a row of its own.
      if (!name || name === overallRow['Overall Name']) continue;
      const ours = d.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const want = Number(row['Average Availability %']);
      check(Boolean(ours), `category ${name} missing`);
      if (!ours) continue;
      check(ours.hosts === Number(row['Total Trigger / Host']), `category ${name}: ${ours.hosts} hosts vs ${row['Total Trigger / Host']}`);
      check(
        ours.sli !== null && Math.abs(ours.sli - want) <= 0.005,
        `category ${name}: ${ours.sli?.toFixed(4)} vs ${want.toFixed(4)}`,
      );
    }

    const byName = new Map(d.hosts.map((h) => [h.name, h]));
    let within60 = 0;
    for (const row of detail) {
      const ours = byName.get(row['Host']);
      if (!ours) {
        problems.push(`host missing from derived report`);
        continue;
      }
      const wantSli = Number(row['Availability %']);
      const wantDown = Number(row['Downtime Seconds']);
      if (Math.abs(ours.downtime - wantDown) <= 60) within60++;
      check(
        ours.sli !== null && Math.abs(ours.sli - wantSli) <= 0.01,
        `a host differs: ${ours.sli?.toFixed(4)} vs ${wantSli.toFixed(4)} (downtime ${ours.downtime} vs ${wantDown} s)`,
      );
    }
    check(within60 >= 0.95 * detail.length, `only ${within60}/${detail.length} hosts within 60 s of downtime`);

    const incidents = d.hosts.reduce((n, h) => n + h.incidents, 0);
    check(Math.abs(incidents - events.length) <= 2, `incidents ${incidents} vs report events ${events.length}`);

    checked++;
    const status = problems.length ? 'FAIL' : 'PASS';
    if (problems.length) failed = true;
    console.log(
      `${month} ${status}: overall ${d.overall.sli?.toFixed(4)} (report ${reportOverall.toFixed(4)}), ` +
        `${d.overall.hosts} hosts, ${within60}/${detail.length} hosts within 60 s, incidents ${incidents}/${events.length}, ` +
        `${d.stats.ms} ms`,
    );
    for (const p of problems.slice(0, 15)) console.log(`   - ${p}`);
    if (problems.length > 15) console.log(`   - …and ${problems.length - 15} more`);
  }

  if (!checked) {
    console.log(`Nothing was checked: no spreadsheet found. Put Availability_Report_<month>.xlsx in ${dir} (REPORT_DIR sets the folder).`);
    return 2;
  }
  return failed ? 1 : 0;
}

try {
  process.exit(await main());
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
