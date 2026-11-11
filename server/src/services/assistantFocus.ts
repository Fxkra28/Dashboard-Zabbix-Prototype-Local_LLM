/**
 * The FOCUS block: for a site the question names, every host of it by state and its worst problems, so that a small model does not call down
 * a host that only has its SNMP silent; for a host it names, that host's open problems and their count.
 */

import { cachedProblems, openProblems, type ZbxProblem } from '../domain/queries.js';
import { sitesView, type Site, type SiteHost } from './sites.js';
import { siteFromHostName, naturalCompare, SITES, type SiteRef } from '../domain/naming.js';
import type { HostState } from '../domain/reachability.js';
import { availabilitySince, stateSince } from './assistantFacts.js';
import { downFor, HOST_NAME_MAX, PROBLEM_NAME_MAX, promptText, severityCounts, severityList, sevName, worstFirst } from './assistantLines.js';
import { dataBlock } from './assistantPrompt.js';

const FOCUS_BUDGET = 800;

/** A question naming more sites than this is a comparison; SITES covers it. */
const FOCUS_SITES = 2;

const FOCUS_PROBLEMS = 3;

/** Hosts a question can name and still get a block each. */
const FOCUS_HOSTS = 2;

/** A host name shorter than this is a common word ("HUB", "ha"), not a host named on purpose. */
const HOST_TERM_MIN = 5;

/**
 * A site name as a whole word. Names of three letters or fewer count only in
 * capitals, the way the NOC writes site codes: "pas" is everyday Indonesian,
 * and "mac address" is not MOPU / MAC.
 */
function sitePattern(term: string): RegExp {
  const source = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]*');
  return new RegExp(`\\b${source}\\b`, term.replace(/[^A-Za-z0-9]/g, '').length <= 3 ? '' : 'i');
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
export function focusBlock(site: SiteRef, sites: Site[], problems: ZbxProblem[], now: number): string {
  const hosts = sites.flatMap((s) =>
    s.hosts.filter((h) => s.name === site.name || siteFromHostName(h.name)?.code === site.code),
  );
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
    `Open problems here: ${open.length}${open.length ? ', worst first:' : ''}`,
    ...open.slice(0, FOCUS_PROBLEMS).map(problem),
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
  return text;
}

/** A host's name as a whole term: its full name, and the name without its numbering ("IDXSVFSW01" for "1.2.2. IDXSVFSW01"). */
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

/** FOCUS for one host: its state, how many problems it has open by severity, and the worst of them. */
export function hostFocusBlock(host: SiteHost, problems: ZbxProblem[], now: number): string {
  const open = problems.filter((p) => p.hostid === host.hostid).sort(worstFirst);
  const clock = stateSince(host, availabilitySince(problems));
  const state = `${STATE_WORDS[host.state]}${clock === undefined ? '' : ` for ${downFor(clock, now)}`}`;
  const lines = [
    `Open problems on this host: ${open.length}${open.length ? ` (${severityList(severityCounts(open), true)}), worst first:` : ', none'}`,
    ...open.slice(0, FOCUS_PROBLEMS).map(
      (p) => `- [${sevName(p.severity)}] ${promptText(p.name, PROBLEM_NAME_MAX)}; open ${downFor(Number(p.clock), now)}, ${p.acknowledged === '1' ? 'acked' : 'not acked'}`,
    ),
  ];
  let text = `FOCUS: host ${promptText(host.name, HOST_NAME_MAX)} (${state})`;
  for (const line of lines) {
    if (text.length + 1 + line.length <= FOCUS_BUDGET) text += `\n${line}`;
  }
  return text;
}

/**
 * FOCUS blocks for the sites and hosts a question names, from the snapshot's own cached
 * data; `null` when it names none.
 */
export async function buildFocus(question: string): Promise<{ sites: string[]; hosts: string[]; text: string } | null> {
  const named = sitesNamed(question).slice(0, FOCUS_SITES);
  const [problems, sitesRes] = await Promise.all([
    cachedProblems().then(openProblems),
    sitesView(),
  ]);
  const hosts = hostsNamed(question, sitesRes.sites.flatMap((s) => s.hosts)).slice(0, FOCUS_HOSTS);
  if (!named.length && !hosts.length) return null;
  const now = Math.floor(Date.now() / 1000);
  const blocks = [
    ...named.map((s) => focusBlock(s, sitesRes.sites, problems, now)),
    ...hosts.map((h) => hostFocusBlock(h, problems, now)),
  ];
  return { sites: named.map((s) => s.name), hosts: hosts.map((h) => h.name), text: dataBlock('FOCUS', blocks.join('\n\n')) };
}
