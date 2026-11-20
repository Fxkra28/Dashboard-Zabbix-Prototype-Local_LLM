/**
 * What a host is connected to, for "apa yang terhubung ke switch X di peta?", and the maps there are: from Zabbix's own maps, which are drawn by hand and are only as good as the people who drew them. A user without
 * the network pages is given the maps as the Maps page gives them to that user, without the network devices and the links that end at one.
 */

import { config } from '../core/config.js';
import { HOST_NAME_MAX, promptText, section } from './assistantLines.js';
import { getMapDetail, getMaps, networkHostIds, withoutNetworkElements } from './maps.js';

interface MapElement {
  selementid: string;
  /** Zabbix's kind of element: 0 a host, 1 a map, 2 a trigger, 3 a host group, 4 an image. */
  elementtype?: string;
  hostid?: string;
  hostName?: string;
  labelText?: string;
  label?: string;
}

interface MapLink {
  selementid1: string;
  selementid2: string;
  label?: string;
}

interface MapDetail {
  selements?: MapElement[];
  links?: MapLink[];
}

/** One map the host is on, with what it is linked to there. */
export interface HostOnMap {
  map: string;
  /** What the host is linked to, by the name on the map; empty when it is on the map and linked to nothing. `free` marks a name taken from a label that staff typed, not from a host. */
  linkedTo: { name: string; via: string; free?: boolean }[];
}

export interface HostMaps {
  /** How many maps there are, and how many of them were looked at. */
  total: number;
  scanned: number;
  on: HostOnMap[];
}

/** The most maps one question looks through. */
export const MAPS_SCANNED = 8;

const NEIGHBOURS_SHOWN = 8;

const KIND: Record<string, string> = { '0': 'host', '1': 'map', '2': 'trigger', '3': 'host group', '4': 'image' };

/** The name an element carries on the map: its host, else its label, else what kind of element it is; an empty label is no name. */
const nameOf = (e: MapElement | undefined): string => promptText([e?.hostName, e?.labelText, e?.label].find((v) => v && v.trim() !== '') ?? `an unnamed ${KIND[e?.elementtype ?? ''] ?? 'element'}`, HOST_NAME_MAX);

/**
 * The label on a link of a map is free text that staff write, and so is the label of an element that is not a host: a model outside this machine is given the host names, and for any other
 * element only that there is one, and not the labels (SC-64).
 */
export function mapsSection(host: string, found: HostMaps, budget: number, local = true): { text: string; truncated: boolean } {
  const cut = found.scanned < found.total ? `; only the first ${found.scanned} of ${found.total} maps were looked at` : '';
  const title = `MAPS of ${promptText(host, HOST_NAME_MAX)} (on ${found.on.length} of ${found.scanned} maps${cut}):`;
  const lines = found.on.map((m) => {
    if (!m.linkedTo.length) return `- "${promptText(m.map, 60)}": on the map, linked to nothing`;
    const shown = m.linkedTo.slice(0, NEIGHBOURS_SHOWN).map((l) => `${!local && l.free ? 'another element of the map' : promptText(l.name, HOST_NAME_MAX)}${local && l.via ? ` (${promptText(l.via, 40)})` : ''}`);
    return `- "${promptText(m.map, 60)}": linked to ${shown.join(', ')}${m.linkedTo.length > NEIGHBOURS_SHOWN ? ` and ${m.linkedTo.length - NEIGHBOURS_SHOWN} more` : ''}`;
  });
  return section(title, lines.length ? lines : ['- none: this host is on none of the maps'], budget, (left) => `- …and ${left} more maps, not listed`);
}

export function mapListSection(names: string[], budget: number): { text: string; truncated: boolean } {
  return section(`MAPS (${names.length}):`, names.length ? names.map((n) => `- ${promptText(n, 60)}`) : ['- none: Zabbix holds no map'], budget, (left) => `- …and ${left} more maps, not listed`);
}

/** The maps there are, by name. */
export async function readMapNames(): Promise<string[]> {
  return ((await getMaps()) as { name: string }[]).map((m) => m.name);
}

/** The maps that a host is on, with the elements it is linked to there. */
export async function readHostMaps(hostid: string, { network }: { network: boolean }): Promise<HostMaps> {
  const maps = (await getMaps()) as { sysmapid: string; name: string }[];
  const looked = maps.slice(0, MAPS_SCANNED);
  const hidden = network ? null : { hosts: await networkHostIds(), groups: config.netGroupIds };
  const details = await Promise.all(
    looked.map(async (m) => {
      const found = (await getMapDetail(m.sysmapid)) as unknown as MapDetail[];
      return { name: m.name, detail: (hidden ? withoutNetworkElements(found as never, hidden.hosts, hidden.groups) : found)[0] as MapDetail | undefined };
    }),
  );
  const on: HostOnMap[] = [];
  for (const { name, detail } of details) {
    const elements = detail?.selements ?? [];
    const mine = elements.filter((e) => e.hostid === hostid);
    if (!mine.length) continue;
    const linkedTo = (detail?.links ?? []).flatMap((l) => {
      const own = mine.find((e) => e.selementid === l.selementid1 || e.selementid === l.selementid2);
      if (!own) return [];
      const other = elements.find((e) => e.selementid === (own.selementid === l.selementid1 ? l.selementid2 : l.selementid1));
      return [{ name: nameOf(other), via: l.label ?? '', ...(other?.hostName?.trim() ? {} : { free: true }) }];
    });
    on.push({ map: name, linkedTo });
  }
  return { total: maps.length, scanned: looked.length, on };
}
