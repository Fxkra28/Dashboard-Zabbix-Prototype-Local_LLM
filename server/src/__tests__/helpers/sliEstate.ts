import type { Mock } from 'vitest';
import { monthBounds } from '../../sli/time.js';

/**
 * A made-up estate that answers by Zabbix method, for the tests of the derived SLA: eleven hosts, three months of outages that cross month ends, planned
 * maintenance, a day nobody collected in, a host nobody ever pinged, a trigger that repeats its PROBLEM, and web checks. It is generated from a fixed seed,
 * so the same numbers come out every time, and nothing in it is HCML's.
 */

// The parameters of a Zabbix call, which the fixture reads by whatever names the call used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Params = Record<string, any>;

export interface Fixture {
  triggers: Params[];
  parents: Record<string, string[]>;
  events: { eventid: string; objectid: string; clock: number; value: number }[];
  items?: Params[];
  trends?: { itemid: string; clock: number; num: number; min?: number; max?: number }[];
  history?: { itemid: string; clock: number; value?: number }[];
  maintenance?: Params[];
  groups?: Params[];
  /** The "Web Monitoring" host, when the estate has one, and its web items. */
  webHostId?: string;
  webItems?: Params[];
  /** The tags, the inventory and the host groups of a host, as `host.get` returns them when it is asked for them (BK-103). */
  signals?: Record<string, Params>;
}

/** Answers the calls the engine makes, from `f`. */
export function serveFixture(zbxMock: Mock, f: Fixture): void {
  zbxMock.mockImplementation(async (method: string, p: Params) => {
    switch (method) {
      case 'trigger.get':
        return f.triggers.filter((t) => p.filter.description.includes(t.description));
      case 'host.get':
        if (p.filter) return f.webHostId ? [{ hostid: f.webHostId }] : [];
        return p.hostids.map((hostid: string) => ({
          hostid,
          parentTemplates: (f.parents[hostid] ?? []).map((name) => ({ name })),
          ...(f.signals?.[hostid] ?? {}),
        }));
      case 'event.get':
        return f.events
          .filter((e) => p.objectids.includes(e.objectid) && e.clock >= (p.time_from ?? 0) && e.clock <= p.time_till)
          .sort((a, b) => (p.sortorder === 'DESC' ? b.clock - a.clock : a.clock - b.clock) || a.eventid.localeCompare(b.eventid))
          .slice(0, p.limit)
          .map((e) => ({ ...e, clock: String(e.clock), value: String(e.value) }));
      case 'item.get':
        return p.webitems ? (f.webItems ?? []) : (f.items ?? []);
      case 'maintenance.get':
        return f.maintenance ?? [];
      case 'hostgroup.get':
        return f.groups ?? [];
      case 'history.get':
        return (f.history ?? [])
          .filter((r) => p.itemids.includes(r.itemid) && r.clock >= p.time_from && r.clock <= p.time_till)
          .map((r) => ({ itemid: r.itemid, clock: String(r.clock), ...(r.value === undefined ? {} : { value: String(r.value) }) }));
      case 'trend.get':
        return (f.trends ?? [])
          .filter((r) => p.itemids.includes(r.itemid) && r.clock >= p.time_from && r.clock <= p.time_till)
          .map((r) => ({
            itemid: r.itemid,
            clock: String(r.clock),
            num: String(r.num),
            ...(r.min === undefined ? {} : { value_min: String(r.min), value_max: String(r.max ?? r.min) }),
          }));
      default:
        return [];
    }
  });
}

export const TZ = 'Asia/Jakarta';
/** The moment the tests stand at: 17 September 2026, 10:20 in Jakarta, so the hour in progress is a tail that only history holds. */
export const NOW = Date.parse('2026-09-17T03:20:00Z') / 1000;
export const NOW_ISO = '2026-09-17T03:20:00Z';

/** A Jakarta wall-clock time as Unix seconds. */
export const wib = (text: string): number => Date.parse(`${text.replace(' ', 'T')}:00+07:00`) / 1000;

export const MONTHS = {
  jun: monthBounds('2026-06', TZ),
  jul: monthBounds('2026-07', TZ),
  aug: monthBounds('2026-08', TZ),
  sep: monthBounds('2026-09', TZ),
};

const hourFloor = (t: number) => Math.floor(t / 3600) * 3600;

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTS = [
  { id: '101', name: '1.2.1 TANGO02CORESWITCH', tpl: 'Cisco IOS by SNMP', status: '0' },
  { id: '102', name: '4.3.3 FPSO ARUBA 3', tpl: 'Generic by SNMP', status: '0' },
  { id: '103', name: 'INET : SAMPANG WAN 1', tpl: 'ICMP Ping', status: '0' },
  { id: '104', name: 'INET : SAMPANG WAN 2', tpl: 'ICMP Ping', status: '0' },
  { id: '105', name: '1.1 ALPHA-FW01', tpl: 'FortiGate by SNMP', status: '0' },
  { id: '106', name: '9.9 DMR REPEATER', tpl: 'ICMP Ping', status: '1' },
  { id: '107', name: '5.1 BRAVO-SW01', tpl: 'Cisco IOS by SNMP', status: '0' },
  { id: '108', name: '5.2 BRAVO-SW02', tpl: 'Cisco IOS by SNMP', status: '0' },
  { id: '109', name: '6.1 CHARLIE-AP01', tpl: 'Generic by SNMP', status: '0' },
  { id: '110', name: 'WEB : PORTAL', tpl: 'ICMP Ping', status: '0' },
  { id: '111', name: '7.1 DELTA-RT01', tpl: 'Cisco IOS by SNMP', status: '0' },
] as const;

type Ev = { clock: number; value: number };

/** Outages as PROBLEM and OK pairs; `open` leaves the last one running. */
function outages(spans: [number, number | null][], repeatEvery = 0): Ev[] {
  const out: Ev[] = [];
  for (const [from, to] of spans) {
    out.push({ clock: from, value: 1 });
    if (repeatEvery) for (let t = from + repeatEvery; to === null ? t < NOW : t < to; t += repeatEvery) out.push({ clock: t, value: 1 });
    if (to !== null) out.push({ clock: to, value: 0 });
  }
  return out;
}

/** Random outages between `from` and `to`: starts a few days apart, lasting 40 seconds to five hours. */
function flaps(rng: () => number, from: number, to: number, everyDays: number): [number, number][] {
  const spans: [number, number][] = [];
  let t = from + rng() * everyDays * 86400;
  while (t < to) {
    const start = Math.floor(t);
    const len = Math.floor(40 + rng() ** 2 * 5 * 3600);
    spans.push([start, Math.min(start + len, to - 1)]);
    t = start + len + (0.3 + rng()) * everyDays * 86400;
  }
  return spans;
}

/** The made-up estate. `now` is NOW; every month from June is closed but September. */
export function buildEstate(): Fixture {
  const rng = seeded(20260917);
  const from = wib('2026-05-15 00:00');
  const events: { eventid: string; objectid: string; clock: number; value: number }[] = [];
  const triggers: Params[] = [];
  const perTrigger = new Map<string, Ev[]>();
  const add = (triggerid: string, hostid: string, description: string, evs: Ev[], over: Params = {}) => {
    const sorted = [...evs].sort((a, b) => a.clock - b.clock);
    perTrigger.set(triggerid, sorted);
    const host = HOSTS.find((h) => h.id === hostid)!;
    const last = sorted[sorted.length - 1];
    triggers.push({
      triggerid,
      description,
      value: last?.value === 1 ? '1' : '0',
      lastchange: String(last?.clock ?? from - 86400),
      status: '0',
      type: '0',
      hosts: [{ hostid, name: host.name, status: host.status }],
      ...over,
    });
  };
  const U = 'Unavailable by ICMP ping';
  const L = 'High ICMP ping loss';

  add('1011', '101', U, [
    ...outages([[wib('2026-07-31 22:00'), wib('2026-08-01 03:00')], [wib('2026-08-31 23:00'), wib('2026-09-01 00:30')]]),
    ...outages(flaps(rng, from, NOW, 6)),
  ]);
  add('1012', '101', L, outages(flaps(rng, from, NOW, 4)));
  add('1021', '102', U, outages([...flaps(rng, from, wib('2026-09-10 00:00'), 7), [wib('2026-09-16 21:00'), null]]));
  add('1022', '102', L, outages([[wib('2026-06-30 23:50'), wib('2026-07-01 00:20')], ...flaps(rng, wib('2026-07-02 00:00'), NOW, 5)]));
  // A WAN pair whose legs are down together for two hours, and apart for the rest.
  add('1031', '103', U, outages([[wib('2026-08-10 02:00'), wib('2026-08-10 06:00')], ...flaps(rng, from, NOW, 9)]));
  add('1041', '104', U, outages([[wib('2026-08-10 04:00'), wib('2026-08-10 08:00')], ...flaps(rng, from, NOW, 9)]));
  add('1032', '103', L, []);
  add('1042', '104', L, []);
  // Quiet until September, so August only knows its state from the first event after it.
  add('1051', '105', U, outages([[wib('2026-09-05 08:00'), null]]));
  add('1052', '105', L, []);
  add('1062', '106', L, outages(flaps(rng, from, NOW, 20)));
  add('1071', '107', U, outages([[wib('2026-07-18 03:00'), wib('2026-07-18 05:30')], ...flaps(rng, from, NOW, 6)]));
  add('1072', '107', L, []);
  add('1081', '108', U, outages([[wib('2026-08-20 02:10'), wib('2026-08-20 02:40')], ...flaps(rng, from, NOW, 6)]));
  add('1082', '108', L, []);
  // A trigger set to repeat its PROBLEM while the problem lasts, one outage of which runs across the end of July.
  add('1092', '109', L, outages([[wib('2026-07-14 10:00'), wib('2026-07-14 11:00')], [wib('2026-07-31 23:00'), wib('2026-08-01 01:00')]], 300), { type: '1' });
  add('1091', '109', U, []);
  add('1102', '110', L, []);
  add('1101', '110', U, []);
  add('1111', '111', U, outages(flaps(rng, from, NOW, 5)));
  add('1112', '111', L, []);

  let id = 0;
  for (const [triggerid, evs] of perTrigger) for (const e of evs) events.push({ eventid: `e${String(++id).padStart(5, '0')}`, objectid: triggerid, clock: e.clock, value: e.value });

  // Hours with data: every hour from June to the last whole hour, except what each host lacked.
  const items: Params[] = [];
  const trends: NonNullable<Fixture['trends']> = [];
  const history: NonNullable<Fixture['history']> = [];
  const lastHour = hourFloor(NOW);
  const estateGap: [number, number] = [wib('2026-07-12 14:00'), wib('2026-07-12 19:00')];
  for (const h of HOSTS) {
    const itemid = `i${h.id}`;
    const never = h.id === '110' || h.id === '106';
    items.push({ itemid, hostid: h.id, key_: 'icmpping', delay: '1m', value_type: '3', state: h.id === '110' ? '1' : '0', lastclock: never ? '0' : String(NOW - 30) });
    if (never) continue;
    for (let t = MONTHS.jun.from; t < lastHour; t += 3600) {
      if (t >= estateGap[0] && t < estateGap[1]) continue;
      if (h.id === '101' && t >= wib('2026-08-03 00:00') && t < wib('2026-08-04 00:00')) continue;
      if (h.id === '111' && t >= MONTHS.aug.from && t < MONTHS.aug.to && rng() < 0.4) continue;
      trends.push({ itemid, clock: t, num: rng() < 0.03 ? 20 : 60 });
    }
    for (let t = lastHour; t < NOW; t += 60) history.push({ itemid, clock: t });
  }

  const maintenance: Params[] = [
    {
      maintenanceid: '1',
      active_since: String(wib('2026-07-01 00:00')),
      active_till: String(wib('2026-09-30 00:00')),
      timeperiods: [
        { timeperiod_type: '0', start_date: String(wib('2026-07-18 03:30')), period: '3600' },
        { timeperiod_type: '3', every: '1', dayofweek: '64', start_time: '3600', period: '3600' },
      ],
      hosts: [{ hostid: '107' }],
      hostgroups: [],
    },
    {
      maintenanceid: '2',
      active_since: String(wib('2026-08-01 00:00')),
      active_till: String(wib('2026-08-31 00:00')),
      timeperiods: [{ timeperiod_type: '2', every: '1', start_time: '7200', period: '3600' }],
      hosts: [],
      hostgroups: [{ groupid: '77' }],
    },
  ];

  // The web checks: one that is mostly fine and one with hours that are partly down, some of them recent enough to have raw readings.
  const webItems = [
    { itemid: 'w1', name: 'Web scenario "Portal": Failed step', key_: 'web.test.fail[Portal]', delay: '1m' },
    { itemid: 'w2', name: 'Web scenario "Zabbix": Failed step', key_: 'web.test.fail[Zabbix]', delay: '1m' },
  ];
  for (let t = MONTHS.jun.from; t < lastHour; t += 3600) {
    const down = (t >= wib('2026-08-12 00:00') && t < wib('2026-08-12 03:00')) || (t >= wib('2026-09-09 10:00') && t < wib('2026-09-09 12:00'));
    trends.push({ itemid: 'w1', clock: t, num: 60, min: down ? 1 : 0, max: down ? 1 : 0 });
    const mixed = t >= wib('2026-09-12 00:00') && t < wib('2026-09-12 04:00');
    trends.push({ itemid: 'w2', clock: t, num: 60, min: 0, max: mixed ? 1 : 0 });
    if (mixed) for (let s = 0; s < 4; s++) history.push({ itemid: 'w2', clock: t + 600 + s * 60, value: 1 });
  }

  return {
    triggers,
    parents: Object.fromEntries(HOSTS.map((h) => [h.id, [h.tpl, ...(h.tpl === 'Cisco IOS by SNMP' ? ['ICMP Ping'] : [])]])),
    events,
    items,
    trends,
    history,
    maintenance,
    groups: [{ groupid: '77', name: 'Bravo', hosts: [{ hostid: '108' }] }],
    webHostId: '900',
    webItems,
  };
}
