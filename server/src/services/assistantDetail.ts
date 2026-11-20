/**
 * What a question gets beyond the snapshot and the site focus: past problems, latest values, host details and contacts. Each is read for what the question names and for the pages the user holds
 * (ADR-0017), within a time and a size, from Zabbix on the spot. The model has no tools and asks for nothing: the portal reads what the question needs, as it does for the site focus. A read
 * that fails is said to have failed, so that the model does not take silence for "none".
 */

import type { SiteRef } from '../domain/naming.js';
import { siteOfName } from '../domain/siteOf.js';
import { BadRequestError } from '../core/validate.js';
import type { ZbxProblem } from '../domain/queries.js';
import { ackedOpenIds, acksSection, readAcks, readAcksIn } from './assistantAcks.js';
import { hostInfoSection, readHostInfo, siteContactsSection } from './assistantHostInfo.js';
import { linksSection, webSection } from './assistantLinks.js';
import { mapListSection, mapsSection, readHostMaps, readMapNames } from './assistantMaps.js';
import { maintenanceSection, readMaintenance } from './assistantMaintenance.js';
import { floorOf, openProblemsSection } from './assistantOpen.js';
import { portOf, portsSection, readPort } from './assistantPorts.js';
import { HOST_NAME_MAX, promptText } from './assistantLines.js';
import { notGivenLine } from './assistantPrompt.js';
import { snapshotTime } from './assistantSnapshot.js';
import { HEAVY_REPORTS_PER_PERSON, SLI_READS_PER_PERSON } from '../security/heavyLimit.js';
import { monthsTouched } from '../sli/window.js';
import { pastSection, readPast } from './assistantPast.js';
import { capacityPeriod, capacitySection, daysOf, noiseSection, PAGE_PERIODS, scorecardSection, topTriggersSection } from './assistantReports.js';
import { seriesSection } from './assistantSeries.js';
import { readSlaWindow, slaSection, slaWindowOf, snapshotHolds } from './assistantSla.js';
import { topicsOf, type Metric, type Topics } from './assistantTopics.js';
import { hostValuesSection, readHostValues, siteValuesSection, topHostItems, topHostsLines, type ValueItem } from './assistantValues.js';
import { windowOf, windowWords, type PastWindow } from './assistantWhen.js';
import type { Site } from './sites.js';
import { CAPACITY_PERIODS, CAPACITY_TOP, getCapacityReport } from './capacity.js';
import { getGraph } from './history.js';
import { getScorecard } from './inventory.js';
import { linksView } from './links.js';
import { getNoiseReport } from './noise.js';
import { getTopTriggers } from './reports.js';
import { topHostsView } from './topHosts.js';
import { WEB_FAILURES_ROWS, webMonitoringView } from './webMonitoring.js';

export interface DetailContext {
  question: string;
  /** Epoch seconds. */
  now: number;
  tz: string;
  /** The time the reads are made, as the snapshot writes a time. */
  readAt: string;
  /** The sites and hosts the question names. */
  sites: SiteRef[];
  hosts: { hostid: string; name: string }[];
  /** Every site with its hosts, as the Sites view reads them. */
  allSites: Site[];
  /** The problems that are open now, as the pages count them. */
  problems: ZbxProblem[];
  /** The user is an administrator, or sign-in is off: the inventory scorecard is for them alone. */
  admin: boolean;
  /** The user is an operator or an administrator, or sign-in is off: who acknowledged a problem is for them alone, since they can acknowledge (SC-65). */
  operator: boolean;
  /** Whether the user's pages include any of these modules; an administrator holds them all. */
  can: (...modules: string[]) => boolean;
  /** The model is outside this machine, so the addresses, the tags, the inventory and the people on record are kept from it. */
  external: boolean;
  /** Fires when the reader has left: no read is started for them, and the reads that take a signal stop with it (BK-91). */
  signal?: AbortSignal;
  /** The person's places in the lines of the slow reports: each heavy topic of a question takes one while its read runs, as a report page does, and a topic that finds none is told so (BK-88). A place comes with the function that frees it. Left out, there is no limit. */
  places?: { heavy: () => (() => void) | null; sla: () => (() => void) | null };
}

/** The most calendar months one question's SLA window may touch. */
export const SLA_MONTHS_MAX = 4;

/** What the blocks may add to a prompt in all; a block that would pass it is left out whole. */
export const DETAIL_TOTAL = 2_800;

/** How long a block waits for Zabbix, which is slow at HCML. */
const DETAIL_WAIT_MS = 9_000;

/** The lowest severity of the past problems: Average, as the Problems page's own counts treat a problem. */
const PAST_FLOOR = 3;

/** Most hosts of a site that one read takes. */
const SITE_HOSTS_MAX = 100;

const BUDGET = { past: 700, host: 600, hostPair: 400, site: 450, contacts: 500, acks: 700, sla: 700, open: 1_000, maintenance: 600, links: 800, web: 600, series: 600, port: 600, capacity: 700, noise: 800, triggers: 600, inventory: 700, maps: 600 };

/** A read that did not end within its time, which goes on in the cache. */
class ReadTimeout extends Error {}

function within<T>(read: Promise<T>, ms = DETAIL_WAIT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReadTimeout('the read took too long')), ms);
    read.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** The hosts of a site, as the focus block finds them: by the site the Sites view put them in, which reads a tag, the name, the inventory and the host group (BK-103). */
function hostsOf(site: SiteRef, sites: Site[]): { hostid: string; name: string }[] {
  return sites.flatMap((s) => (siteOfName(s.name)?.code === site.code ? s.hosts : [])).map((h) => ({ hostid: h.hostid, name: h.name }));
}

/** A report that has not been read before takes a minute or more on HCML's Zabbix: said to be on its way when the wait runs out, and unread for any other failure. */
const slow = (what: string, err: unknown): string =>
  err instanceof ReadTimeout ? `${what}: is still being worked out, since a report that has not been read before takes a minute or more on HCML's Zabbix and the work carries on; nothing is known of it yet, and it will be ready shortly` : unread(what);

/** `what` may carry a host name that was typed into Zabbix, so it is made one plain line first (SC-69). */
const unread = (what: string): string => `${promptText(what, 200)}: could not be read from Zabbix in time; nothing is known of them from this snapshot`;

const namesOf = (items: { name: string }[]): string => items.map((i) => promptText(i.name, HOST_NAME_MAX)).join(' and ');

async function pastBlocks(c: DetailContext, topics: Topics): Promise<string[]> {
  // "How many times did it go down" needs the host or the site it is asked of: the whole estate's problems answer nothing of it.
  if (topics.counts && !c.hosts.length && !c.sites.length) return [];
  const days = topics.counts ? 7 : 1;
  const window: PastWindow = windowOf(c.question, c.now, c.tz) ?? { from: c.now - days * 86_400, to: c.now, label: topics.counts ? 'the last 7 days' : 'the last 24 hours' };
  const hosts = c.hosts.length ? c.hosts : c.sites.length ? c.sites.flatMap((s) => hostsOf(s, c.allSites)).slice(0, SITE_HOSTS_MAX) : null;
  const scope = c.hosts.length ? namesOf(c.hosts) : c.sites.length ? namesOf(c.sites) : null;
  try {
    const { events, truncated } = await within(readPast(window, hosts?.map((h) => h.hostid) ?? null, PAST_FLOOR));
    return [pastSection(events, { window, tz: c.tz, now: c.now, scope, minSeverity: PAST_FLOOR, truncated, budget: BUDGET.past }).text];
  } catch {
    return [unread(`PROBLEMS THAT OPENED ${windowWords(window, c.tz)}`)];
  }
}

async function acksBlocks(c: DetailContext): Promise<string[]> {
  const hosts = c.hosts.length ? c.hosts : c.sites.length ? c.sites.flatMap((s) => hostsOf(s, c.allSites)).slice(0, SITE_HOSTS_MAX) : null;
  const scope = c.hosts.length ? namesOf(c.hosts) : c.sites.length ? namesOf(c.sites) : null;
  const window = windowOf(c.question, c.now, c.tz);
  const common = { scope, tz: c.tz, now: c.now, people: !c.external && c.operator, byRole: !c.external && !c.operator, budget: BUDGET.acks };
  try {
    if (window) {
      const { problems, truncated } = await within(readAcksIn(window, hosts?.map((h) => h.hostid) ?? null));
      return [acksSection(problems, { ...common, window, total: truncated ? null : problems.length }).text];
    }
    // The problems open now, whatever their age: an acknowledgement from last winter is still the last word on a problem that has not closed.
    const { ids, total } = ackedOpenIds(c.problems, hosts ? new Set(hosts.map((h) => h.hostid)) : null);
    return [acksSection(await within(readAcks(ids)), { ...common, window: null, total }).text];
  } catch {
    return [unread('ACKNOWLEDGED PROBLEMS')];
  }
}

/** Every open problem of the host or site the question named, or of a severity: the list the snapshot cuts at its few worst. It reads nothing, the problem list is already kept. */
function openBlocks(c: DetailContext): string[] {
  const hosts = c.hosts.length ? c.hosts : c.sites.length ? c.sites.flatMap((s) => hostsOf(s, c.allSites)) : null;
  const scope = c.hosts.length ? namesOf(c.hosts) : c.sites.length ? namesOf(c.sites) : null;
  const ids = hosts ? new Set(hosts.map((h) => h.hostid)) : null;
  const inScope = ids ? c.problems.filter((p) => p.hostid !== undefined && ids.has(p.hostid)) : c.problems;
  return [openProblemsSection(inScope, { scope, floor: floorOf(c.question), now: c.now, budget: BUDGET.open }).text];
}

/** The lowest, average, highest and last of the first host's item for each metric the question named, over its window; the figures of the Graphs page. */
async function seriesBlocks(c: DetailContext, topics: Topics): Promise<string[]> {
  const network = c.can('network');
  const asked = topics.metrics.filter((m) => m !== 'traffic' || network).slice(0, 2);
  // Only the traffic was asked, and it is not theirs: the notice says so, and no line says that the host has no such item.
  if (!asked.length) return [];
  const host = c.hosts[0];
  const window: PastWindow = windowOf(c.question, c.now, c.tz) ?? { from: c.now - 86_400, to: c.now, label: 'the last 24 hours' };
  try {
    const items = await within(readHostValues([{ hostid: host.hostid, name: host.name }], asked, { network, now: c.now }));
    const picks = asked.map((m) => items.find((i) => i.metric === m && i.itemid)).filter((i): i is ValueItem => i !== undefined);
    if (!picks.length) return [`SERIES of ${promptText(host.name, HOST_NAME_MAX)}: no item of that kind was found on this host`];
    const graph = await within(getGraph({ ids: picks.map((p) => p.itemid as string), from: window.from, to: window.to, points: 12, now: c.now }));
    return [seriesSection(graph, picks, { host: host.name, window, tz: c.tz, budget: BUDGET.series, local: !c.external }).text];
  } catch {
    return [unread(`SERIES of ${host.name}`)];
  }
}

/** One port of the host the question named: its status, speed, traffic and errors. */
async function portBlocks(c: DetailContext): Promise<string[]> {
  const host = c.hosts[0];
  const token = portOf(c.question) ?? '';
  try {
    return [portsSection(host.name, token, await within(readPort(host.hostid, token)), { now: c.now, budget: BUDGET.port, local: !c.external }).text];
  } catch {
    return [unread(`PORT ${token} of ${host.name}`)];
  }
}

/** A place in one of the person's lines of slow reads, or null when they hold all of them; with no limit set there is nothing to hold, and the release does nothing. */
const takePlace = (c: DetailContext, line: 'heavy' | 'sla'): (() => void) | null => (c.places ? c.places[line]() : () => undefined);

/**
 * Starts a slow read that holds a place. The place is the person's while the read runs: it is freed when the read ends, whichever way, and not when the question stops waiting for it, since the work carries on
 * and a person who asks again must not be able to start more of it than the line allows (BK-88).
 */
function holding<T>(release: () => void, start: () => Promise<T>): Promise<T> {
  let read: Promise<T>;
  try {
    read = start();
  } catch (err) {
    read = Promise.reject(err);
  }
  read.then(release, release);
  return read;
}

/** The block for a topic that the person has no place left for: it says so, and so does not read as a report that found nothing. */
const busy = (what: string, limit: number): string =>
  `${what}: not read: you already have ${limit} reports being prepared, so this one waited; nothing is known of it from this snapshot. Wait for one to finish, then ask again.`;

async function capacityBlocks(c: DetailContext): Promise<string[]> {
  if (c.signal?.aborted) return [];
  const window = windowOf(c.question, c.now, c.tz, 90);
  const days = capacityPeriod(daysOf(window, 90), CAPACITY_PERIODS);
  const release = takePlace(c, 'heavy');
  if (!release) return [busy('CAPACITY', HEAVY_REPORTS_PER_PERSON)];
  try {
    return [capacitySection(await within(holding(release, () => getCapacityReport(days, CAPACITY_TOP, c.signal))), { window, tz: c.tz, budget: BUDGET.capacity, now: c.now }).text];
  } catch (err) {
    return [slow('CAPACITY', err)];
  }
}

async function noiseBlocks(c: DetailContext): Promise<string[]> {
  if (c.signal?.aborted) return [];
  const window = windowOf(c.question, c.now, c.tz);
  const release = takePlace(c, 'heavy');
  if (!release) return [busy('ALERT NOISE', HEAVY_REPORTS_PER_PERSON)];
  try {
    return [noiseSection(await within(holding(release, () => getNoiseReport(capacityPeriod(daysOf(window, 90), PAGE_PERIODS), 0, 5, c.signal))), { window, tz: c.tz, budget: BUDGET.noise, now: c.now }).text];
  } catch (err) {
    return [slow('ALERT NOISE', err)];
  }
}

async function triggerBlocks(c: DetailContext): Promise<string[]> {
  if (c.signal?.aborted) return [];
  const window = windowOf(c.question, c.now, c.tz);
  const release = takePlace(c, 'heavy');
  if (!release) return [busy('TOP TRIGGERS', HEAVY_REPORTS_PER_PERSON)];
  try {
    return [topTriggersSection(await within(holding(release, () => getTopTriggers(capacityPeriod(daysOf(window, 90), PAGE_PERIODS), c.signal))), { window, tz: c.tz, budget: BUDGET.triggers, now: c.now }).text];
  } catch (err) {
    return [slow('TOP TRIGGERS', err)];
  }
}

async function inventoryBlocks(): Promise<string[]> {
  try {
    return [scorecardSection(await within(getScorecard()), BUDGET.inventory).text];
  } catch (err) {
    return [slow('INVENTORY AND OWNERSHIP SCORECARD', err)];
  }
}

/** What the host the question named is linked to on the maps, or, with no host, the maps there are. */
async function mapsBlocks(c: DetailContext): Promise<string[]> {
  try {
    if (c.hosts.length) return [mapsSection(c.hosts[0].name, await within(readHostMaps(c.hosts[0].hostid, { network: c.can('network') })), BUDGET.maps, !c.external).text];
    if (/\b(maps?|peta)\b/i.test(c.question)) return [mapListSection(await within(readMapNames()), BUDGET.maps).text];
    return [];
  } catch {
    return [unread('MAPS')];
  }
}

async function linksBlocks(c: DetailContext): Promise<string[]> {
  const hosts = c.hosts.length ? c.hosts : c.sites.length ? c.sites.flatMap((s) => hostsOf(s, c.allSites)) : null;
  const scope = c.hosts.length ? namesOf(c.hosts) : c.sites.length ? namesOf(c.sites) : null;
  try {
    return [linksSection(await within(linksView()), { hostids: hosts ? new Set(hosts.map((h) => h.hostid)) : null, scope, budget: BUDGET.links, local: !c.external }).text];
  } catch {
    return [unread('WAN LINKS')];
  }
}

async function webBlocks(c: DetailContext): Promise<string[]> {
  try {
    return [webSection(await within(webMonitoringView(WEB_FAILURES_ROWS)), { tz: c.tz, budget: BUDGET.web }).text];
  } catch {
    return [unread('WEB CHECKS')];
  }
}

async function maintenanceBlocks(c: DetailContext): Promise<string[]> {
  try {
    return [maintenanceSection(await within(readMaintenance(c.now)), { now: c.now, tz: c.tz, budget: BUDGET.maintenance, local: !c.external, inventoryPage: c.can('inventory') }).text];
  } catch {
    return [unread('MAINTENANCE WINDOWS')];
  }
}

async function slaBlocks(c: DetailContext): Promise<string[]> {
  const w = slaWindowOf(c.question, c.now, c.tz);
  // The snapshot holds last month and this month over every hour, and a window it names for nothing is not read.
  if (!w || snapshotHolds(w, c.now, c.tz)) return [];
  if (c.signal?.aborted) return [];
  // Each month that was not read before is a cold derived month, 98 to 131 seconds on HCML's Zabbix: a question may ask for a few, and a year is not one question (BK-88).
  const months = monthsTouched(w.from, Math.min(w.to, c.now), c.tz).length;
  if (months > SLA_MONTHS_MAX) {
    return [`SLA of ${windowWords(w, c.tz)}: not read: this window touches ${months} months, and each month not read before takes minutes on HCML's Zabbix; ask for ${SLA_MONTHS_MAX} months or fewer; nothing is known of it from this snapshot`];
  }
  const release = takePlace(c, 'sla');
  if (!release) return [busy(`SLA of ${windowWords(w, c.tz)}`, SLI_READS_PER_PERSON)];
  try {
    return [slaSection(await within(holding(release, () => readSlaWindow(w, c.signal))), w, c.tz, BUDGET.sla).text];
  } catch (err) {
    const what = `SLA of ${windowWords(w, c.tz)}`;
    if (err instanceof ReadTimeout) return [`${what}: is still being worked out, since a month that has not been read before takes minutes on HCML's Zabbix and the work carries on; nothing is known of it yet, and it will be ready in a few minutes`];
    if (err instanceof BadRequestError) return [`${what}: cannot be worked out: ${promptText(err.message, 200)}`];
    return [unread(what)];
  }
}

async function valuesBlocks(c: DetailContext, topics: Topics): Promise<string[]> {
  const network = c.can('network');
  const asked: Metric[] = topics.metrics.filter((m) => m !== 'traffic' || network);
  if (!asked.length) return [];

  if (c.hosts.length) {
    const hosts = c.hosts.slice(0, 2);
    try {
      const items = await within(readHostValues(hosts.map((h) => ({ hostid: h.hostid, name: h.name })), asked, { network, now: c.now }));
      return hosts.map((h) => hostValuesSection({ host: h.name, items: items.filter((i) => i.hostid === h.hostid), asked, now: c.now, readAt: c.readAt, budget: hosts.length > 1 ? BUDGET.hostPair : BUDGET.host, local: !c.external }).text);
    } catch {
      return [unread(`VALUES NOW of ${namesOf(hosts)}`)];
    }
  }

  if (c.sites.length) {
    // The traffic of a site's internet links is in its focus block; the interface items of its hosts are asked for by host.
    const metrics = asked.filter((m) => m !== 'traffic').slice(0, 2);
    if (!metrics.length) return [];
    const site = c.sites[0];
    const siteHosts = hostsOf(site, c.allSites);
    const hosts = siteHosts.slice(0, 40);
    // The CPU and memory of every host are read once for the Dashboard and kept, which is how to ask for all the hosts of a site; a search of their items by name is too slow at HCML.
    const viaTop = metrics.filter((m): m is 'cpu' | 'memory' => m === 'cpu' || m === 'memory');
    const byItems = metrics.filter((m) => m !== 'cpu' && m !== 'memory');
    try {
      const [top, read] = await Promise.all([
        viaTop.length ? within(topHostsView(Number.POSITIVE_INFINITY)) : null,
        byItems.length ? within(readHostValues(hosts, byItems, { network, now: c.now })) : ([] as ValueItem[]),
      ]);
      const ids = new Set(siteHosts.map((h) => h.hostid));
      const items = [...(top ? viaTop.flatMap((m) => topHostItems(top, m, ids)) : []), ...read];
      // The CPU and the memory come from a list that may be ten minutes old: they are labelled with its own time, not the time of the question (BK-90).
      return metrics.map((metric) => {
        const fromList = top !== null && viaTop.some((m) => m === metric);
        return siteValuesSection({ site: site.name, items, metric, hostCount: fromList ? siteHosts.length : hosts.length, now: c.now, readAt: fromList ? snapshotTime(top.generatedAt) : c.readAt, budget: BUDGET.site, local: !c.external }).text;
      });
    } catch {
      return [unread(`VALUES NOW at ${site.name}`)];
    }
  }

  // Nothing named: the busiest hosts, which the Dashboard's Top hosts widget already reads.
  const top = asked.filter((m) => m === 'cpu' || m === 'memory');
  if (!top.length || !c.can('dashboard')) return [];
  try {
    const list = await within(topHostsView(5));
    const lines = topHostsLines(list, top, snapshotTime(list.generatedAt), 5);
    return lines.length ? [lines.join('\n')] : [];
  } catch {
    return [unread('BUSIEST HOSTS NOW')];
  }
}

async function detailBlocks(c: DetailContext, topics: Topics): Promise<string[]> {
  // Addresses go only to a model on this machine. The tags, the inventory fields and the people on record are shown on the Inventory page alone, so a user needs it for them even with a model on this machine (SC-65).
  const inventoryPage = c.can('inventory');
  const people = !c.external && inventoryPage;
  if (c.hosts.length) {
    const hosts = c.hosts.slice(0, 2);
    try {
      const info = await within(readHostInfo(hosts.map((h) => h.hostid)));
      return info.map((h) => hostInfoSection(h, { local: !c.external, inventoryPage, people, peopleAsked: topics.people, now: c.now, tz: c.tz, budget: BUDGET.host }).text);
    } catch {
      return [unread(`DETAILS of ${namesOf(hosts)}`)];
    }
  }
  if (topics.people && c.sites.length) {
    const site = c.sites[0];
    try {
      const info = await within(readHostInfo(hostsOf(site, c.allSites).slice(0, SITE_HOSTS_MAX).map((h) => h.hostid)));
      return [siteContactsSection(site.name, info, { people, local: !c.external, inventoryPage, budget: BUDGET.contacts }).text];
    } catch {
      return [unread(`CONTACTS on record for the hosts of ${site.name}`)];
    }
  }
  return [];
}

/** What each topic is called in the line that says a user was not given it. */
const NOT_GIVEN_WORDS: Record<string, string> = {
  details: 'the details of a host',
  values: 'the latest values',
  series: 'the course of a value over time',
  past: 'past problems',
  acks: 'who acknowledged a problem',
  sla: 'the SLA of another period',
  open: 'the full list of open problems',
  maintenance: 'maintenance windows',
  links: 'the WAN links',
  port: 'the state of a port',
  maps: 'the maps',
  capacity: 'the capacity trends',
  noise: 'the alert noise',
  triggers: 'the top triggers',
  inventory: 'the inventory scorecard',
  web: 'the web checks',
  traffic: 'the interface traffic',
};

/**
 * The blocks for what the question asks, read for the user's own pages, and the line that says which of what it asked for was not given. The line is an instruction to the model, not data, so it
 * is returned on its own: the prompt puts it beside the data and not inside the fence the model is told never to obey (BK-84).
 */
export async function buildDetails(c: DetailContext): Promise<{ topics: string[]; blocks: string[]; notGiven: string | null }> {
  const topics = topicsOf(c.question);
  // The course of a value over a time, for a host the question named, gives its last figure too, so the plain values are not read beside it.
  const seriesAsked = topics.series && topics.metrics.length > 0 && c.hosts.length > 0;
  const seriesWanted = seriesAsked && c.can('graphs');
  // What the question asks for, what the user's pages allow of it, and how to read it.
  const rules: { topic: string; asked: boolean; allowed: boolean; run: () => Promise<string[]> }[] = [
    { topic: 'details', asked: topics.details && (c.hosts.length > 0 || c.sites.length > 0), allowed: c.can('hosts', 'devices'), run: () => detailBlocks(c, topics) },
    { topic: 'values', asked: topics.metrics.length > 0 && !seriesWanted, allowed: c.can('latest'), run: () => valuesBlocks(c, topics) },
    { topic: 'series', asked: seriesAsked, allowed: c.can('graphs'), run: () => seriesBlocks(c, topics) },
    { topic: 'past', asked: topics.past, allowed: c.can('problems'), run: () => pastBlocks(c, topics) },
    { topic: 'acks', asked: topics.acks, allowed: c.can('problems'), run: () => acksBlocks(c) },
    { topic: 'sla', asked: topics.sla, allowed: c.can('sla'), run: () => slaBlocks(c) },
    { topic: 'open', asked: topics.openAll, allowed: c.can('problems'), run: async () => openBlocks(c) },
    { topic: 'maintenance', asked: topics.maintenance, allowed: c.can('sla', 'hosts', 'devices', 'sites'), run: () => maintenanceBlocks(c) },
    { topic: 'links', asked: topics.links, allowed: c.can('links'), run: () => linksBlocks(c) },
    { topic: 'port', asked: topics.port && c.hosts.length > 0, allowed: c.can('network'), run: () => portBlocks(c) },
    { topic: 'maps', asked: topics.maps, allowed: c.can('maps'), run: () => mapsBlocks(c) },
    { topic: 'capacity', asked: topics.capacity || (topics.capacityOfHost && c.hosts.length > 0), allowed: c.can('capacity'), run: () => capacityBlocks(c) },
    { topic: 'noise', asked: topics.noise, allowed: c.can('noise'), run: () => noiseBlocks(c) },
    { topic: 'triggers', asked: topics.triggers, allowed: c.can('top-triggers'), run: () => triggerBlocks(c) },
    { topic: 'inventory', asked: topics.inventory, allowed: c.admin && c.can('inventory'), run: () => inventoryBlocks() },
    { topic: 'web', asked: topics.web, allowed: c.can('dashboard', 'hosts', 'sla'), run: () => webBlocks(c) },
  ];
  const wanted = rules.filter((r) => r.asked && r.allowed);
  const refused = rules.filter((r) => r.asked && !r.allowed).map((r) => NOT_GIVEN_WORDS[r.topic]);
  // The values and the series leave the traffic of an interface out for a person who does not have the Network page, and an empty answer reads as "none": the notice says it was held back (BK-84).
  if (topics.metrics.includes('traffic') && !c.can('network')) refused.push(NOT_GIVEN_WORDS.traffic);
  const notGiven = refused.length ? notGivenLine(refused) : null;

  const made = await Promise.all(wanted.map(async (w) => ({ topic: w.topic, blocks: await w.run() })));
  const blocks: string[] = [];
  const used: string[] = [];
  let total = 0;
  for (const m of made) {
    if (!m.blocks.length) continue;
    // A block that would pass the total is left out whole: half of one reads as the whole of it.
    const size = m.blocks.reduce((n, b) => n + b.length + 2, 0);
    if (total + size > DETAIL_TOTAL) break;
    total += size;
    blocks.push(...m.blocks);
    used.push(m.topic);
  }
  return { topics: used, blocks, notGiven };
}
