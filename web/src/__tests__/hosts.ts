import type { Device, DevicesResponse, TopHostsResponse, WebMonitoringResponse } from '../types';

/** A host as GET /api/devices gives it, up and answering unless said otherwise. */
export const device = (hostid: string, name: string, kind: Device['class'], over: Partial<Device> = {}): Device => ({
  hostid,
  name,
  status: '0',
  maintenance_status: '0',
  interfaces: [{ ip: `10.0.0.${hostid}`, type: '2', available: '1' }],
  site: { code: 1, name: 'Jakarta' },
  state: 'up',
  reason: 'ping',
  problems: { total: 0, bySeverity: {} },
  class: kind,
  category: 'Cisco IOS by SNMP',
  ...over,
});

export const CLASSES: DevicesResponse['classes'] = [
  { key: 'switch', label: 'Switches' },
  { key: 'firewall', label: 'Firewalls' },
  { key: 'access-point', label: 'Access points' },
  { key: 'repeater', label: 'Radio repeaters' },
  { key: 'server', label: 'Servers' },
  { key: 'wan-link', label: 'WAN links' },
  { key: 'web', label: 'Web services' },
  { key: 'other', label: 'Other' },
];

/** Nine hosts: 5 up, 1 degraded, 2 down, 1 with no data, and one more that is disabled and counted nowhere. */
export const ESTATE: Device[] = [
  device('1', '1.1 SITE1-CORESWITCH', 'switch'),
  device('2', '1.2 SITE1-ACCESSSWITCH', 'switch', { problems: { total: 2, bySeverity: { '3': 2 } } }),
  device('3', '3.1 SITE3-FW-01', 'firewall'),
  device('4', '3.2 SITE3-FW-02', 'firewall', { state: 'degraded', reason: 'snmp-silent' }),
  device('5', '2.1.1 ARUBA AP 3', 'access-point', { state: 'down', reason: 'ping', problems: { total: 1, bySeverity: { '4': 1 } } }),
  device('6', 'INET : SITETWO WAN 1', 'wan-link', { state: 'down', reason: 'ping', maintenance_status: '1' }),
  device('7', 'SERVER : DATABASE', 'server'),
  device('8', 'Zabbix server', 'server', { state: 'nodata', reason: 'stale' }),
  device('9', '5.1 RADIO REPEATER 7', 'repeater', { status: '1', state: 'disabled', reason: 'disabled' }),
];

export const devicesResponse = (devices: Device[] = ESTATE): DevicesResponse => ({ classes: CLASSES, devices });

const NOW = 1_800_000_000;
/** The busiest hosts: made-up names and figures. */
export const topHostsResponse = (over: Partial<TopHostsResponse> = {}): TopHostsResponse => ({
  generatedAt: NOW,
  metrics: [
    {
      key: 'cpu',
      label: 'CPU utilisation',
      considered: 8,
      current: 3,
      rows: [
        { hostid: '3', host: '3.1 SITE3-FW-01', itemid: '301', value: 93.4, clock: NOW },
        { hostid: '7', host: 'SERVER : DATABASE', itemid: '701', value: 78, clock: NOW },
        { hostid: '1', host: '1.1 SITE1-CORESWITCH', itemid: '101', value: 31.2, clock: NOW },
      ],
    },
    {
      key: 'memory',
      label: 'Memory utilisation',
      considered: 6,
      current: 0,
      rows: [],
    },
  ],
  ...over,
});

/** Web monitoring: seven made-up scenarios, one of them failing. */
export const webMonitoringResponse = (over: Partial<WebMonitoringResponse> = {}): WebMonitoringResponse => ({
  generatedAt: NOW,
  total: 7,
  ok: 5,
  failed: 1,
  unknown: 1,
  failures: [{ hostid: '4', host: 'SITE-WEB', name: 'Checkout', itemid: '401', step: 2, clock: NOW }],
  ...over,
});
