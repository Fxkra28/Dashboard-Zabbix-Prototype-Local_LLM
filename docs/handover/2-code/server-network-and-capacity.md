# Server: network and capacity

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 40 min | [Server: domain and hosts](server-domain-and-hosts.md) | [Server: SLA and reports](server-sla-and-reports.md) |

These services read the network side of HCML's estate: the interfaces of a switch, the ping links, the Internet traffic gauges, and the Capacity report over days of history. The first three are for the `wall` role and above, because `/api/net` and `/api/links` start there in the route rules. Everything is read from Zabbix, and nothing is stored. The code is plain functions in `server/src/services/`: `net.ts`, `links.ts`, `meters.ts` and `capacity.ts`, with `reportPolicy.ts` for the slow reports.

## Interfaces and devices

### parseIfKey and parseIfName

`server/src/services/net.ts`. Read an interface's number and its name out of Zabbix's item keys and item names.

<!-- gen:snippet server/src/services/net.ts#parseIfKey sha=20d671d50823 -->
`server/src/services/net.ts:57-63`

```ts
export function parseIfKey(key: string): { kind: string; index: number } | null {
  const m = /^net\.if\.([a-z.]+?)\[([^,\]]*)/.exec(key);
  if (!m || m[1].endsWith('walk')) return null;
  const idx = /\.(\d+)$/.exec(m[2].trim());
  if (!idx) return null;
  return { kind: m[1], index: Number(idx[1]) };
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/net.ts#parseIfName sha=0e3f38d9b775 -->
`server/src/services/net.ts:66-71`

```ts
export function parseIfName(itemName: string): { name: string; alias: string } | null {
  const m = /^Interface\s+([^(]+?)\s*\((.*)\):\s/.exec(itemName);
  if (m) return { name: m[1].trim(), alias: m[2].trim() };
  const plain = /^Interface\s+(.+?):\s/.exec(itemName);
  return plain ? { name: plain[1].trim(), alias: '' } : null;
}
```
<!-- /gen -->

1. Zabbix discovers about nine `net.if.*` items for each interface of an SNMP device, so the core switch has 1,119 items and about 122 interfaces. The number the items share is the SNMP `ifIndex`, and it is the last number in the key.
2. `parseIfKey` reads `net.if.in[ifHCInOctets.33]` as kind `in` and index 33. A key without an index, and the walk and master items, give null and are skipped.
3. `parseIfName` reads the name and the alias out of the item name. `Interface Gi1/0/1(Uplink (core)): Bits received` gives the name `Gi1/0/1` and the alias `Uplink (core)`. A name without brackets has an empty alias.

### groupInterfaces

`server/src/services/net.ts`. Folds the items of one host into one row for each interface. It is a pure function, so a test gives it items and a time.

<!-- gen:snippet server/src/services/net.ts#groupInterfaces lines=26-34 sha=f9e57e0743cf -->
`server/src/services/net.ts:102-110` (lines 26 to 34 of groupInterfaces)

```ts
const label = parseIfName(it.name);
if (label && !row.name) {
  row.name = label.name;
  row.alias = label.alias;
}
const fresh = isFresh(it, now);
const value = fresh && it.lastvalue !== '' ? Number(it.lastvalue) : null;
const num = value !== null && Number.isFinite(value) ? value : null;
if (fresh) row.lastclock = Math.max(row.lastclock ?? 0, Number(it.lastclock));
```
<!-- /gen -->

<!-- gen:snippet server/src/services/net.ts#groupInterfaces lines=36-67 sha=f9e57e0743cf -->
`server/src/services/net.ts:112-143` (lines 36 to 67 of groupInterfaces)

```ts
switch (k.kind) {
  case 'in':
    row.itemids.in = it.itemid;
    row.inBps = num;
    break;
  case 'out':
    row.itemids.out = it.itemid;
    row.outBps = num;
    break;
  case 'status':
    row.itemids.status = it.itemid;
    row.operStatus = fresh ? (OPER_STATUS[it.lastvalue] ?? 'unknown') : 'unknown';
    break;
  case 'speed':
    row.itemids.speed = it.itemid;
    row.speed = num !== null && num > 0 ? num : null;
    break;
  case 'in.errors':
    row.itemids.inErrors = it.itemid;
    row.inErrors = num;
    break;
  case 'out.errors':
    row.itemids.outErrors = it.itemid;
    row.outErrors = num;
    break;
  case 'in.discards':
    row.inDiscards = num;
    break;
  case 'out.discards':
    row.outDiscards = num;
    break;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/net.ts#groupInterfaces lines=69-76 sha=f9e57e0743cf -->
`server/src/services/net.ts:145-152` (lines 69 to 76 of groupInterfaces)

```ts
  const out = [...rows.values()];
  for (const r of out) {
    if (!r.name) r.name = `ifIndex ${r.index}`;
    const peak = Math.max(r.inBps ?? -1, r.outBps ?? -1);
    r.utilisation = r.speed && peak >= 0 ? Math.round((peak / r.speed) * 10_000) / 100 : null;
  }
  return out.sort((a, b) => naturalCompare(a.name, b.name) || a.index - b.index);
}
```
<!-- /gen -->

1. Above these lines, the loop keeps one row for each `ifIndex`. A new row starts with every figure null and the status `unknown`, so an interface Zabbix has not answered for shows nothing, and does not show a zero.
2. The first item whose name parses gives the row its name and alias. A value counts only while it is fresh (`isFresh`), and `lastclock` of the row is the newest fresh clock among its items.
3. The `switch` puts each item in its place. `in` and `out` are the rates in bits a second. `status` is turned into a word from the IF-MIB code (1 is up, 2 down, 7 lowerLayerDown, and so on) and is `unknown` when it is not fresh. `speed` counts only above zero. The error and discard counters follow. The item ids of the rate, the status, the speed and the errors are kept, so a screen can link a row to its graph.
4. At the end a row with no name is called `ifIndex 33`. Utilisation is the busier direction divided by the speed, as a percentage to two decimals, and null when the speed or both rates are missing. The rows are sorted naturally by name, so `Gi1/0/2` comes before `Gi1/0/10`.

### getNetDevices and getInterfacePage

`server/src/services/net.ts`. The Network page's device list, and one page of a device's interfaces.

<!-- gen:snippet server/src/services/net.ts#getNetDevices sha=e37cf0033197 -->
`server/src/services/net.ts:158-189`

```ts
export function getNetDevices() {
  return cached('net:devices', 30_000, async () => {
    const hostParams: Record<string, unknown> = {
      output: ['hostid', 'name', 'status'],
      selectInterfaces: ['ip', 'type'],
      sortfield: 'name',
    };
    if (config.netGroupIds.length) hostParams.groupids = config.netGroupIds;

    // ICMP items: icmpping (up/down), icmppingloss (%), icmppingsec (latency), read once for
    // every monitored host and shared with Sites and Hosts. A value is only believed while fresh:
    // collected, supported and recent. `lastclock '0'` (never polled / no recent data) is
    // `unknown`, not `lastvalue ''` read as "down", and so is a value hours old.
    const [hosts, icmp] = await Promise.all([
      zbx<{ hostid: string; name: string; status: string }[]>('host.get', hostParams),
      getIcmpByHost(),
    ]);

    return hosts
      .map((h) => {
        const r = icmp.get(h.hostid);
        // Loss and latency stay on this route, which starts at the wall role; the viewer
        // routes (Sites, Hosts) carry only the derived state.
        return {
          ...h,
          site: siteFromHostName(h.name),
          icmp: r ? { up: r.up, loss: r.loss, latency: r.latency, state: r.state } : null,
        };
      })
      .sort((a, b) => naturalCompare(a.name, b.name));
  }, SLOW_VIEW);
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/net.ts#getInterfacePage sha=0d52a22536cc -->
`server/src/services/net.ts:204-238`

```ts
export async function getInterfacePage({ hostid, search, status: wanted, page, pageSize }: InterfaceQuery) {
  const rows = await cached(
    `net:interfaces:${hostid}`,
    15_000,
    async () =>
      groupInterfaces(
        await zbx<ZIfItem[]>('item.get', {
          hostids: [hostid],
          search: { key_: 'net.if.' },
          startSearch: true,
          output: ['itemid', 'name', 'key_', 'lastvalue', 'lastclock', 'units', 'value_type', 'state', 'status'],
        }),
      ),
    { ...SLOW_VIEW, typed: true },
  );

  const needle = search?.trim().toLowerCase() ?? '';
  const searched = needle
    ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.alias.toLowerCase().includes(needle))
    : rows;
  const summary = { up: 0, down: 0, other: 0 };
  for (const r of searched) summary[statusBucket(r.operStatus)]++;
  const status = wanted === 'up' || wanted === 'down' || wanted === 'other' ? wanted : undefined;
  const filtered = status ? searched.filter((r) => statusBucket(r.operStatus) === status) : searched;

  // A page past the end is the last one, so an old address or a list that shrank never reads as empty.
  const at = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  return {
    rows: filtered.slice((at - 1) * pageSize, at * pageSize),
    total: filtered.length,
    summary,
    page: at,
    pageSize,
  };
}
```
<!-- /gen -->

1. `getNetDevices` asks `host.get` for the hosts and reads the ping readings once, at the same time. When `NET_GROUP_IDS` is set, only the hosts in those groups are asked for. An empty setting means every host. Each device leaves with its site, from its name, and its ping: `up`, `loss`, `latency` and `state`. Loss and latency stay on this route because it starts at the wall role, and the viewer routes carry the state alone. The list is kept 30 seconds under the `SLOW_VIEW` rule.
2. `getInterfacePage` reads every `net.if.` item of one host with `item.get`, folds them with `groupInterfaces`, and keeps the rows 15 seconds for each host, also under `SLOW_VIEW`. The host is chosen by the caller, so the key is also marked `typed`: at most 150 such entries are kept, and they go first, so asking for many hosts cannot push the problem list and the host list out of the cache.
3. The search is applied to the name and the alias. The summary counts the searched rows by `statusBucket` (up, down, other, where `lowerLayerDown` counts as down), so the tabs show the counts for the search. Only then is the status filter applied, the total counted and the page cut. A page past the last is the last page, and `page` in the answer says which one it is, so an old address or a list that shrank never reads as empty.

Tests: `routes.test.ts`, `graphs.test.ts` and `viewer-network.test.ts` call these through the routes. Nothing tests `groupInterfaces` on its own.

## Links

`server/src/services/links.ts`. A link here is one path that Zabbix pings. The portal never speaks ICMP itself: Zabbix polls, and this reads the items. HCML runs 12 main and 10 redundant SD-WAN links, 10 point-to-point radio links, 18 Internet accesses and Starlink at the offshore sites, and a link with high packet loss deserves a view of its own.

### classify and getLinks

<!-- gen:snippet server/src/services/links.ts#classify sha=25d021f6b177 -->
`server/src/services/links.ts:95-103`

```ts
function classify(up: boolean | undefined, loss: number | undefined): LinkState {
  if (up === false) return 'down';
  if (loss !== undefined) {
    if (loss >= config.links.lossCrit) return 'down';
    if (loss >= config.links.lossWarn) return 'degraded';
  }
  if (up === undefined && loss === undefined) return 'unknown';
  return 'up';
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/links.ts#getLinks lines=1-23 sha=7c96e26baa68 -->
`server/src/services/links.ts:128-150` (lines 1 to 23 of getLinks)

```ts
export async function getLinks(): Promise<LinksResponse> {
  // The values come from the ping readings the host states share, not from Zabbix's slow `lastvalue`.
  const [catalog, values] = await Promise.all([linkItems(), getIcmpValues()]);
  const items: ZItem[] = catalog.map((i) => {
    const v = values.get(i.itemid);
    return { ...i, lastvalue: v?.value ?? '', lastclock: v?.clock ?? '0' };
  });

  // One link = one (host, ping target) pair; its three metrics arrive as
  // separate items that have to be stitched back together.
  const groups = new Map<string, { host: { hostid: string; name: string }; target: string; items: ZItem[] }>();

  for (const item of items) {
    const host = item.hosts?.[0];
    if (!host) continue;
    const { name, params } = parseKey(item.key_);
    if (!name.startsWith('icmpping')) continue;
    const target = params[0] ?? '';
    const id = `${host.hostid}:${target}`;
    const g = groups.get(id) ?? { host, target, items: [] };
    g.items.push(item);
    groups.set(id, g);
  }
```
<!-- /gen -->

1. The values come from `getIcmpValues`, the read the host states share, and the list of items from `linkItems`. That list is kept an hour, may be served for a day, is pinned, and is cut to `NET_GROUP_IDS` when it is set. It asks for `monitored` items, because without it Zabbix also returns hundreds of identical items from templates.
2. One link is one pair of a host and a ping target. Its three metrics arrive as separate items, `icmpping`, `icmppingloss` and `icmppingsec`, so the loop above collects the items under the id `<hostid>:<target>`. The target is the first parameter in the key.
3. `classify` turns a link's figures into a state. A ping that is down is `down`. Otherwise packet loss decides: `LINK_LOSS_CRIT` (default 10 percent) or more is `down`, and `LINK_LOSS_WARN` (default 2 percent) or more is `degraded`. With no ping and no loss figure the link is `unknown`.

<!-- gen:snippet server/src/services/links.ts#getLinks lines=37-64 sha=7c96e26baa68 -->
`server/src/services/links.ts:164-191` (lines 37 to 64 of getLinks)

```ts
for (const item of g.items) {
  const { name, params } = parseKey(item.key_);
  // No collected value is not a value of 0. Zabbix reports lastvalue "0" with lastclock "0" for
  // an item that has never collected, and keeps the last value of an unsupported item; both
  // would classify as down and put links that were simply never polled at the top of the list
  // as outages (42 of them on HCML's data). Without fresh data the metric is unknown. "Fresh"
  // is also recent: a value hours old (the poller stopped, or the host was unreachable to
  // Zabbix) is judged by the same rule the Sites page applies.
  const fresh = isFresh(item, now);
  const v = fresh ? num(item.lastvalue) : undefined;
  for (const t of item.tags ?? []) tags[t.tag] = t.value;
  if (fresh && (!lastclock || Number(item.lastclock) > Number(lastclock))) lastclock = item.lastclock;

  if (name === 'icmpping') {
    up = v === undefined ? undefined : v === 1;
    label ||= item.name;
  } else if (name === 'icmppingloss') {
    loss = v;
    // The loss item usually carries the most descriptive name, HCML's own
    // example is "SD-WAN (to_mda_via_sapudi)(internal4)".
    if (item.name) label = item.name;
  } else if (name === 'icmppingsec') {
    const mode = params[5] || 'avg';
    if (mode === 'min') rttMin = v;
    else if (mode === 'max') rttMax = v;
    else latency = v;
  }
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/links.ts#getLinks lines=97-126 sha=7c96e26baa68 -->
`server/src/services/links.ts:224-253` (lines 97 to 126 of getLinks)

```ts
  // Paired paths: a main + redundant pair is only really down when both legs
  // are. That distinction is the whole point of paying for redundancy.
  const byGroup = new Map<string, Link[]>();
  for (const l of links) {
    if (!l.group) continue;
    const members = byGroup.get(l.group);
    if (members) members.push(l);
    else byGroup.set(l.group, [l]);
  }
  const paths: LinkPath[] = [...byGroup.entries()]
    .map(([name, members]) => ({
      name,
      links: members,
      state: members.some((m) => m.state === 'up')
        ? members.every((m) => m.state === 'up')
          ? ('up' as LinkState)
          : ('degraded' as LinkState)
        : members.some((m) => m.state === 'degraded')
          ? ('degraded' as LinkState)
          : members.every((m) => m.state === 'unknown')
            ? ('unknown' as LinkState)
            : ('down' as LinkState),
    }))
    .sort((a, b) => RANK[b.state] - RANK[a.state] || a.name.localeCompare(b.name));

  const summary = { total: links.length, up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const l of links) summary[l.state]++;

  return { links, paths, summary, thresholds: config.links };
}
```
<!-- /gen -->

1. The metric loop goes through the items of one link. A value is used only when it is fresh. Zabbix reports `lastvalue` 0 with `lastclock` 0 for an item that has never collected, and keeps the last value of an unsupported item. Both would classify as down, and 42 links that were never polled once sat at the top of the list as outages on HCML's data. Without fresh data the metric is unknown.
2. The ping item gives `up`. The loss item gives `loss`, and its name is the better label for the link. The response-time item gives the latency, or, when its key has the mode `min` or `max` in the sixth parameter, the two ends of the jitter. Zabbix stores seconds and `toMs` turns them into milliseconds, rounded to two places so a float tail never reaches the API.
3. A link's group and role come from the item tags `link_group` and `link_role`. HCML tags none, so the code falls back on the host name: `wanPairKey` reads `INET : SAMPANG WAN 1` and `WAN 2` as two legs of one path.
4. Links are sorted worst first, then by loss, then by label, because the top of the list is what a person in the control room reads.
5. A path is a group of links. It is `up` when every leg is up, `degraded` when some legs are up or any is degraded, `unknown` when every leg is unknown, and `down` otherwise. A pair is down only when both legs are, which is what the second link is paid for.
6. `linksView` keeps the whole answer 20 seconds, and the warm-up reads it after a start.

Tests: `routes.test.ts` and `api-hygiene.test.ts`. The thresholds are checked against the compose file by `compose-env.test.ts`.

## Internet traffic meters

`server/src/services/meters.ts`. The gauges on the Internet page. The code does not keep a second list of links and capacities. It reads the gauge widgets of the Zabbix dashboard that HCML already keeps, named by `INTERNET_METERS_DASHBOARD` (default `Global view`), with `dashboard.get`. The dashboard and the neighbours of its items are kept two minutes. The file puts the pure parts first, reading the widgets and deciding what a reading means, and the calls to Zabbix last.

### definitionsFrom

<!-- gen:snippet server/src/services/meters.ts#definitionsFrom sha=cd9af06c4b8d -->
`server/src/services/meters.ts:125-164`

```ts
export function definitionsFrom(dashboard: ZDashboard): MeterDefinition[] {
  const out: MeterDefinition[] = [];
  const seen = new Set<string>();
  (dashboard.pages ?? []).forEach((page, pageIndex) => {
    const widgets = (page.widgets ?? [])
      .filter((w) => w.type === 'gauge')
      .sort((a, b) => Number(a.y ?? 0) - Number(b.y ?? 0) || Number(a.x ?? 0) - Number(b.x ?? 0));
    for (const w of widgets) {
      const fields = w.fields ?? [];
      const get = (name: string) => fields.find((f) => f.name === name)?.value;
      const itemid = fields.find((f) => f.type === FIELD_ITEM)?.value ?? null;
      const title = (w.name ?? '').trim();
      const key = itemid ? `item:${itemid}` : `title:${titleKey(title)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const byIndex = new Map<string, { threshold?: string; color?: string }>();
      for (const f of fields) {
        const m = /^thresholds\.(\d+)\.(threshold|color)$/.exec(f.name);
        if (!m) continue;
        const entry = byIndex.get(m[1]) ?? {};
        entry[m[2] as 'threshold' | 'color'] = f.value;
        byIndex.set(m[1], entry);
      }
      const thresholds = [...byIndex.values()].flatMap((t) =>
        t.threshold !== undefined && t.color !== undefined ? [{ threshold: t.threshold, color: t.color }] : [],
      );

      out.push({
        title,
        page: page.name?.trim() || `Page ${pageIndex + 1}`,
        itemid,
        min: get('min'),
        max: get('max'),
        thresholds,
      });
    }
  });
  return out;
}
```
<!-- /gen -->

1. It takes the gauge widgets, in the order a person reads a dashboard: page by page, the top row first, left to right.
2. There is one meter for each item. A later page that repeats an item adds nothing, and a widget with no item is repeated only by its title, compared by its letters and digits (`titleKey`), so `Site Two Internet#2` and `SITE TWO INTERNET 2` are one.
3. The widget's fields hold the scale: `min`, `max` and a numbered list of thresholds, each with a number and a colour. The loop pairs `thresholds.0.threshold` with `thresholds.0.color` and drops a half-pair.
4. The result still holds text. `parseScale` turns a scale number into a number later: plain, or with a K, M, G or T suffix, counted in 1,000s for rates and 1,024s for bytes. Anything else gives null, so a typo makes the meter `invalid` and does not draw a wrong scale.

### levelOfColor, linkOf and pairSiblings

<!-- gen:snippet server/src/services/meters.ts#levelOfColor sha=78064e08cf59 -->
`server/src/services/meters.ts:184-207`

```ts
export function levelOfColor(hex: string): ZoneLevel {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'none';
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const lightness = (max + min) / 2;
  const saturation = d === 0 ? 0 : d / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.25) return 'none';
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 20 || hue >= 340) return 'critical';
  if (hue < 70) return 'warn';
  if (hue < 170) return 'ok';
  if (hue < 290) return 'low';
  return 'none';
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/meters.ts#linkOf sha=5a0388f3631d -->
`server/src/services/meters.ts:250-254`

```ts
export function linkOf(status: number | null | undefined): LinkStatus {
  if (status === 1) return 'up';
  if (status === 2 || status === 7) return 'down';
  return 'unknown';
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/meters.ts#pairSiblings sha=858be32a203c -->
`server/src/services/meters.ts:427-451`

```ts
export function pairSiblings(mains: Keyed[], found: Keyed[]): Record<string, SiblingIds> {
  const byHost = new Map<string, { item: Keyed; kind: string; index: number }[]>();
  for (const item of found) {
    const k = parseIfKey(item.key_);
    if (!k) continue;
    const list = byHost.get(item.hostid) ?? [];
    list.push({ item, kind: k.kind, index: k.index });
    byHost.set(item.hostid, list);
  }
  const out: Record<string, SiblingIds> = {};
  for (const main of mains) {
    const k = parseIfKey(main.key_);
    if (!k || (k.kind !== 'in' && k.kind !== 'out')) continue;
    const here = (byHost.get(main.hostid) ?? []).filter((f) => f.index === k.index && f.item.itemid !== main.itemid);
    const best = (kind: string, prefer: (key: string) => number) =>
      here
        .filter((f) => f.kind === kind)
        .sort((a, b) => prefer(b.item.key_) - prefer(a.item.key_) || Number(a.item.itemid) - Number(b.item.itemid))[0]?.item.itemid ?? null;
    out[main.itemid] = {
      statusId: best('status', (key) => (/ifOperStatus/.test(key) ? 1 : 0)),
      otherId: best(k.kind === 'in' ? 'out' : 'in', (key) => (hc(key) === hc(main.key_) ? 1 : 0)),
    };
  }
  return out;
}
```
<!-- /gen -->

1. `levelOfColor` keeps only what a zone's colour means, because the page draws its own palette. It converts the colour to hue and saturation. Grey and weakly saturated colours are `none`. Red (hue under 20 or from 340) is `critical`, orange and yellow up to 70 are `warn`, green up to 170 is `ok`, and blue up to 290 is `low`.
2. `buildZones` sorts the thresholds into zones, lowest first, and puts a `none` zone below the first threshold when that is above the minimum. `zoneOf` takes the last zone that starts at or below a value.
3. `linkOf` reads the interface's own status item. 1 is up, 2 and 7 are down, and anything else claims nothing. This is what stops a down interface, which reads 0 bits, from being shown as an idle link that is Low at 0 percent (tracker row MT-04).
4. `pairSiblings` finds, for each widget item, the status item and the item of the opposite direction of the same interface, on the same host with the same `ifIndex`. With several candidates the operational status wins over the administrative one, then the same counter width (64-bit or 32-bit), then the lowest id. The opposite direction is what lets a link that is full the other way read as busy.

### buildMeter, readings and getMeters

<!-- gen:snippet server/src/services/meters.ts#readings sha=b07d7ad86af7 -->
`server/src/services/meters.ts:488-519`

```ts
async function readings(items: ZMeterItem[]): Promise<Map<string, Reading | null>> {
  const out = new Map<string, Reading | null>();
  const fromHistory: ZMeterItem[] = [];
  for (const it of items) {
    const clock = Number(it.lastclock);
    const value = Number(it.lastvalue);
    if (it.status === '1' || it.state === '1') out.set(it.itemid, null);
    else if (clock > 0 && it.lastvalue !== undefined && it.lastvalue !== '' && Number.isFinite(value)) {
      out.set(it.itemid, { value, clock });
    } else fromHistory.push(it);
  }
  const gate = createGate(HISTORY_AT_ONCE);
  await Promise.all(
    fromHistory.map((it) =>
      gate.run(async () => {
        const type = Number(it.value_type);
        if (type !== 0 && type !== 3) return void out.set(it.itemid, null); // text and log items have no number to draw
        const [row] = await zbx<{ clock: string; value: string }[]>('history.get', {
          history: type,
          itemids: [it.itemid],
          sortfield: 'clock',
          sortorder: 'DESC',
          limit: 1,
          output: ['clock', 'value'],
        });
        const value = Number(row?.value);
        out.set(it.itemid, row && Number.isFinite(value) ? { value, clock: Number(row.clock) } : null);
      }),
    ),
  );
  return out;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/meters.ts#getMeters sha=4071d3b42296 -->
`server/src/services/meters.ts:521-565`

```ts
export async function getMeters(): Promise<MetersResponse> {
  const name = config.meters.dashboard;
  const now = Math.floor(Date.now() / 1000);
  const defs = await cached(`meters:definitions:${name}`, 120_000, () => loadDefinitions(name));
  if (!defs) return { dashboard: name, found: false, generatedAt: now, meters: [], summary: summarise([]) };

  const itemids = [...new Set(defs.flatMap((d) => (d.itemid ? [d.itemid] : [])))];
  const items = itemids.length
    ? await zbx<ZMeterItem[]>('item.get', {
        itemids,
        output: ['itemid', 'hostid', 'name', 'key_', 'units', 'value_type', 'delay', 'status', 'state', 'lastvalue', 'lastclock'],
        selectHosts: ['name'],
      })
    : [];
  const byId = new Map(items.map((i) => [i.itemid, i]));
  const found = await readings(items);

  // Neighbours are read from the item only: a status or a figure from days ago says nothing about the link today.
  const pairs = items.length ? await cached(`meters:siblings:${name}:${itemids.join(',')}`, 120_000, () => findSiblings(items)) : {};
  const neighbourIds = [...new Set(Object.values(pairs).flatMap((p) => [p.statusId, p.otherId].filter((id): id is string => id !== null)))];
  const neighbours = neighbourIds.length
    ? await zbx<ZSiblingItem[]>('item.get', {
        itemids: neighbourIds,
        output: ['itemid', 'key_', 'delay', 'status', 'state', 'lastvalue', 'lastclock'],
      })
    : [];
  const neighbourById = new Map(neighbours.map((i) => [i.itemid, i]));

  const meters = defs.map((d) => {
    const item = d.itemid ? byId.get(d.itemid) : undefined;
    const reading = item ? (found.get(item.itemid) ?? null) : null;
    const fresh =
      item !== undefined &&
      reading !== null &&
      isFresh({ lastclock: String(reading.clock), state: item.state, delay: item.delay }, now);
    const ids = item ? pairs[item.itemid] : undefined;
    const otherItem = ids?.otherId ? neighbourById.get(ids.otherId) : undefined;
    const siblings: Siblings = {
      status: currentReading(ids?.statusId ? neighbourById.get(ids.statusId) : undefined, now)?.value ?? null,
      ...(otherItem ? { other: { itemid: otherItem.itemid, reading: currentReading(otherItem, now) } } : {}),
    };
    return buildMeter(d, item, reading, fresh, siblings);
  });
  return { dashboard: name, found: true, generatedAt: now, meters, summary: summarise(meters) };
}
```
<!-- /gen -->

1. `buildMeter` makes one meter from the widget, its item and its newest reading. The `state` says how far to trust it:

| State | Meaning |
|---|---|
| `ok` | A current reading on a usable scale |
| `stale` | An old reading. The value and its time are still given |
| `nodata` | The item exists and has never produced a value |
| `unsupported` | The item is disabled, or Zabbix cannot collect it |
| `missing` | The widget's item is gone from Zabbix |
| `invalid` | The scale has no maximum, or one that is not above the minimum |

2. `readings` takes the value Zabbix holds when there is one. Zabbix keeps a last value for only a day, so for an item without one it reads the newest history row, one item at a time, `HISTORY_AT_ONCE` (8) at once through a gate. A silent link then shows when it last spoke. Text and log items have no number to draw and are skipped.
3. `getMeters` runs the steps in order: the definitions (kept two minutes), the widget items with `item.get`, their readings, the neighbour ids (`findSiblings`, also kept two minutes), the neighbours' values, and then `buildMeter` for each widget. A neighbour is read from the item only, because a status or a figure from days ago says nothing about the link today.
4. `summarise` counts the meters: how many are current, how many in a red or yellow zone, stale, unavailable, down, and how many have their other direction high. `metersView` keeps the answer 30 seconds under `SLOW_VIEW`.

Tests: `meters.test.ts` for the pure parts and `meters-route.test.ts` for the route.

## The Capacity report

`server/src/services/capacity.ts`. The busiest hosts by CPU, memory, disk and interface use over a number of days, read from Zabbix's trends. The page asks for 7 days and the top 10 (`CAPACITY_DAYS` and `CAPACITY_TOP`), and the route accepts 1 to 365 days and 1 to 50 rows.

### Which items count

<!-- gen:snippet server/src/services/capacity.ts#capacityMetricFor sha=814f0bba18ad -->
`server/src/services/capacity.ts:72-74`

```ts
export function capacityMetricFor(key: string): string | undefined {
  return METRICS.find((m) => key.startsWith(m.search) && m.match(key))?.key;
}
```
<!-- /gen -->

HCML's estate is nearly all SNMP devices, whose templates put an OID in the key. The matchers in `METRICS` accept the Linux-agent forms and the SNMP forms:

| Metric | Keys it picks up | Note |
|---|---|---|
| `cpu` | `system.cpu.util`, and `system.cpu.util[<an OID>]` | `system.cpu.util[,idle]` must not match: it is the idle share, the opposite of what the report wants |
| `memory` | `vm.memory.util`, `vm.memory.utilization`, `vm.memory.util[<an OID>]` | |
| `disk` | `vfs.fs.*[...,pused]` | |
| `disk` (FortiGate) | `vfs.fs.pfree` | It reports free space only, so used is 100 minus free |

`capacityMetricFor(key)` tells which metric a key belongs to, and exists for the tests.

### getCapacity

<!-- gen:snippet server/src/services/capacity.ts#getCapacity lines=29-44 sha=463bc5573e3c -->
`server/src/services/capacity.ts:134-149` (lines 29 to 44 of getCapacity)

```ts
// Every metric's trends in one sliced read, so a long window stays within
// what Zabbix's PHP can answer (a year in one request was an HTTP 500) and
// at most `maxParallel` requests run at once, whatever the metric count.
const trendAgg: Aggregates = new Map();
await fetchTrendsSliced<{ itemid: string; value_avg: string; value_max: string }>(
  [...new Set(matched.flat().map((i) => i.itemid))],
  from,
  to,
  ['itemid', 'value_avg', 'value_max'],
  {
    parallel: config.sla.maxParallel,
    onRows: (rows) => {
      for (const r of rows) addSample(trendAgg, r.itemid, Number(r.value_avg), Number(r.value_max));
    },
  },
);
```
<!-- /gen -->

<!-- gen:snippet server/src/services/capacity.ts#getCapacity lines=51-75 sha=463bc5573e3c -->
`server/src/services/capacity.ts:156-180` (lines 51 to 75 of getCapacity)

```ts
// Trends are hourly and only exist once an hour has passed; a young
// instance has history but no trends, so fall back rather than show
// an empty report.
let agg = trendAgg;
let source: CapacityRow['source'] = items.some((i) => trendAgg.has(i.itemid)) ? 'trend' : 'history';

if (source === 'history') {
  // Only the most recent day, not the whole requested window. No trends
  // means the instance is young, so that is where its history actually
  // is, and pulling 50k raw rows into the BFF to compute an average
  // Zabbix could have aggregated is exactly what setup.md §18 warns
  // against. Raw history is the degraded path; keep it cheap.
  const histFrom = Math.max(from, to - 86_400);
  const hist = await zbx<{ itemid: string; value: string }[]>('history.get', {
    itemids: items.map((i) => i.itemid),
    history: Number(items[0].value_type) === 3 ? 3 : 0,
    time_from: histFrom,
    time_till: to,
    output: 'extend',
    limit: HISTORY_FALLBACK_LIMIT,
  });
  if (!hist.length) source = 'none';
  agg = new Map();
  for (const h of hist) addSample(agg, h.itemid, Number(h.value), Number(h.value));
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/capacity.ts#getCapacity lines=104-127 sha=463bc5573e3c -->
`server/src/services/capacity.ts:209-232` (lines 104 to 127 of getCapacity)

```ts
  // One row per host per metric: a switch with two CPU modules or a
  // "reserve Processor" memory pool is one device, shown by its busiest item.
  const byMetric = new Map<string, { label: string; rows: CapacityRow[] }>();
  for (const { key, label, rows } of perMatcher) {
    const entry = byMetric.get(key) ?? { label, rows: [] };
    entry.rows.push(...rows);
    byMetric.set(key, entry);
  }
  const metrics = [...byMetric.entries()].map(([key, { label, rows }]) => {
    const best = new Map<string, CapacityRow>();
    for (const r of rows) {
      const prev = best.get(r.hostid || r.itemid);
      if (!prev || r.avg > prev.avg) best.set(r.hostid || r.itemid, r);
    }
    return {
      key,
      label,
      rows: [...best.values()].sort((a, b) => b.avg - a.avg).slice(0, top),
    };
  });

  metrics.push(await interfaceUtilisation(from, to, top));
  return { days, metrics };
}
```
<!-- /gen -->

1. For each metric, one `item.get` finds the monitored items by key prefix (a substring search would scan every item) and keeps those whose key the matcher accepts.
2. The trends of all those items are read in one sliced read, `fetchTrendsSliced` from `sli/events.ts`. A year of trends in one request once gave an HTTP 500 from Zabbix's PHP, so the window is split and at most `SLI_ZBX_PARALLEL` (default 4) requests run at once. Each row is folded into a running sum and maximum as it arrives (`addSample`), so a year of trends is never held in memory.
3. Trends are hourly and exist only after an hour has passed. A young instance has history and no trends, so the code falls back on the raw history of the last day only, capped at `HISTORY_FALLBACK_LIMIT` (10,000 rows). Pulling tens of thousands of raw rows into the server to average what Zabbix could have averaged is the thing to avoid. Each row says where it came from in `source`: `trend`, `history` or `none`.
4. A switch with two CPU modules, or a "reserve Processor" memory pool, is one device. The last step keeps one row for each host and metric, the item with the highest average, sorts by average and cuts to `top`. The FortiGate disk rows are turned from free into used, and as the largest free value is the smallest used one, their `max` is kept at least equal to the average.
5. The interface panel is added at the end by `interfaceUtilisation`.

### interfaceUtilisation

<!-- gen:snippet server/src/services/capacity.ts#interfaceUtilisation lines=16-38 sha=1a1525e89873 -->
`server/src/services/capacity.ts:254-276` (lines 16 to 38 of interfaceUtilisation)

```ts
// A port's speed changes only when the port does, and its 3,048 values cost minutes a run on HCML's Zabbix.
const speedsHeld = cached('capacity:speeds', SPEEDS_TTL_MS, () => read('net.if.speed['), { staleMs: SPEEDS_TTL_MS, staleIfError: true, pin: true });
const [ins, outs, speeds] = await Promise.all([read('net.if.in['), read('net.if.out['), speedsHeld]);

const index = (k: string) => /\.(\d+)\]$/.exec(k)?.[1];
const hostOf = (i: ZIf) => i.hosts?.[0]?.hostid ?? '';
const speedOf = new Map(speeds.map((s) => [`${hostOf(s)}:${index(s.key_)}`, Number(s.lastvalue)]));
const outOf = new Map(outs.map((o) => [`${hostOf(o)}:${index(o.key_)}`, o]));

// Errors and discards share the prefix; only octet counters are traffic.
const traffic = ins.filter((i) => /octets/i.test(i.key_) && index(i.key_));
const candidates = traffic
  .map((i) => {
    const id = `${hostOf(i)}:${index(i.key_)}`;
    const speed = speedOf.get(id) ?? 0;
    const out = outOf.get(id);
    const latest = Math.max(Number(i.lastvalue) || 0, Number(out?.lastvalue) || 0);
    return { in: i, out, speed, latest: speed > 0 ? latest / speed : 0 };
  })
  .filter((c) => c.speed > 0 && c.latest > 0)
  .sort((a, b) => b.latest - a.latest)
  .slice(0, Math.max(top * 4, 40));
if (!candidates.length) return { key: 'ifutil', label, rows: [] };
```
<!-- /gen -->

<!-- gen:snippet server/src/services/capacity.ts#interfaceUtilisation lines=63-89 sha=1a1525e89873 -->
`server/src/services/capacity.ts:301-327` (lines 63 to 89 of interfaceUtilisation)

```ts
const pct = (itemid: string | undefined, speed: number, pick: 'avg' | 'max') => {
  const a = itemid ? agg.get(itemid) : undefined;
  if (!a || !a.n) return 0;
  return ((pick === 'avg' ? a.sum / a.n : a.max) / speed) * 100;
};

const rows: CapacityRow[] = candidates
  .map((c) => {
    const host = c.in.hosts?.[0];
    const port = /^Interface\s+([^(:]+)/.exec(c.in.name)?.[1]?.trim() ?? c.in.name;
    return {
      metric: 'ifutil',
      label,
      itemid: c.in.itemid,
      hostid: host?.hostid ?? '',
      host: host?.name ?? '',
      name: port,
      units: '%',
      avg: Math.max(pct(c.in.itemid, c.speed, 'avg'), pct(c.out?.itemid, c.speed, 'avg')),
      max: Math.min(100, Math.max(pct(c.in.itemid, c.speed, 'max'), pct(c.out?.itemid, c.speed, 'max'))),
      source: trendRows ? ('trend' as const) : ('none' as const),
    };
  })
  .filter((r) => r.source === 'trend')
  .sort((a, b) => b.avg - a.avg)
  .slice(0, top);
return { key: 'ifutil', label, rows };
```
<!-- /gen -->

1. The estate has thousands of interfaces, so the function preselects. It reads the newest rate of every `net.if.in[` and `net.if.out[` item, and the speeds. A port's speed changes only when the port does, and reading its 3,048 values cost minutes on HCML's Zabbix, so the speeds are kept a day and pinned (`SPEEDS_TTL_MS`).
2. Only octet counters are traffic, because errors and discards share the prefix. For each interface the latest rate of the busier direction is divided by its speed, and the top candidates are kept: `top` times four, and at least 40.
3. Only those candidates' trends are then read, at most about 400 items, sliced as before. A row's average is the average of its busier direction as a share of the speed. The maximum is the busier direction's peak, held to 100. The port name comes from the item name.
4. A row without trend data is dropped, and the rest are sorted and cut to `top`.

One thing to know: `/api/reports/capacity` is a viewer route, and the last panel names the busiest ports of each host. The viewer policy keeps interface items from `/api/items`, `/api/latest`, `/api/maps/detail` and `/api/graph`, and this route does not apply it. The owner decided on 11 November 2026 that every role may see it (SC-45), and part 5 and the setup guide say so.

### getCapacityReport and the slow-report policy

<!-- gen:snippet server/src/services/capacity.ts#getCapacityReport sha=dce32956a03d -->
`server/src/services/capacity.ts:335-341`

```ts
export function getCapacityReport(days: number, top: number) {
  return cached(`capacity:${days}:${top}`, CAPACITY_TTL, () => heavy.run(() => getCapacity(days, top)), {
    ...staleReport(CAPACITY_TTL),
    staleMs: CAPACITY_STALE_MS,
    pin: true,
  });
}
```
<!-- /gen -->

<!-- gen:snippet server/src/services/reportPolicy.ts#staleReport sha=82e72255e0ec -->
`server/src/services/reportPolicy.ts:24-24`

```ts
export const staleReport = (ttlMs: number) => ({ staleMs: ttlMs, staleIfError: true, noteAge: true });
```
<!-- /gen -->

<!-- gen:snippet server/src/services/reportPolicy.ts#heavy sha=4de6a2ff350a -->
`server/src/services/reportPolicy.ts:32-32`

```ts
export const heavy = createGate(HEAVY_REPORTS_AT_ONCE);
```
<!-- /gen -->

1. A run of the report took HCML's Zabbix 256 seconds. So the answer is kept for `CAPACITY_TTL`, an hour, under a key made of the days and the top. Past the hour the previous run is served at once, with its age, for up to `CAPACITY_STALE_MS` (23 hours) while one refresh runs. A failed refresh answers with the previous run too. The entry is pinned, so the cache's size limit does not evict it.
2. `staleReport` is the rule for reports over days of history: the previous run is shown with its age while a refresh runs, or when it fails. It is never used for `aging`, or for anything that shows live problem state.
3. `heavy` is a gate that lets `HEAVY_REPORTS_AT_ONCE` (2) reports read Zabbix at the same time. A cold noise report over 365 days takes 7 seconds and thousands of SQL statements, and every new `days` or `severity` is a cold one, so the others wait their turn. A cached answer never waits.
4. The warm-up reads the default report, 7 days and the top 10, last of all, so the first visitor after a start finds it ready.

Tests: `light-reads.test.ts` for the cache policy, `heavy-reports.test.ts` for the gate, and `sli-routes.test.ts` for the key matchers.
