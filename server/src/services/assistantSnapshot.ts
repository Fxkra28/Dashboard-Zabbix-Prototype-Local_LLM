/**
 * The snapshot of the estate the model answers from: built as compact plain text within a character budget, and reused while nothing it
 * describes has changed, so the model's prompt cache covers it.
 */

import { createHash } from 'node:crypto';
import { config } from '../core/config.js';
import { cached, invalidate } from '../core/cache.js';
import { cachedProblems, openProblems, withOpdata, type ZbxProblem } from '../domain/queries.js';
import { sitesView, type Site } from './sites.js';
import { slasView, sliView, type SlaSli, type ZbxSla } from './sla.js';
import { serviceTreeView, type ServiceNode } from './services.js';
import { siteFromHostName, naturalCompare } from '../domain/naming.js';
import { derivedServiceLines, derivedSlaLines } from '../sli/summary.js';
import { percentText } from '../export/slaReport.js';
import { availabilitySince, stateCounts, stateSince, wholeListLines } from './assistantFacts.js';
import { downFor, HOST_NAME_MAX, PROBLEM_NAME_MAX, problemLine, promptText, section, severityCounts, severityList, sevName, worstFirst } from './assistantLines.js';

/** What the model was shown, surfaced to the UI so the reader knows the scope. */
export interface SnapshotMeta {
  generatedAt: number;
  hosts: number;
  sites: number;
  problems: number;
  unacknowledged: number;
  slas: number;
  degradedServices: number;
  /** Some list was cut to fit the model's context window. */
  truncated: boolean;
}

export interface Snapshot {
  text: string;
  meta: SnapshotMeta;
  /** Characters per section, for logging only. */
  sizes: Record<string, number>;
  /** What the text was built from. See `snapshotFingerprint`. */
  fingerprint: string;
  /** False when a derived SLA or services summary was still computing. */
  complete: boolean;
}

/**
 * Budgets. A prompt that overflows the model's context window is cut from the front, which silently
 * drops the system prompt and its rules. Native Ollama gets AI_NUM_CTX (8192 tokens); through `/v1`
 * Ollama's default of 4096 applies and a full prompt nearly fills it. So the snapshot is capped in
 * characters (~4 per token) rather than trusted to fit.
 *
 * The cap is met by construction: every section has its own budget and adds whole lines until it is
 * spent, so the facts a question most often needs (estate, sites, what is new, what is down) cannot
 * be pushed out by a long problem list.
 */
export const SNAPSHOT_CHAR_CAP = 5_500;

const BUDGET = {
  estate: 350,
  whole: 650,
  sites: 900,
  recent: 550,
  unreachable: 850,
  sla: 700,
  services: 400,
  problems: 1_850,
};

const RECENT_CAP = 8;

const PROBLEM_CAP = 20;

const HOSTS_PER_SITE_LINE = 4;

/** How long the snapshot waits for the derived SLA / service summaries. */
const DERIVED_WAIT_MS = 1_500;

const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;

function siteLine(s: Site): string {
  const c = stateCounts(s.hosts);
  const bits = [`${s.total} host${s.total === 1 ? '' : 's'}`];
  if (c.down) bits.push(`${c.down} unreachable`);
  if (c.degraded) bits.push(`${c.degraded} SNMP silent (no ping alarm)`);
  if (c.nodata) bits.push(`${c.nodata} no data`);
  bits.push(`${s.problems} problems`);
  const high = (s.bySeverity['5'] ?? 0) + (s.bySeverity['4'] ?? 0);
  if (high) bits.push(`${high} High/Disaster`);
  bits.push(`worst ${s.worst >= 0 ? sevName(s.worst) : 'none'}`);
  return `- ${promptText(s.name, HOST_NAME_MAX)}: ${bits.join(', ')}`;
}

function slaLines(sla: ZbxSla, rows: SlaSli[]): string[] {
  const target = Number(sla.slo);
  const slaName = promptText(sla.name, PROBLEM_NAME_MAX);
  if (!rows.length) return [`- ${slaName} (target ${sla.slo}%): no services attached`];
  return rows.map((r) => {
    const met = r.sli >= target;
    return (
      `- ${slaName} (target ${sla.slo}%): ${promptText(r.name, PROBLEM_NAME_MAX)} ${percentText(r.sli, target)}, ` +
      `${met ? 'on target' : 'MISSED'}, ` +
      `error budget ${r.error_budget < 0 ? 'exceeded by ' : 'left '}${minutes(Math.abs(r.error_budget))}`
    );
  });
}

/**
 * Every service once. Zabbix services form a DAG, not a tree (§15): a shared
 * core sits under two parents, so a naive walk lists it, and counts it, twice.
 */
function flatten(nodes: ServiceNode[], seen = new Map<string, ServiceNode>()): ServiceNode[] {
  for (const n of nodes) {
    if (seen.has(n.serviceid)) continue;
    seen.set(n.serviceid, n);
    flatten(n.children, seen);
  }
  return [...seen.values()];
}

/** The derived summaries may still be computing; never hold the answer for them. */
async function withinDeadline(fn: () => Promise<string[]>, ms = DERIVED_WAIT_MS): Promise<string[] | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([fn().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_ZONE = 'Asia/Jakarta';

/** The SLA zone the snapshot clock shows; a name Intl rejects must not take the Assistant down. */
function snapshotZone(): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: config.sla.timezone });
    return config.sla.timezone;
  } catch {
    return DEFAULT_ZONE;
  }
}

/** "14 Jun 2024" in the SLA zone. */
function snapshotDay(clock: number): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: snapshotZone(), day: 'numeric', month: 'short', year: 'numeric' }).format(clock * 1000);
}

/** "Wed, 7 Oct 2026, 15:00 WIB (Asia/Jakarta)": the Indonesian locale names WIB, WITA and WIT, other zones get e.g. "GMT+1". */
export function snapshotClock(at: Date): string {
  const timeZone = snapshotZone();
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  const short = new Intl.DateTimeFormat('en-ID', { timeZone, timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  return short && short !== timeZone ? `${clock} ${short} (${timeZone})` : `${clock} (${timeZone})`;
}

/**
 * The estate as compact plain text. Plain text rather than JSON on purpose:
 * it is roughly half the tokens for the same facts, and a small model reads
 * "3 hosts, 1 unreachable" more reliably than nested braces.
 *
 * Built fresh on every call; the assistant answers from `getSnapshot`, which
 * reuses one.
 */
export async function buildSnapshot(): Promise<Snapshot> {
  const now = Math.floor(Date.now() / 1000);

  // Started first so their deadline runs alongside the core queries.
  const derivedSla = withinDeadline(derivedSlaLines);
  const derivedSvc = withinDeadline(derivedServiceLines);

  // Problems and sites are the core of any answer; SLA and services are
  // valuable but optional: a Zabbix without Services configured must not
  // leave the assistant unable to say what is down.
  const [problems, sitesRes] = await Promise.all([
    cachedProblems().then(openProblems),
    sitesView(),
  ]);
  // The list carries no operational data (queries.ts), so it is read for the problems listed below only.
  const recentTop = problems
    .filter((p) => now - Number(p.clock) <= 86_400)
    .sort((a, b) => Number(b.clock) - Number(a.clock))
    .slice(0, RECENT_CAP);
  const worstTop = [...problems].sort(worstFirst).slice(0, PROBLEM_CAP);
  const shown = [...new Map([...recentTop, ...worstTop].map((p) => [p.eventid, p])).values()];
  const [slaRes, svcRes, withData] = await Promise.allSettled([
    slasView(),
    serviceTreeView(),
    withOpdata(shown),
  ]);
  const opdataOf = new Map((withData.status === 'fulfilled' ? withData.value : []).map((p) => [p.eventid, p.opdata]));
  const line = (p: ZbxProblem) => problemLine({ ...p, opdata: opdataOf.get(p.eventid) }, now);

  const sections: Record<string, { text: string; truncated: boolean }> = {};
  const since = availabilitySince(problems);

  /* 1. header + estate */
  // Host states come from reachability.ts: "down" means ping fails (or, with
  // no recent ping, the interface is unavailable); "degraded" answers ping
  // while SNMP or the agent is silent, and is not down.
  const hosts = sitesRes.sites.reduce((n, s) => n + s.total, 0);
  const all = stateCounts(sitesRes.sites.flatMap((s) => s.hosts));
  const unacknowledged = problems.filter((p) => p.acknowledged !== '1').length;
  sections.estate = section(
    `SNAPSHOT taken ${snapshotClock(new Date(now * 1000))}`,
    [
      `ESTATE: ${hosts} hosts at ${sitesRes.sites.length} sites; ${all.up} reachable, ` +
        `${all.down} unreachable${all.degraded ? `, ${all.degraded} SNMP silent without a ping alarm` : ''}, ` +
        `${all.nodata} with no availability data${all.disabled ? `, ${all.disabled} disabled` : ''}.`,
      `Open problems: ${problems.length} (${severityList(severityCounts(problems))}); ` +
        `${unacknowledged} not acknowledged.`,
    ],
    BUDGET.estate,
  );

  /* 1b. counted over every open problem, which the list in section 7 is not */
  sections.whole = section(
    `ALL ${problems.length} OPEN PROBLEMS, COUNTED:`,
    wholeListLines(problems, sitesRes.sites.flatMap((s) => s.hosts), snapshotDay),
    BUDGET.whole,
  );

  /* 5 + 6. SLA and services: Zabbix's own when it has services, else derived */
  let slaCount = 0;
  let degradedCount = 0;
  let complete = true;
  const realServices = svcRes.status === 'fulfilled' && flatten(svcRes.value.tree).length > 0;
  const slaOut: string[] = [];
  const svcOut: string[] = [];

  if (slaRes.status === 'fulfilled') slaCount = slaRes.value.filter((s) => s.status !== '0').length;

  if (realServices && svcRes.status === 'fulfilled') {
    if (slaRes.status !== 'fulfilled') {
      slaOut.push('- Zabbix SLA data unavailable right now');
    } else {
      const enabled = slaRes.value.filter((s) => s.status !== '0');
      const slis = await Promise.all(
        enabled.map((s) => sliView(s.slaid).catch(() => [])),
      );
      if (!enabled.length) slaOut.push('- no SLAs defined in Zabbix');
      enabled.forEach((s, i) => slaOut.push(...slaLines(s, slis[i])));
    }
    const degraded = flatten(svcRes.value.tree).filter((n) => n.status >= 0);
    degradedCount = degraded.length;
    if (!degraded.length) svcOut.push('- none, all services OK');
    for (const n of degraded) {
      const causes = n.problems.map((p) => promptText(p.name, PROBLEM_NAME_MAX)).slice(0, 3).join('; ');
      svcOut.push(`- ${promptText(n.name, PROBLEM_NAME_MAX)}: ${sevName(n.status)}${causes ? `, caused by: ${causes}` : ''}`);
    }
  } else {
    const note =
      svcRes.status === 'fulfilled'
        ? 'Zabbix has no services configured, so figures below are derived by the portal.'
        : 'Zabbix service data unavailable right now; figures below are derived by the portal.';
    const [rawSla, rawSvc] = await Promise.all([derivedSla, derivedSvc]);
    // Their names come from Zabbix too (sli/summary.ts hands them over as they are).
    const slaLinesDerived = rawSla?.map((l) => promptText(l)) ?? null;
    const svcLinesDerived = rawSvc?.map((l) => promptText(l)) ?? null;
    if (slaLinesDerived?.length) slaOut.push(...slaLinesDerived);
    else slaOut.push(`- ${note}`, '- derived SLA not available yet (still computing)');
    // `null` is a summary that missed its deadline or failed; an empty list
    // is one that finished and found nothing degraded.
    if (svcLinesDerived === null) svcOut.push('- derived services not available yet (still computing)');
    else if (!svcLinesDerived.length) svcOut.push('- none, all services OK');
    else svcOut.push(...svcLinesDerived);
    complete = Boolean(slaLinesDerived?.length) && svcLinesDerived !== null;
  }
  sections.sla = section('SLA:', slaOut, BUDGET.sla);
  sections.services = section('DEGRADED SERVICES:', svcOut, BUDGET.services);

  // SLA and services are often a line or two; what they leave unused goes to
  // the site and unreachable lists, which are what most questions are about.
  let slack =
    BUDGET.sla - sections.sla.text.length + (BUDGET.services - sections.services.text.length);
  const siteExtra = Math.min(slack, 500);
  slack -= siteExtra;
  const unreachableExtra = Math.min(slack, 400);


  /* 2. sites, worst first (getSites' order) */
  // A small model reads "worst first" as "most problems", so the two rankings people ask for come
  // first, stated outright, where trimming cannot reach them.
  const top = (count: (s: Site) => number) =>
    sitesRes.sites
      .filter((s) => count(s) > 0)
      .sort((a, b) => count(b) - count(a))
      .slice(0, 3)
      .map((s) => `${promptText(s.name, HOST_NAME_MAX)} ${count(s)}`)
      .join(', ');
  const byProblems = top((s) => s.problems);
  const byDown = top((s) => stateCounts(s.hosts).down);
  sections.sites = section(
    `SITES (${sitesRes.sites.length}, worst first: highest open severity, then most hosts down):`,
    [
      ...(byProblems ? [`- Most open problems: ${byProblems}`] : []),
      ...(byDown ? [`- Most unreachable hosts: ${byDown}`] : []),
      ...(sitesRes.sites.length ? sitesRes.sites.map(siteLine) : ['- none']),
    ],
    BUDGET.sites + siteExtra,
    (left) => `- …and ${left} more sites`,
  );

  /* 3. new in the last 24 h, newest first */
  const recent = problems
    .filter((p) => now - Number(p.clock) <= 86_400)
    .sort((a, b) => Number(b.clock) - Number(a.clock));
  const recentShown = recent.slice(0, RECENT_CAP).map(line);
  sections.recent = section(
    `NEW IN LAST 24 H: ${recent.length} problems opened` +
      (recent.length ? ` (${severityList(severityCounts(recent), true)}), newest first:` : '.'),
    recentShown,
    BUDGET.recent,
    (left) => `- …and ${left} older ones from the last 24 h`,
    recent.length,
  );

  /* 4. unreachable hosts, grouped by the site their name says */
  const bySite = new Map<string, string[]>();
  const silent: string[] = [];
  for (const s of sitesRes.sites) {
    for (const h of s.hosts) {
      if (h.state !== 'down' && h.state !== 'degraded') continue;
      const clock = stateSince(h, since);
      const hostName = promptText(h.name, HOST_NAME_MAX);
      const label = clock === undefined ? hostName : `${hostName} (${downFor(clock, now)})`;
      // Answers ping, so not "down": the model otherwise reports these as outages.
      if (h.state === 'degraded') {
        silent.push(label);
        continue;
      }
      const name = promptText(siteFromHostName(h.name)?.name ?? s.name, HOST_NAME_MAX);
      const list = bySite.get(name) ?? [];
      list.push(label);
      bySite.set(name, list);
    }
  }
  const unreachableLines = [...bySite.entries()]
    .sort((a, b) => b[1].length - a[1].length || naturalCompare(a[0], b[0]))
    .map(([name, list]) => {
      const sorted = [...list].sort(naturalCompare);
      const shown = sorted.slice(0, HOSTS_PER_SITE_LINE).join(', ');
      const extra = sorted.length > HOSTS_PER_SITE_LINE ? ` +${sorted.length - HOSTS_PER_SITE_LINE} more` : '';
      return `- ${name} (${sorted.length}): ${shown}${extra}`;
    });
  if (silent.length) {
    unreachableLines.push(`- Not down, SNMP silent, no ping alarm (${silent.length}): ${silent.sort(naturalCompare).join(', ')}`);
  }
  sections.unreachable = section(
    `UNREACHABLE HOSTS (${all.down}, by site; how long down in brackets):`,
    unreachableLines.length ? unreachableLines : ['- none'],
    BUDGET.unreachable + unreachableExtra,
    (left) => `- …and ${left} more sites with unreachable hosts`,
  );

  /* 7. open problems, worst first then newest, with whatever budget is left */
  const ordered = [...problems].sort(worstFirst);
  const used = Object.values(sections).reduce((n, s) => n + s.text.length + 2, 0);
  const problemBudget = Math.min(BUDGET.problems, SNAPSHOT_CHAR_CAP - used);
  const listed = ordered.slice(0, PROBLEM_CAP).map(line);
  const restCounts = (shown: number) => severityList(severityCounts(ordered.slice(shown)), true);
  // The title says how many are listed, or a model takes the list for all of them.
  const problemSection = (lines: string[], shown: number) =>
    section(
      ordered.length <= shown
        ? `OPEN PROBLEMS (${ordered.length}, worst first):`
        : shown
          ? `OPEN PROBLEMS (${ordered.length}, worst first; only the worst ${shown} are listed):`
          : `OPEN PROBLEMS (${ordered.length}; none listed, no room left):`,
      ordered.length ? lines : ['- none'],
      problemBudget,
      // Counts of the unlisted ones only, or a model takes them for the totals.
      (left, shown) => `- …and ${left} more not listed (of those: ${restCounts(shown)})`,
      Math.max(ordered.length, 1),
    );
  const fitted = (problemSection(listed, listed.length).text.match(/^- \[/gm) ?? []).length;
  sections.problems = problemSection(listed.slice(0, fitted), fitted);

  const order = ['estate', 'whole', 'sites', 'recent', 'unreachable', 'sla', 'services', 'problems'];
  const text = order.map((k) => sections[k].text).join('\n\n');
  const truncated = Object.values(sections).some((s) => s.truncated);
  const sizes = Object.fromEntries(order.map((k) => [k, sections[k].text.length]));

  return {
    text,
    sizes: { ...sizes, total: text.length },
    meta: {
      generatedAt: now * 1000,
      hosts,
      sites: sitesRes.sites.length,
      problems: problems.length,
      unacknowledged,
      slas: slaCount,
      degradedServices: degradedCount,
      truncated,
    },
    fingerprint: snapshotFingerprint(problems, sitesRes.sites),
    complete,
  };
}

export const SNAPSHOT_KEY = 'chat:snapshot';

/** The longest one snapshot is reused while nothing it describes changes. */
const SNAPSHOT_FREEZE_MS = 5 * 60_000;

/**
 * How long a snapshot is kept when only host states changed. FPSO's radio
 * links flip between up and down every ~16 s; rebuilding, and re-reading
 * ~2,400 tokens, on each flip would undo the freeze exactly when the estate
 * is busiest. Problems changing still rebuild at once.
 */
const HOST_STATE_SETTLE_MS = 60_000;

/**
 * What must not change under a frozen snapshot: each open problem's id,
 * severity and acknowledgement (before the dot), and each host's state (after
 * it). The rest of the text, ages, opdata, SLA figures, may lag by up to
 * five minutes.
 */
export function snapshotFingerprint(problems: ZbxProblem[], sites: Site[]): string {
  const problemHash = createHash('sha1');
  for (const p of problems) problemHash.update(`${p.eventid}:${p.severity}:${p.acknowledged}\n`);
  const hostHash = createHash('sha1');
  for (const s of sites) {
    for (const h of s.hosts) hostHash.update(`${h.hostid}:${h.state}\n`);
  }
  return `${problemHash.digest('hex')}.${hostHash.digest('hex')}`;
}

/** Thrown through `cached`, so a snapshot still missing its SLA is answered from once and never stored. */
class IncompleteSnapshot extends Error {
  constructor(readonly snapshot: Snapshot) {
    super('snapshot still computing');
  }
}

/**
 * The snapshot to answer from, reused for up to five minutes. A local model reads every token it
 * has not seen at ~330 tokens/s, and a snapshot rebuilt per question differed in its first line
 * (the time it was taken), so each question re-read ~2,000 tokens: 6 to 8 s before the first word.
 * Reused, the system text is byte-identical and Ollama serves it from its prompt cache.
 *
 * Not stale where it matters: a problem opening, closing, being acknowledged or re-graded rebuilds
 * it at once; a host changing state rebuilds it once it is a minute old (`snapshotFingerprint`,
 * `HOST_STATE_SETTLE_MS`); one built while the derived SLA or services were still computing is
 * never kept; a write-back invalidates `chat:snapshot`.
 */
export async function getSnapshot(): Promise<Snapshot & { frozen: boolean }> {
  const [problems, sitesRes] = await Promise.all([
    cachedProblems().then(openProblems),
    sitesView(),
  ]);
  const fingerprint = snapshotFingerprint(problems, sitesRes.sites);
  let built = false;
  const build = async () => {
    built = true;
    const snapshot = await buildSnapshot();
    if (!snapshot.complete) throw new IncompleteSnapshot(snapshot);
    return snapshot;
  };
  try {
    let snapshot = await cached(SNAPSHOT_KEY, SNAPSHOT_FREEZE_MS, build);
    if (!built && snapshot.fingerprint !== fingerprint) {
      const problemsChanged = snapshot.fingerprint.split('.')[0] !== fingerprint.split('.')[0];
      const settled = Date.now() - snapshot.meta.generatedAt >= HOST_STATE_SETTLE_MS;
      if (problemsChanged || settled) {
        invalidate(SNAPSHOT_KEY);
        snapshot = await cached(SNAPSHOT_KEY, SNAPSHOT_FREEZE_MS, build);
      }
    }
    return { ...snapshot, frozen: !built };
  } catch (err) {
    if (err instanceof IncompleteSnapshot) return { ...err.snapshot, frozen: false };
    throw err;
  }
}
