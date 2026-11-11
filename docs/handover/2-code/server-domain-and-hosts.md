# Server: domain and hosts

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 40 min | [Server: security and http](server-security-and-http.md) | [Server: network and capacity](server-network-and-capacity.md) |

`domain/` holds what the portal knows about HCML's estate, in plain functions: the problem list, whether a host is up, and what a host's name says about it. `services/hosts.ts` and `services/reports.ts` build the host lists, the Latest data pages and the Dashboard counts on top of them. All of it reads Zabbix through `zbx` and keeps the answer in the cache described in [the core and the clients](server-core-and-clients.md). Most of the care in this code goes to what a call costs on HCML's Zabbix, which is why the comments in the source quote measured times.

## The problem list

### getProblems, cachedProblems and openProblems

`server/src/domain/queries.ts`. One read of the problem list, shared by every route, the live stream and the reports.

<!-- gen:snippet server/src/domain/queries.ts#getProblems sha=f0670b90de20 -->
`server/src/domain/queries.ts:130-151`

```ts
export async function getProblems(): Promise<ZbxProblem[]> {
  const problems = await zbx<ZbxProblem[]>('problem.get', {
    output: PROBLEM_FIELDS,
    recent: true,
    sortfield: ['eventid'],
    sortorder: 'DESC',
    selectTags: 'extend',
  });

  const triggerIds = [...new Set(problems.filter((p) => p.object === '0').map((p) => p.objectid))];
  const byTrigger = triggerIds.length ? await hostsOf(triggerIds) : new Map<string, TriggerHost>();

  return problems.map((p) => {
    const t = byTrigger.get(p.objectid);
    return {
      ...p,
      host: t?.name ?? '',
      hostid: t?.hostid ?? '',
      manualClose: t?.manualClose ?? false,
    };
  });
}
```
<!-- /gen -->

<!-- gen:snippet server/src/domain/queries.ts#cachedProblems sha=0a8cb2df3051 -->
`server/src/domain/queries.ts:61-61`

```ts
export const cachedProblems = (opts?: Pick<CacheOptions, 'maxAgeMs'>) => cached('problems', PROBLEMS_TTL_MS, getProblems, opts);
```
<!-- /gen -->

<!-- gen:snippet server/src/domain/queries.ts#openProblems sha=00081f76e859 -->
`server/src/domain/queries.ts:31-32`

```ts
export const openProblems = (problems: ZbxProblem[]): ZbxProblem[] =>
  problems.filter((p) => (!p.r_eventid || p.r_eventid === '0') && p.suppressed !== '1');
```
<!-- /gen -->

1. `getProblems` asks Zabbix for `problem.get` with `recent: true`, newest first, with the tags. `recent` returns the problems that are open and also the ones solved inside Zabbix's "Display OK triggers for" period, so a screen can show a problem that has just cleared.
2. `PROBLEM_FIELDS` is the list of fields asked for, and it leaves out `opdata`. Zabbix fills that field from history one problem at a time, which took 35 to 46 seconds for HCML's 650 problems against 0.9 seconds without it. No screen shows it, so only Explain and the Assistant ask for it, through `withOpdata` below.
3. `problem.get` does not say which host a problem is on. The function collects the trigger ids of the problems that come from a trigger (`object === '0'`), asks `hostsOf` for their hosts, and adds `host`, `hostid` and `manualClose` to each problem. `manualClose` says whether the trigger allows closing by hand, and it decides whether the Close button shows.
4. `cachedProblems` keeps the answer for `PROBLEMS_TTL_MS`, 15 seconds. Every route, the stream's tick and the report services call this one function, so a busy minute costs one read of Zabbix and not one for each screen. A caller may pass `maxAgeMs` to refuse an answer that old. `TICK_MS` in `services/stream.ts` is defined as `PROBLEMS_TTL_MS`, so the live stream ticks at the pace of this cache, and its tick passes `maxAgeMs` of 0, so that it always reads. The cache dates an answer from the end of its read, so after a one-second read the answer is 14 seconds old at the next tick; without that the tick would take it and read only every second time, and a read of any length from 5 to 15 seconds would do the same.
5. `openProblems` is the filter that every count and colour uses. A problem counts when it has no recovery event (`r_eventid` empty or '0') and is not suppressed, which is how Zabbix marks a problem raised inside a maintenance window. The Problems page shows the others as well, marked, and does not use this filter.

Tests: `light-reads.test.ts` holds the field list and the host cache, `viewer-network.test.ts` the filter, and `stream.test.ts` the `manualClose` flag.

### hostsOf

`server/src/domain/queries.ts`. Names the host of each trigger without asking Zabbix every time.

<!-- gen:snippet server/src/domain/queries.ts#lookUpHosts sha=544e21f8bce1 -->
`server/src/domain/queries.ts:79-97`

```ts
async function lookUpHosts(map: Map<string, TriggerHost>, ids: string[]): Promise<void> {
  // `manual_close` rides along on the call we already make, no extra request.
  const triggers = await zbx<
    {
      triggerid: string;
      manual_close?: string;
      hosts?: { hostid: string; name: string }[];
    }[]
  >('trigger.get', {
    triggerids: ids,
    output: ['triggerid', 'manual_close'],
    selectHosts: ['hostid', 'name'],
  });
  const at = Date.now();
  for (const t of triggers) {
    const h = t.hosts?.[0];
    if (h) map.set(t.triggerid, { hostid: h.hostid, name: h.name, manualClose: t.manual_close === '1', at });
  }
}
```
<!-- /gen -->

<!-- gen:snippet server/src/domain/queries.ts#hostsOf sha=0dbf177137f0 -->
`server/src/domain/queries.ts:100-124`

```ts
async function hostsOf(ids: string[]): Promise<Map<string, TriggerHost>> {
  const map = await triggerHostMap();
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) await lookUpHosts(map, missing);
  const now = Date.now();
  const old = ids.filter((id) => now - (map.get(id)?.at ?? now) > TRIGGER_HOST_TTL_MS);
  if (old.length && !refreshingHosts) {
    refreshingHosts = lookUpHosts(map, old)
      .catch((err: unknown) => {
        cacheLogger()?.warn(
          { key: 'trigger-hosts', reason: err instanceof Error ? err.message : String(err) },
          'problems: naming the hosts of older triggers failed; keeping the names held',
        );
      })
      .finally(() => {
        refreshingHosts = null;
      });
  }
  // Only the triggers of current problems are kept, so the map cannot grow without bound.
  if (map.size > 2 * ids.length + 500) {
    const current = new Set(ids);
    for (const id of map.keys()) if (!current.has(id)) map.delete(id);
  }
  return map;
}
```
<!-- /gen -->

1. `triggerHostMap` is a map from a trigger id to its host. It is held in the cache for a day and pinned, which keeps the cache's size limit from evicting it. `invalidate('')` still empties it, like every other entry.
2. `lookUpHosts` is the only read: `trigger.get` for a list of trigger ids, with their hosts. The `manual_close` flag comes in the same call, so no second request is needed. It stores the first host of each trigger together with the time it was read.
3. `hostsOf` looks up an id it has never seen now and waits for it. For an id it holds that is older than an hour (`TRIGGER_HOST_TTL_MS`) it starts a refresh in the background and answers with the names it holds. `refreshingHosts` makes sure only one refresh runs at a time, and a failed one logs a warning and leaves the old names.
4. At the end the map is trimmed. Once it has grown past twice the ids plus 500, every trigger that is not in the current problem list is dropped, so the map follows the list and cannot grow for ever.
5. The reason is the cost: naming the hosts of 648 triggers took HCML's Zabbix 9.7 seconds, and a trigger's host rarely changes.

Tests: `light-reads.test.ts`.

### withOpdata

`server/src/domain/queries.ts`. Adds the operational data, the figures Zabbix shows beside a problem's name, to the problems it is given.

<!-- gen:snippet server/src/domain/queries.ts#withOpdata sha=554ad58d9135 -->
`server/src/domain/queries.ts:154-171`

```ts
export async function withOpdata(problems: ZbxProblem[]): Promise<ZbxProblem[]> {
  if (!problems.length) return problems;
  try {
    const rows = await zbx<{ eventid: string; opdata?: string }[]>('problem.get', {
      eventids: problems.map((p) => p.eventid),
      output: ['eventid', 'opdata'],
      recent: true,
    });
    const byId = new Map(rows.map((r) => [r.eventid, r.opdata ?? '']));
    return problems.map((p) => ({ ...p, opdata: byId.get(p.eventid) ?? '' }));
  } catch (err) {
    cacheLogger()?.warn(
      { key: 'opdata', reason: err instanceof Error ? err.message : String(err) },
      'problems: operational data could not be read; answering without it',
    );
    return problems;
  }
}
```
<!-- /gen -->

1. It asks `problem.get` again, for only the event ids it was given and only `eventid` and `opdata`, and puts each problem's text back on it.
2. On any failure it logs "problems: operational data could not be read; answering without it" and returns the problems unchanged. An Explain or Assistant answer gets thinner when Zabbix is slow, and does not fail.
3. Only `services/explain.ts` and `services/assistantSnapshot.ts` call it. That is what keeps the main problem list at about 0.9 seconds on HCML's Zabbix.

Tests: `light-reads.test.ts`, `ai-limits.test.ts` and `chat.test.ts`.

## Is a host up?

`domain/reachability.ts` gives every host one state: up, down, degraded, no data or disabled. Ping decides first. On 17 September 2026, 16 of the 23 hosts that Zabbix called unavailable did answer ping, and 43 hosts had no interface at all. Zabbix's interface flags answer another question, whether SNMP or the agent responds, so they explain what else is wrong and stand in only when there is no recent ping. The Network page reads the same ping items, so the two views agree on what up means.

### isFresh

`server/src/domain/reachability.ts`. Decides whether a value is recent enough to believe.

<!-- gen:snippet server/src/domain/reachability.ts#isFresh sha=c058d85651d3 -->
`server/src/domain/reachability.ts:61-68`

```ts
export function isFresh(
  it: { lastclock?: string; state?: string; delay?: string },
  now: number,
): boolean {
  if (it.state === '1' || !it.lastclock || it.lastclock === '0') return false;
  const age = now - Number(it.lastclock);
  return Number.isFinite(age) && age <= freshWithinS(it.delay);
}
```
<!-- /gen -->

1. A value counts only when the item is supported (`state` is not '1'), `lastclock` is set and is not '0', and the value is no older than `freshWithinS` for the item's delay: three of its own update intervals, with ten minutes as the floor (`MIN_FRESH_SECONDS`). The floor stops one slow poller cycle from flipping a host to no data.
2. An unsupported item keeps its last value whatever it says, and without the age check a pinger that stopped hours ago would still read as up.
3. `parseDelay`, from `sli/engine.ts`, reads the delay. A delay held in a macro counts as one minute, as it does elsewhere in the portal.

Tests: `freshness.test.ts` and `reachability.test.ts`.

### getIcmpValues and recentValues

`server/src/domain/reachability.ts` and `server/src/domain/recentValues.ts`. Read the newest ping of every host in two reads.

<!-- gen:snippet server/src/domain/reachability.ts#getIcmpCatalog sha=40508d4b537c -->
`server/src/domain/reachability.ts:142-155`

```ts
function getIcmpCatalog(): Promise<IcmpCatalogItem[]> {
  return cached(
    'icmp:catalog',
    ICMP_CATALOG_TTL_MS,
    () =>
      zbx<IcmpCatalogItem[]>('item.get', {
        output: ['itemid', 'hostid', 'key_', 'state', 'delay', 'value_type'],
        search: { key_: 'icmpping' },
        startSearch: true,
        monitored: true,
      }),
    { staleMs: ICMP_CATALOG_STALE_MS, staleIfError: true, pin: true },
  );
}
```
<!-- /gen -->

<!-- gen:snippet server/src/domain/recentValues.ts#recentValues sha=675e5d675573 -->
`server/src/domain/recentValues.ts:13-42`

```ts
export async function recentValues(
  items: readonly { itemid: string; value_type: string }[],
  windowS: number,
  nowS = Math.floor(Date.now() / 1000),
): Promise<Map<string, RecentValue>> {
  const byType = new Map<string, string[]>();
  for (const it of items) {
    const ids = byType.get(it.value_type);
    if (ids) ids.push(it.itemid);
    else byType.set(it.value_type, [it.itemid]);
  }
  const out = new Map<string, RecentValue>();
  const reads = await Promise.all(
    [...byType].map(([valueType, itemids]) =>
      zbx<{ itemid: string; clock: string; value: string }[]>('history.get', {
        history: Number(valueType),
        itemids,
        time_from: nowS - windowS,
        output: ['itemid', 'clock', 'value'],
      }),
    ),
  );
  for (const rows of reads) {
    for (const r of rows) {
      const held = out.get(r.itemid);
      if (!held || Number(r.clock) > Number(held.clock)) out.set(r.itemid, { value: r.value, clock: r.clock });
    }
  }
  return out;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/domain/reachability.ts#getIcmpValues sha=5f6b7a867549 -->
`server/src/domain/reachability.ts:164-188`

```ts
export function getIcmpValues(): Promise<Map<string, RecentValue>> {
  return cached('icmp:values', 30_000, async () => {
    const usual: IcmpCatalogItem[] = [];
    const rare: IcmpCatalogItem[] = [];
    let rareWindowS = ICMP_WINDOW_S;
    for (const item of await getIcmpCatalog()) {
      if (item.state === '1') continue;
      const span = freshWithinS(item.delay);
      if (span > ICMP_WINDOW_S) {
        rare.push(item);
        rareWindowS = Math.max(rareWindowS, span);
      } else usual.push(item);
    }
    const [recent, slower] = await Promise.all([
      recentValues(usual, ICMP_WINDOW_S),
      rare.length
        ? recentValues(rare, rareWindowS).catch((err: unknown) => {
            cacheLogger()?.warn({ items: rare.length, reason: err instanceof Error ? err.message : String(err) }, 'icmp: the read of the slowly polled ping items failed; they have no value this round');
            return new Map<string, RecentValue>();
          })
        : new Map<string, RecentValue>(),
    ]);
    return new Map([...recent, ...slower]);
  });
}
```
<!-- /gen -->

1. `getIcmpCatalog` finds every monitored item whose key starts with `icmpping`, which also matches the loss and latency items, and takes no values. Finding them reads Zabbix's whole item table, 19 to 39 seconds on HCML's, and the list changes only when hosts do. So it is kept an hour, may be served for up to a day while a new one is read, and is pinned in the cache.
2. `recentValues` replaces Zabbix's `lastvalue`, which costs one query for each item, 57 to 88 ms on HCML's server. `history.get` reads every item of one value type in one call. The function groups the items by value type, makes one read for each type at the same time, over the last `windowS` seconds, and keeps the newest row of each item.
3. `getIcmpValues` joins the two. It takes the catalog less the unsupported items and reads them over `ICMP_WINDOW_S`, 900 seconds, which reaches past the freshness rule of any item polled at least every five minutes, such as the pinger that runs once a minute. Items polled less often, for which `freshWithinS` believes a value older than that, are read in a second call over the longest of their spans, so their hosts do not read as no data while the value is still believed; on HCML's estate that second call has no items (read on 2 November 2026: all 405 monitored ping items are polled every minute, and none discards unchanged values). If it fails, those items have no value that round, a warning says so, and the host states of the others stand. The result is kept 30 seconds. Two history reads took 2.8 seconds where Zabbix's `lastvalue` took 54.5.
4. The host states, the data clock and Links share this one read.

Tests: `light-reads.test.ts`.

### foldIcmp

`server/src/domain/reachability.ts`. Turns the ping items into one reading for each host.

<!-- gen:snippet server/src/domain/reachability.ts#pingsHost sha=80d36f56e28b -->
`server/src/domain/reachability.ts:97-97`

```ts
const pingsHost = (key: string) => !key.includes('[') || /^[a-z]+\[\s*(,|\])/.test(key);
```
<!-- /gen -->

<!-- gen:snippet server/src/domain/reachability.ts#foldIcmp sha=8bd6b8334174 -->
`server/src/domain/reachability.ts:103-123`

```ts
export function foldIcmp(items: IcmpItem[], now: number): Map<string, IcmpReading> {
  const out = new Map<string, IcmpReading>();
  const ordered = [...items].sort((a, b) => Number(pingsHost(b.key_)) - Number(pingsHost(a.key_)));
  for (const it of ordered) {
    let r = out.get(it.hostid);
    if (!r) {
      r = { state: 'unknown', items: 0, unsupported: 0 };
      out.set(it.hostid, r);
    }
    r.items++;
    if (it.state === '1') r.unsupported++;
    if (!isFresh(it, now)) continue;
    if (it.key_.startsWith('icmppingloss')) r.loss ??= Number(it.lastvalue);
    else if (it.key_.startsWith('icmppingsec')) r.latency ??= Number(it.lastvalue);
    else if (it.key_.startsWith('icmpping') && r.up === undefined) {
      r.up = it.lastvalue === '1';
      r.state = r.up ? 'up' : 'down';
    }
  }
  return out;
}
```
<!-- /gen -->

1. A reading holds `up`, `loss` in percent, `latency` in seconds, a `state` of up, down or unknown, how many ping items the host has, and how many of them Zabbix marks unsupported.
2. A host can have more than one ping item. `icmpping` and `icmpping[,...]` ping the host itself, and `icmpping[<an address>]` pings some other target. `pingsHost` tells them apart by the key, and the sort at the top puts the items that ping the host first. Each of `loss`, `latency` and `up` is set once, by the first fresh item that carries it (`??=`), so the host's own ping wins.
3. A stale or unsupported value is skipped (`isFresh`), so it never turns a host up or down. A host that has ping items but no fresh value stays `unknown`, and that is what lets `hostState` fall back on the interface flags.
4. The function is pure: it takes the items and the time, so a test feeds it fixed values.

Tests: `reachability.test.ts`.

### hostState

`server/src/domain/reachability.ts`. Decides a host's state and says why.

<!-- gen:snippet server/src/domain/reachability.ts#hostState sha=b6fde254ad73 -->
`server/src/domain/reachability.ts:304-327`

```ts
export function hostState(
  host: { status: string; interfaces?: { type?: string; available?: string }[] },
  icmp: IcmpReading | undefined,
): { state: HostState; reason: StateReason } {
  if (host.status === '1') return { state: 'disabled', reason: 'disabled' };

  const failed = (host.interfaces ?? []).filter((i) => i.available === '2');
  if (icmp?.state === 'up') {
    if (!failed.length) return { state: 'up', reason: 'ping' };
    if (failed.some((i) => i.type === '2')) return { state: 'degraded', reason: 'snmp-silent' };
    if (failed.some((i) => i.type === '1')) return { state: 'degraded', reason: 'agent-silent' };
    return { state: 'degraded', reason: 'interface' };
  }
  if (icmp?.state === 'down') return { state: 'down', reason: 'ping' };

  const availability = rollUpAvailability(host.interfaces);
  if (availability === 'available') return { state: 'up', reason: 'interface' };
  if (availability === 'unavailable') return { state: 'down', reason: 'interface' };

  if (icmp && icmp.unsupported < icmp.items) return { state: 'nodata', reason: 'stale' };
  if (!host.interfaces?.length) return { state: 'nodata', reason: 'no-interface' };
  if (icmp && icmp.items > 0) return { state: 'nodata', reason: 'unsupported' };
  return { state: 'nodata', reason: 'interface' };
}
```
<!-- /gen -->

The first rule that matches decides:

| Rule | State | Reason |
|---|---|---|
| The host is disabled in Zabbix | disabled | disabled |
| A fresh ping is up and no interface is unavailable | up | ping |
| A fresh ping is up, and an SNMP interface is unavailable | degraded | snmp-silent |
| A fresh ping is up, and an agent interface is unavailable | degraded | agent-silent |
| A fresh ping is up, and another kind of interface is unavailable | degraded | interface |
| A fresh ping is down | down | ping |
| There is no fresh ping and the interfaces say available | up | interface |
| There is no fresh ping and the interfaces say unavailable | down | interface |
| Ping items exist and some are supported, but none has a fresh value | nodata | stale |
| The host has no interface | nodata | no-interface |
| Ping items exist and all are unsupported | nodata | unsupported |
| Anything else | nodata | interface |

`rollUpAvailability` reads the interface flags the way Zabbix's own screens do, worst first: one unavailable interface makes the host unavailable, else one available makes it available, else unknown. The function is pure, `services/hosts.ts` and `services/sites.ts` call it, and the web app turns the reason into the sentence in a host's tooltip, such as "Answers ping, but SNMP polling gets no reply", and the Assistant is told it for hosts that answer ping and are degraded. Tests: `reachability.test.ts`.

### getCollecting, collectingStatus and getFreshness

`server/src/domain/reachability.ts` and `server/src/services/reports.ts`. Say whether Zabbix is still collecting. A stopped `zabbix-server` leaves every API call working and every value in place, so a frozen estate would otherwise read as fine and Live.

<!-- gen:snippet server/src/domain/reachability.ts#getCollecting sha=836953480f1f -->
`server/src/domain/reachability.ts:264-270`

```ts
export function getCollecting(): Promise<{ lastCollectedAt: number | null; readings: Map<string, IcmpReading> }> {
  return cached('collecting:last', 30_000, async () => {
    const items = await getIcmpItems();
    const lastCollectedAt = newestClock(items) ?? (await lastClockBeyondWindow(items));
    return { lastCollectedAt, readings: foldIcmp(items, Math.floor(Date.now() / 1000)) };
  });
}
```
<!-- /gen -->

<!-- gen:snippet server/src/domain/reachability.ts#collectingStatus sha=31f1478b114e -->
`server/src/domain/reachability.ts:244-261`

```ts
export function collectingStatus(
  lastCollectedAt: number | null,
  now: number,
  readings: Map<string, IcmpReading> = new Map(),
): CollectingStatus {
  const ageSeconds = lastCollectedAt === null ? null : Math.max(0, now - lastCollectedAt);
  const fresh = [...readings.values()].filter((r) => r.state !== 'unknown');
  const answering = fresh.filter((r) => r.state === 'up').length;
  return {
    lastCollectedAt,
    ageSeconds,
    stale: ageSeconds !== null && ageSeconds > COLLECTING_STALE_SECONDS,
    staleAfterSeconds: COLLECTING_STALE_SECONDS,
    pinged: fresh.length,
    answering,
    reachLost: fresh.length >= REACH_MIN_PINGED && answering <= REACH_LOST_SHARE * fresh.length,
  };
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/reports.ts#getFreshness sha=280866a067ac -->
`server/src/services/reports.ts:144-147`

```ts
export async function getFreshness() {
  const { lastCollectedAt, readings } = await getCollecting();
  return collectingStatus(lastCollectedAt, Math.floor(Date.now() / 1000), readings);
}
```
<!-- /gen -->

1. `getCollecting` takes the newest `lastclock` of any supported ping item (`newestClock`). With nothing inside the window of that history read (15 minutes, longer for an item polled less often than every five minutes) it asks Zabbix's own last value of up to 20 items (`lastClockBeyondWindow`), which looks back a day, so the Dashboard can say how long ago collection stopped. The answer is kept 30 seconds and the age is worked out on each request.
2. `collectingStatus` turns that into the status the web app gets. `ageSeconds` is the time since the last value. `stale` is true when it is older than `COLLECTING_STALE_SECONDS`, 600, the ten minutes `isFresh` allows. `pinged` counts the hosts whose latest ping is fresh, and `answering` how many of them are up.
3. `reachLost` is true when at least `REACH_MIN_PINGED` (10) hosts were pinged and no more than `REACH_LOST_SHARE` (20 percent) of them answer. When almost nothing answers at once, Zabbix has more likely lost its way into the network than every device its power. The web app's collector notice then says that the down hosts and problems are most likely not real.
4. `getFreshness` joins the two with the time of the request. It is the whole of `GET /api/freshness`.

Tests: `freshness.test.ts`.

## What a name says

HCML names its hosts by a convention. Devices are `<site>.<class>[.<seq>] NAME`, such as `1.2.1 IDX02CORESWITCH`, and services are `<TYPE> : NAME`, such as `INET : SAMPANG WAN 1`. No HCML host carries a site tag, so the name is the most reliable site signal the estate has. HCML applies the convention unevenly, so the class of a device is read from its monitoring template first when the name is no help. All of it lives in `server/src/domain/naming.ts`.

### siteFromHostName

`server/src/domain/naming.ts`. Says which site a host belongs to, from its name alone. A name that is an IPv4 address (four numbers separated by dots) has no site code: HCML's codes are two or three numbers, and the first number of an address is not a site.

<!-- gen:snippet server/src/domain/naming.ts#siteFromHostName sha=d14c94fc4309 -->
`server/src/domain/naming.ts:49-66`

```ts
export function siteFromHostName(name: string): SiteRef | null {
  if (ADDRESS_NAME.test(name)) return null;
  const coded = /^\s*(\d{1,2})\./.exec(name);
  if (coded) {
    const site = BY_CODE.get(Number(coded[1]));
    return site ? { code: site.code, name: site.name } : null;
  }
  const service = /^\s*(INET|SERVER)\s*:\s*(.+)$/i.exec(name);
  if (service) {
    const words = service[2].toUpperCase();
    for (const site of SITES) {
      if (site.aliases.some((a) => new RegExp(`\\b${a}\\b`).test(words))) {
        return { code: site.code, name: site.name };
      }
    }
  }
  return null;
}
```
<!-- /gen -->

1. A leading number and a dot is the site code. It is looked up in `SITES`, the table of fourteen sites, and a code that is not in the table gives null.
2. `INET :` and `SERVER :` services have no number. The words after the colon are matched, on word boundaries, against each site's aliases, so `SAMPANG`, `SSB` and `SAM` all mean site 3.
3. Anything else belongs to no site and gives null: `WEB :` services, `INTERNET` and the Zabbix server itself.
4. The browser cannot import server code, so `web/src/shared/lib/sites.ts` holds a copy. `copiedHelpers.test.ts` in the web tests runs both on a list of names and fails when they differ, so a change to one has to be made in the other. `site-naming.test.ts` holds the server side.

### deviceClass

`server/src/domain/naming.ts`. Says what kind of device a host is.

<!-- gen:snippet server/src/domain/naming.ts#deviceClass sha=130730e3490c -->
`server/src/domain/naming.ts:93-109`

```ts
export function deviceClass(name: string, templateName?: string): DeviceClass {
  const n = name.toUpperCase();
  if (/^\s*INET\s*:/.test(n)) return 'wan-link';
  if (/^\s*WEB\s*:/.test(n)) return 'web';
  if (/^\s*SERVER\s*:/.test(n)) return 'server';
  if (/REPEATER/.test(n)) return 'repeater';

  const t = (templateName ?? '').toUpperCase();
  if (t.includes('FORTIGATE')) return 'firewall';
  if (t.includes('CISCO IOS')) return 'switch';

  if (/ARUBA|WICTR|\bWAC\b/.test(n)) return 'access-point';
  if (/FW\d|\bFW\b|\bFG|FGT|FGR|FORTI/.test(n)) return 'firewall';
  if (/SWITCH|\bSW\b|_CS\d|_IE\d|-IE\d|ACS|CS2960|MOXA|BRIDGE/.test(n)) return 'switch';
  if (t.includes('GENERIC BY SNMP')) return 'access-point';
  return 'other';
}
```
<!-- /gen -->

1. The service prefixes are unambiguous and win: `INET :` is a WAN link, `WEB :` a web service and `SERVER :` a server. A name with `REPEATER` in it is a radio repeater.
2. Then the monitoring template: a FortiGate template means a firewall and a Cisco IOS template a switch.
3. Then words in the name: Aruba, WICTR or WAC for an access point, FW, FG, FGT or FORTI for a firewall, and SWITCH, SW, the CS and IE series, MOXA or BRIDGE for a switch.
4. A host on the Generic by SNMP template that the name does not place is taken as an access point. Everything else is `other`.

The same file holds `naturalCompare`, which sorts `1.2.2` before `1.2.10`, `categoryLabel`, which gives a template the label HCML's availability reports use, and `wanPairKey`, which reads `INET : SAMPANG WAN 1` and `WAN 2` as two legs of one path. Tests: `site-naming.test.ts`.

## Reading hosts, items and counts

### getHostOverview

`server/src/services/hosts.ts`. Every host with its state and its open problems.

<!-- gen:snippet server/src/services/hosts.ts#getHostOverview sha=61495f6d2fdb -->
`server/src/services/hosts.ts:50-74`

```ts
export async function getHostOverview() {
  const [hosts, problems, icmp] = await Promise.all([
    zbx<ZHost[]>('host.get', {
      output: ['hostid', 'name', 'status', 'maintenance_status'],
      selectInterfaces: ['ip', 'type', 'available'],
      sortfield: 'name',
    }),
    cachedProblems().then(openProblems),
    getIcmpByHost(),
  ]);

  const counts: Record<string, { total: number; bySeverity: Record<string, number> }> = {};
  for (const p of problems) {
    if (!p.hostid) continue;
    const c = (counts[p.hostid] ??= { total: 0, bySeverity: {} });
    c.total++;
    c.bySeverity[p.severity] = (c.bySeverity[p.severity] ?? 0) + 1;
  }

  return hosts.map((h) => ({
    ...h,
    ...hostState(h, icmp.get(h.hostid)),
    problems: counts[h.hostid] ?? { total: 0, bySeverity: {} },
  }));
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/hosts.ts#hostsOverviewView sha=1b6db486697c -->
`server/src/services/hosts.ts:219-219`

```ts
export const hostsOverviewView = () => cached('hosts:overview', 15_000, getHostOverview, SLOW_VIEW);
```
<!-- /gen -->

1. It makes three reads at the same time: all hosts with their interfaces, the shared problem list reduced to the open problems, and the ping readings.
2. It counts the open problems of each host, and by severity.
3. Each host leaves with its own fields, the `state` and `reason` from `hostState`, and its problem counts.
4. `hostsOverviewView` is what the route, the Devices page and the warm-up call. It holds the answer for 15 seconds and serves it stale for ten minutes, the `SLOW_VIEW` rule from the cache.

Tests: `devices-route.test.ts` and `routes.test.ts`.

### findItems

`server/src/services/hosts.ts`. The items of one host, which fill the picker on the Graphs page, or the named items of any host, which resolve a deep link. The search text is trimmed, and the cache key is `typed` because a caller makes it. Searching is limited to 120 a minute for each person (`security/searchLimit.ts`).

<!-- gen:snippet server/src/services/hosts.ts#isGraphable sha=d0ccca9d2631 -->
`server/src/services/hosts.ts:36-39`

```ts
export const isGraphable = (i: ZItem) =>
  (i.value_type === '0' || i.value_type === '3') &&
  (i.status ?? '0') === '0' &&
  (i.state ?? '0') === '0';
```
<!-- /gen -->

<!-- gen:snippet server/src/services/hosts.ts#findItems sha=2aa8e7fca21f -->
`server/src/services/hosts.ts:111-137`

```ts
export function findItems({ hostid, itemids, search, graphable }: ItemQuery) {
  const text = search?.trim() ?? '';
  const key = `items:${hostid ?? ''}:${text}:${graphable ? 1 : 0}:${itemids?.join(',') ?? ''}`;
  return cached(key, 30_000, async () => {
    const items = await zbx<ZItem[]>('item.get', {
      ...(hostid ? { hostids: [hostid] } : {}),
      ...(itemids ? { itemids, selectHosts: ['hostid', 'name'] } : {}),
      output: [
        'itemid',
        'name',
        'key_',
        'value_type',
        'units',
        'state',
        'status',
        'delay',
        'flags',
      ],
      selectTags: ['tag', 'value'],
      webitems: true,
      ...(text ? { search: { key_: text } } : {}),
      ...(graphable ? { filter: { value_type: ['0', '3'], status: '0', state: '0' } } : {}),
      sortfield: 'name',
    });
    return graphable ? items.filter(isGraphable) : items;
  }, { typed: true });
}
```
<!-- /gen -->

1. The cache key holds the host, the search text, the graphable flag and the item ids, so each different question is kept 30 seconds on its own. The list is the same for every role, and the route cuts the interface items for a viewer after this cache, so one entry serves all.
2. `graphable` asks Zabbix for numeric items only (value type 0, float, or 3, unsigned integer) that are enabled and supported, and `isGraphable` checks the answer again. A line chart cannot draw anything else.
3. It leaves out `lastvalue` and `lastclock` on purpose. Zabbix looks each one up on its own, 30 ms to 0.5 s for an item on HCML's, and a host of 609 graphable items took 20 to 32 seconds (tracker row BK-25). The picker needs names and ids, and the last values come from `/api/latest`.
4. `webitems: true` includes the web scenarios' items, which the Latest data page shows too.

Tests: `graphs.test.ts`.

### getLatestPage

`server/src/services/hosts.ts`. One page of the Latest data table, paged on the server. A page past the last is the last page, and `page` in the answer says which one it is. The search text is trimmed, and both keys are `typed`.

<!-- gen:snippet server/src/services/hosts.ts#getLatestPage sha=8fc3f49bad68 -->
`server/src/services/hosts.ts:160-194`

```ts
export function getLatestPage({ filter, hostid, groupid, needle: typedNeedle, page, pageSize, hide }: LatestPageQuery) {
  const needle = typedNeedle.trim();
  return cached(`latest:p:${hostid ?? ''}:${groupid ?? ''}:${needle}:${page}:${pageSize}:${hide ? 'v' : 'o'}`, 15_000, async () => {
    const all = await cached(`latest:ids:${hostid ?? ''}:${groupid ?? ''}:${needle}`, 15_000, async () => {
      const rows = await zbx<{ itemid: string; name: string; key_?: string }[]>('item.get', {
        output: ['itemid', 'name', 'key_'],
        ...filter,
        ...(needle ? { search: { name: needle, key_: needle }, searchByAny: true } : {}),
        monitored: true,
        webitems: true,
        limit: LATEST_ID_LIMIT,
      });
      return rows
        .sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.itemid, b.itemid))
        .map((r) => ({ id: r.itemid, net: isNetworkKey(r.key_) }));
    }, { typed: true });
    const ids = (hide ? all.filter((r) => !r.net) : all).map((r) => r.id);
    const total = ids.length;
    // A page past the end is the last one, so an old address or a list that shrank never reads as empty.
    const at = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const slice = ids.slice((at - 1) * pageSize, at * pageSize);
    let items: { itemid: string }[] = [];
    if (slice.length) {
      const details = await zbx<{ itemid: string }[]>('item.get', {
        itemids: slice,
        output: LATEST_OUTPUT,
        selectHosts: ['hostid', 'name'],
        webitems: true,
      });
      const byId = new Map(details.map((d) => [d.itemid, d]));
      items = slice.map((id) => byId.get(id)).filter((d): d is { itemid: string } => !!d);
    }
    return { items, truncated: all.length >= LATEST_ID_LIMIT, total, page: at, pageSize };
  }, { typed: true });
}
```
<!-- /gen -->

1. The first read is light. It asks for the id, name and key of every matching item, up to `LATEST_ID_LIMIT`, 20,000, narrowed by the host or the group (Zabbix needs one of them to bound the result), and by the search text, which matches the name or the key. It sorts them naturally by name and marks each one that is an interface item (`isNetworkKey`). That list is kept 15 seconds under its own key, so turning pages does not repeat it.
2. For a viewer (`hide`), the interface items are taken out before anything is counted. The total and the pages are then right, and the page is kept apart from an operator's (`v` and `o` in the key).
3. Only then does it cut the page and make the second read: `item.get` for the ids of that page alone, with the full fields (`LATEST_OUTPUT`) and the host.
4. `truncated` is true when the list reached the limit, so the screen can say it shows only part of the items. `getLatestItems`, in the same file, is the older read without a page that returns the first 500, kept for older callers.

Tests: `viewer-network.test.ts` and `routes.test.ts`.

### getStats

`server/src/services/reports.ts`. The Dashboard's counts: hosts, items, triggers, groups, problems, the unacknowledged ones and the problems by severity.

<!-- gen:snippet server/src/services/reports.ts#countIfReady sha=a617352ddd2a -->
`server/src/services/reports.ts:87-112`

```ts
async function countIfReady(what: Counted): Promise<number | null> {
  if (Date.now() - (failedAt.get(what) ?? 0) < COUNT_RETRY_MS) return null;
  const counted = count(what).then(
    (n) => {
      failedAt.delete(what);
      return n;
    },
    (err: unknown) => {
      failedAt.set(what, Date.now());
      cacheLogger()?.warn(
        { key: `counts:${what}`, reason: err instanceof Error ? err.message : String(err) },
        `stats: the ${what === 'items' ? 'item' : 'trigger'} count failed; it is tried again in 10 minutes`,
      );
      return null;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), COUNT_WAIT_MS);
  });
  try {
    return await Promise.race([counted, late]);
  } finally {
    clearTimeout(timer);
  }
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/reports.ts#getStats sha=5c69a39f56c8 -->
`server/src/services/reports.ts:115-141`

```ts
export function getStats() {
  return cached('stats', 30_000, async () => {
    const [hosts, items, triggers, groups, problems] = await Promise.all([
      // Monitored only, on all three cards: disabled hosts are left out, and so are templates' triggers, which watch no host.
      zbx<string>('host.get', { countOutput: true, monitored_hosts: true }),
      countIfReady('items'),
      countIfReady('triggers'),
      // `with_hosts`: its older name was deprecated in Zabbix 6.2.
      zbx<string>('hostgroup.get', { countOutput: true, with_hosts: true }),
      // The entry /api/problems and the stream already share, not another read.
      cachedProblems().then(openProblems),
    ]);

    const bySeverity: Record<string, number> = {};
    for (const p of problems) bySeverity[p.severity] = (bySeverity[p.severity] ?? 0) + 1;

    return {
      hosts: Number(hosts),
      items,
      triggers,
      groups: Number(groups),
      problems: problems.length,
      unacknowledged: problems.filter((p) => p.acknowledged !== '1').length,
      bySeverity,
    };
  });
}
```
<!-- /gen -->

1. The hosts, groups and problems are cheap. The item and trigger counts are not: counting every monitored item took HCML's Zabbix about 40 seconds and every monitored trigger 74 seconds. So `count` keeps each for an hour, serves it stale for up to a day while a new one is read, and allows the read `COUNT_TIMEOUT_MS`, 120 seconds.
2. `countIfReady` makes sure the Dashboard does not wait for that. It waits at most `COUNT_WAIT_MS`, two seconds, and returns null when the count is not ready. The count carries on and is there for the next call. After a failure with nothing held, Zabbix is not asked again for ten minutes (`COUNT_RETRY_MS`), and the failure is logged once.
3. So the first Dashboard after a start can show the Items and Triggers cards as "counting", and fills them in on a later poll.
4. Only monitored objects count: disabled hosts are left out, and so are the triggers of templates, which watch no host. The problems come from the shared `cachedProblems` and `openProblems`, so the Dashboard agrees with the Problems page. The whole answer is kept 30 seconds, and an acknowledge clears it. The two counts sit under keys of their own, so that clearing does not throw away a count that took a minute to make.

Tests: `statsItemCount.test.ts`.
