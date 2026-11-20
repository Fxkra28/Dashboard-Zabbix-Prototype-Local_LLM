/**
 * The FOCUS block: for a site the question names, every host of it by state and its worst problems, so that a small model does not call down
 * a host that only has its SNMP silent; for a host it names, that host's open problems and their count.
 */

import { cachedProblems, openProblems, type ZbxProblem } from '../domain/queries.js';
import { sitesView, type Site, type SiteHost } from './sites.js';
import { siteFromHostName, naturalCompare, SITES, type SiteRef } from '../domain/naming.js';
import { siteByHostName, siteOfName } from '../domain/siteOf.js';
import type { HostState } from '../domain/reachability.js';
import { availabilitySince, stateSince } from './assistantFacts.js';
import { downFor, HOST_NAME_MAX, PROBLEM_NAME_MAX, promptText, severityCounts, severityList, sevName, worstFirst } from './assistantLines.js';
import { dataBlock } from './assistantPrompt.js';
import { internetFocusLines, readInternet, type InternetRead } from './assistantInternet.js';
import { buildDetails, type DetailContext } from './assistantDetail.js';
import { aboutAThing, internetAsked, topicsOf } from './assistantTopics.js';
import { linksView } from './links.js';
import { topHostsView } from './topHosts.js';
import { webMonitoringView } from './webMonitoring.js';
import { snapshotTime, snapshotZone } from './assistantSnapshot.js';
import { config } from '../core/config.js';
import type { Meter } from './meters.js';

const FOCUS_BUDGET = 800;

/** What the links of a site may add to its block, beyond the budget of the hosts and problems, which they must not push out. */
const FOCUS_INTERNET_BUDGET = 400;

/** A question naming more sites than this is a comparison; SITES covers it. */
const FOCUS_SITES = 2;

const FOCUS_PROBLEMS = 3;

/** Hosts a question can name and still get a block each. */
const FOCUS_HOSTS = 2;

/** A host name shorter than this is a common word ("HUB", "ha"), not a host named on purpose. */
const HOST_TERM_MIN = 5;

/** Each letter of a pattern as a class of both cases: a site name of three letters is matched in capitals only, so its flag cannot be `i`, and the words beside it are read in any case. */
const anyCase = (source: string): string => source.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

/** Words beside MAC that make it an address and not a site. */
const ADDRESS_WORDS = anyCase('(?:address(?:es)?|addr|adres|alamat|table|tabel)');

/**
 * A site name as a whole word. Names of three letters or fewer count only in
 * capitals, the way the NOC writes site codes: "pas" is everyday Indonesian,
 * and "mac address" is not MOPU / MAC.
 */
function sitePattern(term: string): RegExp {
  const source = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]*');
  const word = `\\b${source}\\b`;
  // "MAC address", "alamat MAC" and "MAC table" are about a network address and not the site MOPU / MAC (BK-87).
  const pattern = term.toUpperCase() === 'MAC' ? `(?<!\\b${ADDRESS_WORDS}\\s)${word}(?!\\s*-?${ADDRESS_WORDS}\\b)` : word;
  return new RegExp(pattern, term.replace(/[^A-Za-z0-9]/g, '').length <= 3 ? '' : 'i');
}

/** Each site with what names it: its aliases and the parts of its display name. */
const SITE_NAMES = SITES.map((site) => {
  const terms = new Map<string, string>();
  for (const raw of [...site.aliases, ...site.name.split(/[/&]/)]) {
    const term = raw.trim();
    if (term && !terms.has(term.toUpperCase())) terms.set(term.toUpperCase(), term);
  }
  return { site: { code: site.code, name: site.name }, patterns: [...terms.values()].map(sitePattern) };
});

/** The sites a message names, in the order it names them. */
export function sitesNamed(text: string): SiteRef[] {
  return SITE_NAMES.map(({ site, patterns }) => ({
    site,
    at: Math.min(...patterns.map((re) => text.search(re)).map((i) => (i < 0 ? Infinity : i))),
  }))
    .filter((m) => m.at < Infinity)
    .sort((a, b) => a.at - b.at)
    .map((m) => m.site);
}

/** Names up to about `chars`, then how many more; never fewer than one. */
function nameList(names: string[], chars: number): string {
  let out = '';
  let shown = 0;
  for (const name of names) {
    const next = shown ? `${out}, ${name}` : name;
    if (shown && next.length > chars) break;
    out = next;
    shown++;
  }
  return shown < names.length ? `${out} +${names.length - shown} more` : out;
}

/** What is silent on a host that answers ping (`degraded`), by reason. */
const SILENT: Partial<Record<SiteHost['reason'], string>> = {
  'snmp-silent': 'SNMP silent',
  'agent-silent': 'agent silent',
  interface: 'an interface unavailable',
};

/**
 * FOCUS: a site the question names, host by host. With the snapshot alone, qwen3:8b answered "Ya" 6
 * times out of 6 to "Ada yang down di MOPU?", calling down a FortiGate that answered ping with only
 * its SNMP silent. So every host of the site is listed under its state, then the site's worst open
 * problems, in ~800 characters, lowest priority last.
 *
 * The wording is measured: "none, no host at this site is down", and a duration tied to the silence
 * ("SNMP silent for 2d"), not to the host. With it, none of 25 answers about MOPU, FPSO and MBH, in
 * both languages, called the wrong host down.
 */
export function focusBlock(site: SiteRef, sites: Site[], problems: ZbxProblem[], now: number, internet: string[] = [], problemLines = true): string {
  const hosts = sites.flatMap((s) => (siteOfName(s.name)?.code === site.code ? s.hosts : []));
  const since = availabilitySince(problems);
  const inState = (state: HostState) =>
    hosts.filter((h) => h.state === state).sort((a, b) => naturalCompare(a.name, b.name));
  const hostName = (h: SiteHost) => promptText(h.name, HOST_NAME_MAX);
  const withSince = (h: SiteHost) => {
    const clock = stateSince(h, since);
    const age = clock === undefined ? '' : `for ${downFor(clock, now)}`;
    if (h.state !== 'degraded') return age ? `${hostName(h)} (${age})` : hostName(h);
    return `${hostName(h)} (${[SILENT[h.reason] ?? 'monitoring silent', age].filter(Boolean).join(' ')})`;
  };

  const ids = new Set(hosts.map((h) => h.hostid));
  const open = problems.filter((p) => p.hostid && ids.has(p.hostid)).sort(worstFirst);
  // Shorter than the snapshot's problem lines, no opdata, whole days, so
  // every state still fits beside them.
  const problem = (p: ZbxProblem) =>
    `- [${sevName(p.severity)}] ${promptText(p.host, HOST_NAME_MAX) || 'unknown host'}: ` +
    `${promptText(p.name, PROBLEM_NAME_MAX)}; ` +
    `open ${downFor(Number(p.clock), now)}, ${p.acknowledged === '1' ? 'acked' : 'not acked'}`;
  const down = inState('down');
  const degraded = inState('degraded');
  const snmpOnly = degraded.every((h) => h.reason === 'snmp-silent');
  const lines = [
    `Down (${down.length}): ${down.length ? nameList(down.map(withSince), 200) : 'none, no host at this site is down'}`,
    ...(degraded.length
      ? [
          `Not down: answers ping, only its ${snmpOnly ? 'SNMP' : 'SNMP or agent'} monitoring is silent ` +
            `(${degraded.length}): ${nameList(degraded.map(withSince), 200)}`,
        ]
      : []),
    // Sites, Hosts and Devices show counts of problems and not their names, severities and ages: those lines are for the pages that show them (SC-65).
    `Open problems here: ${open.length}${open.length && problemLines ? ', worst first:' : ''}`,
    ...(problemLines ? open.slice(0, FOCUS_PROBLEMS).map(problem) : []),
    ...(
      [
        ['nodata', 'No data'],
        ['up', 'Up'],
        ['disabled', 'Disabled'],
      ] as const
    ).flatMap(([state, label]) => {
      const list = inState(state);
      return list.length ? [`${label} (${list.length}): ${nameList(list.map(hostName), 100)}`] : [];
    }),
  ];

  let text = `FOCUS: ${site.name} (${hosts.length} host${hosts.length === 1 ? '' : 's'})`;
  for (const line of lines) {
    if (text.length + 1 + line.length <= FOCUS_BUDGET) text += `\n${line}`;
  }
  // The links come last, with a budget of their own, so that they never take the room of a host or a problem.
  for (const line of internet) {
    if (text.length + 1 + line.length <= FOCUS_BUDGET + FOCUS_INTERNET_BUDGET) text += `\n${line}`;
  }
  return text;
}

/** Whether a gauge belongs to the site: by the site its host is in (`siteOf`, the name alone when none is given), and for a gauge whose item is gone, by the site its title names. */
function meterAtSite(m: Meter, site: SiteRef, siteOf: (hostName: string) => SiteRef | null): boolean {
  if (m.host) return siteOf(m.host)?.code === site.code;
  return sitesNamed(m.title).some((s) => s.code === site.code);
}

/** The internet links of a site as FOCUS lines, from a read of the gauges; nothing when they were not read, so that no link is called missing for want of a read. */
export function siteInternetLines(site: SiteRef, read: InternetRead | null, now: number, siteOf: (hostName: string) => SiteRef | null = siteFromHostName): string[] {
  if (!read || read.status === 'pending') return [];
  return internetFocusLines(read.status === 'ok' ? read.meters.filter((m) => meterAtSite(m, site, siteOf)) : [], now, read.status === 'ok');
}

/** A host's name as a whole term: its full name, and the name without its numbering ("BRAVOSW01" for "1.2.2. BRAVOSW01"). */
function hostTerms(name: string): RegExp[] {
  const bare = name.replace(/^[\d.\s]+/, '').trim();
  return [...new Set([name.trim(), bare])]
    .filter((term) => term.replace(/[^A-Za-z0-9]/g, '').length >= HOST_TERM_MIN)
    .map((term) => new RegExp(`(^|[^A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i'));
}

/** The hosts a message names, in the order it names them; of two that start at one place, the longer name. */
export function hostsNamed(text: string, hosts: SiteHost[]): SiteHost[] {
  return hosts
    .map((host) => ({ host, at: Math.min(...hostTerms(host.name).map((re) => text.search(re)).map((i) => (i < 0 ? Infinity : i))) }))
    .filter((m) => m.at < Infinity)
    .sort((a, b) => a.at - b.at || b.host.name.length - a.host.name.length)
    .map((m) => m.host);
}

const STATE_WORDS: Record<HostState, string> = {
  up: 'reachable',
  down: 'unreachable',
  degraded: 'answers ping, but its monitoring is partly silent',
  nodata: 'no availability data',
  disabled: 'disabled in Zabbix',
};

/** FOCUS for one host: its state, how many problems it has open by severity, and the worst of them, for a user whose pages show them. */
export function hostFocusBlock(host: SiteHost, problems: ZbxProblem[], now: number, problemLines = true): string {
  const open = problems.filter((p) => p.hostid === host.hostid).sort(worstFirst);
  const clock = stateSince(host, availabilitySince(problems));
  const state = `${STATE_WORDS[host.state]}${clock === undefined ? '' : ` for ${downFor(clock, now)}`}`;
  const lines = [
    `Open problems on this host: ${open.length}${open.length ? ` (${severityList(severityCounts(open), true)})${problemLines ? ', worst first:' : ''}` : ', none'}`,
    ...(problemLines ? open : []).slice(0, FOCUS_PROBLEMS).map(
      (p) => `- [${sevName(p.severity)}] ${promptText(p.name, PROBLEM_NAME_MAX)}; open ${downFor(Number(p.clock), now)}, ${p.acknowledged === '1' ? 'acked' : 'not acked'}`,
    ),
  ];
  let text = `FOCUS: host ${promptText(host.name, HOST_NAME_MAX)} (${state})`;
  for (const line of lines) {
    if (text.length + 1 + line.length <= FOCUS_BUDGET) text += `\n${line}`;
  }
  return text;
}

/** How long a question waits for a cold read of a slow view: HCML's Zabbix takes 15 to 45 seconds for the gauges and for the list of busiest hosts. */
const COLD_READ_WAIT_MS = 50_000;

/** Resolves when the read ends, however it ends, or after `ms`, whichever is first; the read itself carries on in the cache. */
function upTo(ms: number, read: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const end = () => {
      clearTimeout(timer);
      resolve();
    };
    read.then(end, end);
  });
}

/**
 * Waits, before the snapshot is built, for the slow views that a question needs and that the portal keeps for only ten minutes after the last request to them: the internet gauges, the WAN links, the web
 * checks, and the list of busiest hosts (for the CPU or memory of a site or of nothing in particular). Without it the first question after a quiet spell is answered as if the data were not there.
 * Never throws, and never waits longer than `COLD_READ_WAIT_MS`.
 */
export async function warmFor(question: string, modules: ReadonlySet<string> | null): Promise<void> {
  const can = (...ids: string[]) => modules === null || ids.some((id) => modules.has(id));
  const waits: Promise<unknown>[] = [];
  const topics = topicsOf(question);
  if (internetAsked(question) && can('network')) waits.push(upTo(COLD_READ_WAIT_MS, readInternet(COLD_READ_WAIT_MS)));
  if (topics.links && can('links')) waits.push(upTo(COLD_READ_WAIT_MS, linksView()));
  if (topics.web && can('dashboard', 'hosts', 'sla')) waits.push(upTo(COLD_READ_WAIT_MS, webMonitoringView()));
  if (topics.metrics.some((m) => m === 'cpu' || m === 'memory') && can('latest')) {
    // A named host is read by its own items and needs no list.
    const named = await sitesView().then((v) => hostsNamed(question, v.sites.flatMap((s) => s.hosts)).length > 0).catch(() => false);
    if (!named) waits.push(upTo(COLD_READ_WAIT_MS, topHostsView(Number.POSITIVE_INFINITY)));
  }
  await Promise.all(waits);
}

/**
 * What a question gets beyond the snapshot, for the pages the user holds (`modules`, null for an administrator and for a portal with sign-in off): a FOCUS block for each site and host it names, the
 * internet links of those sites, and the detail of `assistantDetail.ts` (past problems, latest values, a host's details and contacts). Null when there is none, and the answer uses the snapshot alone.
 */
export async function buildFocus(
  question: string,
  modules: ReadonlySet<string> | null,
  { operator = modules === null, previous, signal, places }: { operator?: boolean; previous?: string; signal?: AbortSignal; places?: DetailContext['places'] } = {},
): Promise<{ sites: string[]; hosts: string[]; topics: string[]; text: string; notGiven: string | null } | null> {
  const can = (...ids: string[]) => modules === null || ids.some((id) => modules.has(id));
  const focusAllowed = can('sites', 'hosts', 'devices');
  // The names, severities and ages of the problems are for the pages that show them, Problems and the Dashboard (SC-65).
  const problemLines = can('problems', 'dashboard');
  const [problems, sitesRes] = await Promise.all([
    cachedProblems().then(openProblems),
    sitesView(),
  ]);
  const everyHost = sitesRes.sites.flatMap((s) => s.hosts);
  let named = sitesNamed(question).slice(0, FOCUS_SITES);
  let hosts = hostsNamed(question, everyHost).slice(0, FOCUS_HOSTS);
  // A follow-up that names no host and no site is about the one before it: "dan CPU-nya?" after "Ada yang down di MOPU?" (BK-90).
  if (!named.length && !hosts.length && previous && aboutAThing(topicsOf(question))) {
    named = sitesNamed(previous).slice(0, FOCUS_SITES);
    hosts = hostsNamed(previous, everyHost).slice(0, FOCUS_HOSTS);
  }
  const now = Math.floor(Date.now() / 1000);
  // The links of a site, for a user whose pages show them: read once, from the cache the Internet view uses.
  const links = focusAllowed && can('network') && named.length ? await readInternet() : null;
  const blocks = focusAllowed
    ? [
        ...named.map((s) => focusBlock(s, sitesRes.sites, problems, now, siteInternetLines(s, links, now, siteByHostName(sitesRes.sites)), problemLines)),
        ...hosts.map((h) => hostFocusBlock(h, problems, now, problemLines)),
      ]
    : [];
  const detail = await buildDetails({ question, now, tz: snapshotZone(), readAt: snapshotTime(now), sites: named, hosts, allSites: sitesRes.sites, problems, admin: modules === null, operator, can, external: config.ai.external, signal, places });
  blocks.push(...detail.blocks);
  if (!blocks.length && !detail.notGiven) return null;
  return {
    sites: focusAllowed ? named.map((s) => s.name) : [],
    hosts: focusAllowed ? hosts.map((h) => h.name) : [],
    topics: detail.topics,
    // The data, fenced; the line about what was not given is not data and goes beside it (BK-84).
    text: blocks.length ? dataBlock('FOCUS', blocks.join('\n\n')) : '',
    notGiven: detail.notGiven,
  };
}
