import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from './helpers/app.js';
import { DEVICE_CLASS_LABELS } from '../domain/naming.js';
import { invalidate } from '../core/cache.js';

/** GET /api/devices: every host as a device of one kind, the SLA report's own (naming.ts); the Zabbix reads are mocked by method. */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const { deviceRoutes } = await import('../routes/devices.js');

const { CLASS_ORDER } = await import('../services/devices.js');
const { hostRoutes } = await import('../routes/hosts.js');

const host = (hostid: string, name: string, templates: string[], over: Record<string, unknown> = {}) => ({
  hostid,
  name,
  status: '0',
  maintenance_status: '0',
  interfaces: [{ ip: `10.0.0.${hostid}`, type: '2', available: '1' }],
  parentTemplates: templates.map((t) => ({ name: t })),
  ...over,
});

const ESTATE = [
  host('1', '1.1 SITE1-CORESWITCH', ['Cisco IOS by SNMP', 'ICMP Ping']),
  host('2', '3.1 SITE3-FW-01', ['FortiGate by SNMP']),
  host('3', '2.1.1 ARUBA AP 3', ['Generic by SNMP']),
  host('4', 'SERVER : DATABASE', []),
  host('5', 'INET : SITETWO WAN 1', ['ICMP Ping']),
  host('6', 'WEB : PORTAL', []),
  host('7', 'Zabbix server', []),
  host('8', '5.1 RADIO REPEATER 7', ['ICMP Ping']),
  host('9', '4.1 UNKNOWN BOX', ['Generic by SNMP']),
];

function zabbix(hosts = ESTATE, problems: unknown[] = []) {
  zbxMock.mockImplementation(async (method: string) => {
    if (method === 'host.get') return hosts;
    if (method === 'problem.get') return problems;
    // A problem reaches its host through its trigger.
    if (method === 'trigger.get') return problems.map(() => ({ triggerid: '9', manual_close: '0', hosts: [{ hostid: '1', name: 'x' }] }));
    if (method === 'item.get') return [];
    return [];
  });
}
const hostGets = (select: string) => zbxMock.mock.calls.filter(([m, p]) => m === 'host.get' && select in (p as object));

beforeEach(() => {
  zbxMock.mockReset();
  invalidate('');
});
afterEach(() => vi.useRealTimers());

const get = async (app: Awaited<ReturnType<typeof buildTestApp>>) => (await app.inject({ url: '/api/devices' })).json();

describe('GET /api/devices', () => {
  it('lists every kind of device naming.ts knows, in the order the page shows them', async () => {
    zabbix();
    const { classes } = await get(await buildTestApp(deviceRoutes));
    expect(classes.map((c: { key: string }) => c.key)).toEqual([...CLASS_ORDER]);
    expect(classes[0]).toEqual({ key: 'switch', label: 'Switches' });
    // A kind added to naming.ts and left out of the list would never appear on the page.
    expect([...CLASS_ORDER].sort()).toEqual(Object.keys(DEVICE_CLASS_LABELS).sort());
  });

  it('gives each host the kind of device the SLA report would', async () => {
    zabbix();
    const { devices } = await get(await buildTestApp(deviceRoutes));
    const kindOf = Object.fromEntries(devices.map((d: { name: string; class: string }) => [d.name, d.class]));
    expect(kindOf).toEqual({
      '1.1 SITE1-CORESWITCH': 'switch',
      '3.1 SITE3-FW-01': 'firewall',
      '2.1.1 ARUBA AP 3': 'access-point',
      'SERVER : DATABASE': 'server',
      'INET : SITETWO WAN 1': 'wan-link',
      'WEB : PORTAL': 'web',
      'Zabbix server': 'other',
      '5.1 RADIO REPEATER 7': 'repeater',
      '4.1 UNKNOWN BOX': 'access-point',
    });
  });

  it('gives the template it judged by, "ICMP Ping" for a host that is only pinged, and "Other" for one with none', async () => {
    zabbix();
    const { devices } = await get(await buildTestApp(deviceRoutes));
    const category = Object.fromEntries(devices.map((d: { name: string; category: string }) => [d.name, d.category]));
    expect(category['1.1 SITE1-CORESWITCH']).toBe('Cisco IOS by SNMP');
    expect(category['3.1 SITE3-FW-01']).toBe('FortiGate by SNMP');
    expect(category['INET : SITETWO WAN 1']).toBe('ICMP Ping');
    expect(category['Zabbix server']).toBe('Other');
  });

  it('carries what the Hosts page shows, and the site the name gives', async () => {
    zabbix(ESTATE, [{ eventid: '9', objectid: '9', object: '0', clock: String(Math.floor(Date.now() / 1000)), r_eventid: '0', severity: '4', acknowledged: '0', name: 'x' }]);
    const { devices } = await get(await buildTestApp(deviceRoutes));
    const sw = devices.find((d: { hostid: string }) => d.hostid === '1');
    expect(sw).toMatchObject({
      name: '1.1 SITE1-CORESWITCH',
      status: '0',
      site: { code: 1, name: 'Jakarta' },
      problems: { total: 1, bySeverity: { '4': 1 } },
    });
    expect(sw.interfaces[0].ip).toBe('10.0.0.1');
    expect(typeof sw.state).toBe('string');
    expect(devices.find((d: { hostid: string }) => d.hostid === '7').site).toBeNull();
  });

  it('keeps a host the templates read has not met yet, as "Other", rather than dropping it', async () => {
    zbxMock.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === 'host.get') return params.selectParentTemplates ? ESTATE.slice(0, 2) : ESTATE;
      return [];
    });
    const { devices } = await get(await buildTestApp(deviceRoutes));
    expect(devices).toHaveLength(ESTATE.length);
    expect(devices.find((d: { hostid: string }) => d.hostid === '3')).toMatchObject({ category: 'Other', class: 'access-point' });
  });

  it('shares the Hosts page\'s read: the host list is asked for once, whichever page asks first', async () => {
    zabbix();
    const app = await buildTestApp(hostRoutes, deviceRoutes);
    await app.inject({ url: '/api/hosts/overview' });
    await app.inject({ url: '/api/devices' });
    expect(hostGets('selectInterfaces')).toHaveLength(1);
    expect(hostGets('selectParentTemplates')).toHaveLength(1);
  });

  it('answers from its cache for half a minute, and keeps the templates for five', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    zabbix();
    const app = await buildTestApp(deviceRoutes);
    await app.inject({ url: '/api/devices' });
    await app.inject({ url: '/api/devices' });
    expect(hostGets('selectInterfaces')).toHaveLength(1);

    vi.setSystemTime(t0 + 31_000);
    await app.inject({ url: '/api/devices' });
    expect(hostGets('selectInterfaces')).toHaveLength(2);
    expect(hostGets('selectParentTemplates')).toHaveLength(1);

    vi.setSystemTime(t0 + 301_000);
    await app.inject({ url: '/api/devices' });
    expect(hostGets('selectParentTemplates')).toHaveLength(2);
  });

  it('is read again after a write, so a close shows in its problem counts at once', async () => {
    const { STALE_AFTER_WRITE, WRITE_HOLD_MS } = await import('../services/actions.js');
    const open = { eventid: '9', objectid: '9', object: '0', clock: String(Math.floor(Date.now() / 1000)), r_eventid: '0', severity: '4', acknowledged: '0', name: 'x' };
    zabbix(ESTATE, [open]);
    const app = await buildTestApp(deviceRoutes);
    const total = async () => (await get(app)).devices.find((d: { hostid: string }) => d.hostid === '1').problems.total;
    expect(await total()).toBe(1);

    zabbix(ESTATE, []);
    expect(await total()).toBe(1);
    // What routes/actions.ts does once Zabbix has accepted a close.
    for (const key of STALE_AFTER_WRITE) invalidate(key, { holdMs: WRITE_HOLD_MS });
    expect(await total()).toBe(0);
  });

  it('says one sentence, and no method name, when Zabbix cannot be read', async () => {
    const { ZabbixApiError } = await import('../clients/zabbix.js');
    zbxMock.mockRejectedValue(new ZabbixApiError('host.get: {"code":-32602}'));
    const app = await buildTestApp(deviceRoutes);
    const res = await app.inject({ url: '/api/devices' });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('host.get');
  });
});
