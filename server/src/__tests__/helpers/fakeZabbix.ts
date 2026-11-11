/**
 * A small made-up estate that answers by Zabbix method, for tests that drive every route at once: three hosts at
 * two sites, one open problem, ping and interface items with a value. Everything is a string, as Zabbix sends it.
 */

const now = () => Math.floor(Date.now() / 1000);

const iface = (ip: string) => ({ interfaceid: ip.split('.').pop(), ip, dns: '', port: '161', type: '2', main: '1', useip: '1', available: '1', error: '' });

const HOSTS = [
  { hostid: '10689', host: 'IDX02CORESWITCH', name: '1.2.1 IDX02CORESWITCH', site: 'Jakarta', ip: '10.0.0.1', template: 'Cisco IOS by SNMP' },
  { hostid: '10697', host: 'FPSO-ARUBA-3', name: '4.3.3 FPSO ARUBA 3', site: 'FPSO KAS3', ip: '10.0.4.3', template: 'ICMP Ping' },
  { hostid: '10800', host: 'SAMPANG-WAN-1', name: 'INET : SAMPANG WAN 1', site: 'Sampang', ip: '10.0.3.1', template: 'ICMP Ping' },
].map((h) => ({
  hostid: h.hostid,
  host: h.host,
  name: h.name,
  status: '0',
  maintenance_status: '0',
  interfaces: [iface(h.ip)],
  tags: [{ tag: 'site', value: h.site }],
  hostgroups: [{ groupid: '5', name: h.site }],
  groups: [{ groupid: '5', name: h.site }],
  parentTemplates: [{ templateid: '10001', name: h.template }],
  inventory: {},
}));

/** What a `selectHosts` returns: every field a caller asks for there is one of these. */
const hostRef = (h: (typeof HOSTS)[number]) => ({ hostid: h.hostid, name: h.name, host: h.host, status: h.status });

const item = (itemid: string, hostid: string, key_: string, name: string, lastvalue: string, over: Record<string, unknown> = {}) => ({
  itemid,
  hostid,
  key_,
  name,
  lastvalue,
  prevvalue: lastvalue,
  lastclock: String(now() - 30),
  state: '0',
  status: '0',
  delay: '1m',
  value_type: '3',
  units: '',
  tags: [],
  hosts: [hostRef(HOSTS.find((h) => h.hostid === hostid) ?? HOSTS[0])],
  ...over,
});

const ITEMS = () => [
  ...HOSTS.map((h, i) => item(`300${i}`, h.hostid, 'icmpping', 'ICMP ping', i === 1 ? '0' : '1')),
  ...HOSTS.map((h, i) => item(`310${i}`, h.hostid, 'icmppingloss', 'ICMP loss', '0', { value_type: '0', units: '%' })),
  ...HOSTS.map((h, i) => item(`320${i}`, h.hostid, 'icmppingsec', 'ICMP response time', '0.002', { value_type: '0', units: 's' })),
  item('4001', '10689', 'net.if.in[ifHCInOctets.1]', 'Interface Gi1/0/1(uplink): Bits received', '1200000', {
    units: 'bps',
    tags: [{ tag: 'interface', value: 'Gi1/0/1' }, { tag: 'component', value: 'network' }],
  }),
  item('4002', '10689', 'net.if.status[ifOperStatus.1]', 'Interface Gi1/0/1(uplink): Operational status', '1', {
    tags: [{ tag: 'interface', value: 'Gi1/0/1' }, { tag: 'component', value: 'network' }],
  }),
];

const PROBLEM = () => ({
  eventid: '109',
  objectid: '25249',
  object: '0',
  source: '0',
  name: 'Unavailable by ICMP ping',
  severity: '4',
  clock: String(now() - 3600),
  ns: '0',
  r_eventid: '0',
  r_clock: '0',
  acknowledged: '0',
  suppressed: '0',
  opdata: '',
  tags: [{ tag: 'scope', value: 'availability' }],
});

const TRIGGER = () => ({
  triggerid: '25249',
  description: 'Unavailable by ICMP ping',
  priority: '4',
  value: '1',
  status: '0',
  state: '0',
  manual_close: '0',
  lastchange: String(now() - 3600),
  hosts: [hostRef(HOSTS[1])],
  tags: [],
});

export async function zabbixAnswer(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (params.countOutput) return '0';
  const ids = (key: string) => (params[key] === undefined ? null : ([] as unknown[]).concat(params[key]).map(String));
  switch (method) {
    case 'apiinfo.version':
      return '7.0.30';
    case 'host.get': {
      const wanted = ids('hostids');
      return HOSTS.filter((h) => !wanted || wanted.includes(h.hostid));
    }
    case 'hostgroup.get':
      return [{ groupid: '5', name: 'Jakarta', hosts: [{ hostid: '10689' }] }];
    case 'problem.get':
      return [PROBLEM()];
    case 'trigger.get':
      return [TRIGGER()];
    case 'event.get':
      return [{ ...PROBLEM(), value: '1', hosts: [hostRef(HOSTS[1])] }];
    case 'item.get': {
      const search = (params.search as { key_?: string } | undefined)?.key_;
      const wanted = ids('itemids');
      const hostids = ids('hostids');
      return ITEMS().filter(
        (i) => (!search || i.key_.startsWith(search)) && (!wanted || wanted.includes(i.itemid)) && (!hostids || hostids.includes(i.hostid)),
      );
    }
    case 'history.get': {
      // A ping item answers with its own value, as the bulk ping read (reachability.ts) expects.
      const pings = new Map(ITEMS().filter((i) => i.key_.startsWith('icmpping')).map((i) => [i.itemid, i]));
      return (ids('itemids') ?? ['4001']).map((itemid) => {
        const ping = pings.get(itemid);
        return ping
          ? { itemid, clock: ping.lastclock, value: ping.lastvalue, ns: '0' }
          : { itemid, clock: String(now() - 60), value: '1200000', ns: '0' };
      });
    }
    case 'trend.get':
      return (ids('itemids') ?? ['3000']).map((itemid) => ({
        itemid,
        clock: String(Math.floor((now() - 7200) / 3600) * 3600),
        num: '60',
        value_min: '1',
        value_avg: '1',
        value_max: '1',
      }));
    default:
      return [];
  }
}
