import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A maintenance window on a host group covers the hosts of the groups nested under it (BK-46, third point). Zabbix says so:
 * naming a parent group selects every group whose name starts with the parent's name and a slash. The Zabbix API is a stand-in
 * that answers hostgroup.get the way Zabbix does for an id list, for a name search and for no filter at all. Every name is made up.
 */

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbx: zbxMock,
}));

const { maintenanceByHost } = await import('../sli/maintenance.js');

const FROM = Date.parse('2026-08-31T17:00:00Z') / 1000;
const TO = Date.parse('2026-09-30T17:00:00Z') / 1000;
const WINDOW_START = FROM + 5 * 86400;
const ONE_HOUR = 3600;

interface Group {
  groupid: string;
  name: string;
  hosts: { hostid: string }[];
}
const GROUPS: Group[] = [
  { groupid: '1', name: 'Network', hosts: [{ hostid: 'h1' }] },
  { groupid: '2', name: 'Network/Core', hosts: [{ hostid: 'h2' }] },
  { groupid: '3', name: 'Network/Core/Edge', hosts: [{ hostid: 'h3' }] },
  { groupid: '4', name: 'Networking', hosts: [{ hostid: 'h4' }] },
  { groupid: '5', name: 'network/Lower', hosts: [{ hostid: 'h5' }] },
  { groupid: '6', name: 'Servers', hosts: [{ hostid: 'h6' }] },
  { groupid: '7', name: 'Servers/Rack 1', hosts: [{ hostid: 'h7' }] },
];

const maintenanceOn = (...groupids: string[]) => ({
  maintenanceid: 'm1',
  active_since: String(FROM - 86400),
  active_till: String(TO + 86400),
  timeperiods: [{ timeperiod_type: '0', start_date: String(WINDOW_START), period: String(ONE_HOUR) }],
  hosts: [],
  hostgroups: groupids.map((groupid) => ({ groupid })),
});

/**
 * Zabbix's own matching for `search`: a pattern matches anywhere in the name unless `startSearch` is set, it ignores case (which is
 * why the code must check the name again), and several patterns on one field must all match unless `searchByAny` is set.
 */
function searched(rows: Group[], params: Record<string, unknown>): Group[] {
  const search = params.search as { name?: unknown } | undefined;
  if (search?.name === undefined) return rows;
  const patterns = [search.name].flat().map((w) => String(w).toLowerCase());
  const hit = (name: string, w: string) => (params.startSearch === true ? name.toLowerCase().startsWith(w) : name.toLowerCase().includes(w));
  return rows.filter((g) => (params.searchByAny === true ? patterns.some((w) => hit(g.name, w)) : patterns.every((w) => hit(g.name, w))));
}

function serve(maintenance: ReturnType<typeof maintenanceOn>[]) {
  zbxMock.mockImplementation(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === 'maintenance.get') return maintenance;
    if (method === 'hostgroup.get') {
      let rows = GROUPS;
      if (Array.isArray(params.groupids)) rows = rows.filter((g) => (params.groupids as string[]).includes(g.groupid));
      rows = searched(rows, params);
      // Only the fields that were asked for: `output` names them, and `selectHosts` adds the hosts.
      const output = (params.output as string[] | undefined) ?? [];
      return rows.map((g) => ({
        ...(output.includes('groupid') ? { groupid: g.groupid } : {}),
        ...(output.includes('name') ? { name: g.name } : {}),
        ...(params.selectHosts ? { hosts: g.hosts } : {}),
      }));
    }
    throw new Error(`unexpected call ${method}`);
  });
}

// Braces: a hook that returns a function has it run after the test as a clean-up, and the mock would be called with nothing.
beforeEach(() => {
  zbxMock.mockReset();
});

describe('maintenanceByHost with nested host groups (BK-46)', () => {
  it('covers the hosts of every group under the one the maintenance names, at any depth', async () => {
    serve([maintenanceOn('1')]);
    const byHost = await maintenanceByHost(FROM, TO, 'Asia/Jakarta', () => undefined);
    const window = [[WINDOW_START, WINDOW_START + ONE_HOUR]];
    expect([...byHost.keys()].sort()).toEqual(['h1', 'h2', 'h3']);
    expect(byHost.get('h2')).toEqual(window);
    expect(byHost.get('h3')).toEqual(window);
  });

  it('covers the nested groups of every group a maintenance names when it names two, which Zabbix matches as any of the names and not all of them', async () => {
    serve([maintenanceOn('1', '6')]);
    const byHost = await maintenanceByHost(FROM, TO, 'Asia/Jakarta', () => undefined);
    expect([...byHost.keys()].sort()).toEqual(['h1', 'h2', 'h3', 'h6', 'h7']);
  });

  it('asks for the names of the groups first, and then for the groups that start with each name and a slash', async () => {
    serve([maintenanceOn('1', '6')]);
    await maintenanceByHost(FROM, TO, 'Asia/Jakarta', () => undefined);
    const calls = zbxMock.mock.calls.filter(([m]) => m === 'hostgroup.get').map(([, p]) => p as Record<string, unknown>);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ groupids: ['1', '6'] });
    expect(calls[0]!.output).toEqual(expect.arrayContaining(['groupid', 'name']));
    expect(calls[1]).toMatchObject({ search: { name: ['Network/', 'Servers/'] }, searchByAny: true, startSearch: true });
  });

  it('does not cover a group whose name only starts with the same letters, or differs in case', async () => {
    serve([maintenanceOn('1')]);
    const byHost = await maintenanceByHost(FROM, TO, 'Asia/Jakarta', () => undefined);
    expect(byHost.has('h4')).toBe(false);
    expect(byHost.has('h5')).toBe(false);
    expect(byHost.has('h6')).toBe(false);
  });

  it('covers the groups under a nested group and not its parent', async () => {
    serve([maintenanceOn('2')]);
    const byHost = await maintenanceByHost(FROM, TO, 'Asia/Jakarta', () => undefined);
    expect([...byHost.keys()].sort()).toEqual(['h2', 'h3']);
  });

  it('merges the windows of two maintenances that reach the same host through different groups', async () => {
    const second = { ...maintenanceOn('3'), maintenanceid: 'm2', timeperiods: [{ timeperiod_type: '0', start_date: String(WINDOW_START + 2 * ONE_HOUR), period: String(ONE_HOUR) }] };
    serve([maintenanceOn('1'), second]);
    const byHost = await maintenanceByHost(FROM, TO, 'Asia/Jakarta', () => undefined);
    expect(byHost.get('h3')).toEqual([
      [WINDOW_START, WINDOW_START + ONE_HOUR],
      [WINDOW_START + 2 * ONE_HOUR, WINDOW_START + 3 * ONE_HOUR],
    ]);
  });

  it('asks Zabbix for no group at all when no maintenance names one, and counts each call it makes', async () => {
    serve([{ ...maintenanceOn(), hosts: [{ hostid: 'h6' }] } as never]);
    let calls = 0;
    const byHost = await maintenanceByHost(FROM, TO, 'Asia/Jakarta', () => calls++);
    expect([...byHost.keys()]).toEqual(['h6']);
    expect(zbxMock.mock.calls.filter(([m]) => m === 'hostgroup.get')).toHaveLength(0);
    expect(calls).toBe(1);
  });

  it('counts every call to Zabbix, the nested search too', async () => {
    serve([maintenanceOn('1')]);
    let calls = 0;
    await maintenanceByHost(FROM, TO, 'Asia/Jakarta', () => calls++);
    expect(calls).toBe(zbxMock.mock.calls.length);
  });
});
