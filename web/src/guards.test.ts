import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnreadableAnswer,
  assertFits,
  freshnessGuard,
  groupProblemsGuard,
  hostOverviewGuard,
  meGuard,
  problemListGuard,
  statsGuard,
  unreadableMessage,
} from './guards';
import type { Freshness, GroupProblems, HostOverview, Me, Stats } from './types';
import { problem } from './__tests__/problems';

/** Each check lets a whole, true answer through and says what is wrong with a broken one. */

afterEach(() => vi.restoreAllMocks());

const host = (over: Partial<HostOverview> = {}): HostOverview => ({
  hostid: '10084',
  name: 'core-1',
  status: '0',
  problems: { total: 2, bySeverity: { '4': 2 } },
  ...over,
});
const stats = (): Stats => ({ hosts: 24, items: 1000, triggers: 300, groups: 8, problems: 3, unacknowledged: 1, bySeverity: { '4': 3 } });
const fresh = (): Freshness => ({ lastCollectedAt: 1_800_000_000, ageSeconds: 30, stale: false, staleAfterSeconds: 600, pinged: 0, answering: 0, reachLost: false });
const group = (): GroupProblems => ({ groupid: '5', name: 'Core', total: 3, bySeverity: { '4': 3 } });
const me = (): Me => ({ authEnabled: true, user: { name: 'ana', role: 'operator' }, expiresIn: 3600, pages: { '/problems': 'viewer' } });

describe('the problem list (the Dashboard, the Problems page and the live stream)', () => {
  const g = problemListGuard;

  it('lets an empty list and a real one through', () => {
    expect(g.misfit([])).toBeNull();
    expect(g.misfit([problem(1, 4, 600), problem(2, 3, 300, { acknowledged: '1' })])).toBeNull();
  });

  it('lets through a problem with every optional field, and one carrying fields it does not know', () => {
    const full = problem(1, 5, 60, {
      r_clock: '1800000100',
      suppressed: '0',
      opdata: '97%',
      tags: [{ tag: 'site', value: 'JKT' }, { tag: 'env', value: '' }],
      manualClose: true,
    });
    expect(g.misfit([{ ...full, cause_eventid: '0', symptom: '0' }])).toBeNull();
  });

  it('lets through a live stream frame as the BFF sends it: only the fields the Dashboard reads (IN-11)', () => {
    const frame = [
      {
        eventid: '1048213',
        objectid: '25238',
        object: '0',
        name: 'High ICMP ping loss',
        severity: '2',
        clock: '1788838236',
        r_eventid: '0',
        acknowledged: '0',
        suppressed: '0',
        host: '4.3.3 FPSO ARUBA 3',
        hostid: '10697',
      },
    ];
    expect(g.misfit(frame)).toBeNull();
  });

  it('lets a problem through without its optional fields', () => {
    const { r_eventid, host, hostid, ...bare } = problem(1, 3);
    void [r_eventid, host, hostid];
    expect(g.misfit([bare])).toBeNull();
  });

  it.each([
    ['an object where a list belongs', {}, 'the answer is not a list'],
    ['nothing at all', undefined, 'the answer is missing'],
    ['null', null, 'the answer is not a list'],
    ['text', 'ok', 'the answer is not a list'],
  ])('refuses %s', (_name, value, why) => {
    expect(g.misfit(value)).toBe(why);
  });

  it('names the row and the field that is wrong', () => {
    const { severity, ...noSeverity } = problem(2, 3);
    void severity;
    expect(g.misfit([problem(1, 3), noSeverity])).toBe('[1].severity is missing');
    expect(g.misfit([problem(1, 3), { ...problem(2, 3), severity: 3 }])).toBe('[1].severity is not text');
    expect(g.misfit([problem(1, 3), null])).toBe('[1] is not an object');
    expect(g.misfit([problem(1, 3), [] ])).toBe('[1] is not an object');
  });

  it('checks the fields a page reads: id, name, severity, time, acknowledged', () => {
    for (const field of ['eventid', 'objectid', 'object', 'name', 'severity', 'clock', 'acknowledged'] as const) {
      const broken: Record<string, unknown> = { ...problem(1, 3) };
      delete broken[field];
      expect(g.misfit([broken]), field).toBe(`[0].${field} is missing`);
    }
  });

  it('checks an optional field when it is there', () => {
    expect(g.misfit([{ ...problem(1, 3), manualClose: 'yes' }])).toBe('[0].manualClose is not true or false');
    expect(g.misfit([{ ...problem(1, 3), host: 7 }])).toBe('[0].host is not text');
    expect(g.misfit([{ ...problem(1, 3), tags: {} }])).toBe('[0].tags is not a list');
    expect(g.misfit([{ ...problem(1, 3), tags: [{ tag: 'a' }] }])).toBe('[0].tags[0].value is missing');
  });
});

describe('the host list (the Hosts page)', () => {
  const g = hostOverviewGuard;

  it('lets a bare host and a full one through', () => {
    expect(g.misfit([])).toBeNull();
    expect(g.misfit([host()])).toBeNull();
    expect(
      g.misfit([
        host({
          maintenance_status: '1',
          interfaces: [{ ip: '10.0.0.1', type: '2', available: '1' }, { ip: '' }],
          site: { code: 1, name: 'Jakarta' },
          state: 'degraded',
          reason: 'snmp-silent',
        }),
        host({ hostid: '2', site: null }),
      ]),
    ).toBeNull();
  });

  it('lets through a state a newer BFF added: only that it is text is checked', () => {
    expect(g.misfit([{ ...host(), state: 'sleeping', reason: 'new-reason' }])).toBeNull();
  });

  it('refuses a list that is not one, or a host without its problems', () => {
    expect(g.misfit({ hosts: [] })).toBe('the answer is not a list');
    const { problems, ...noProblems } = host();
    void problems;
    expect(g.misfit([noProblems])).toBe('[0].problems is missing');
  });

  it('says where a count is wrong', () => {
    expect(g.misfit([host({ problems: { total: '2' as unknown as number, bySeverity: {} } })])).toBe('[0].problems.total is not a number');
    expect(g.misfit([host({ problems: { total: 2, bySeverity: { '4': 'two' as unknown as number } } })])).toBe(
      '[0].problems.bySeverity.4 is not a number',
    );
    expect(g.misfit([host({ problems: { total: 2, bySeverity: [] as unknown as Record<string, number> } })])).toBe(
      '[0].problems.bySeverity is not an object',
    );
  });

  it('says where an interface or a site is wrong', () => {
    expect(g.misfit([host({ interfaces: {} as unknown as [] })])).toBe('[0].interfaces is not a list');
    expect(g.misfit([host({ interfaces: [{ type: '2' } as never] })])).toBe('[0].interfaces[0].ip is missing');
    expect(g.misfit([host({ site: { code: 'one', name: 'Jakarta' } as never })])).toBe('[0].site.code is not a number');
  });

  it('checks the identity a page lists a host by', () => {
    for (const field of ['hostid', 'name', 'status'] as const) {
      const broken: Record<string, unknown> = { ...host() };
      delete broken[field];
      expect(g.misfit([broken]), field).toBe(`[0].${field} is missing`);
    }
  });
});

describe('the dashboard counts', () => {
  it('lets a whole answer through, one with more than it names, and one whose item count is not in yet', () => {
    expect(statsGuard.misfit(stats())).toBeNull();
    expect(statsGuard.misfit({ ...stats(), uptime: 5 })).toBeNull();
    expect(statsGuard.misfit({ ...stats(), bySeverity: {} })).toBeNull();
    expect(statsGuard.misfit({ ...stats(), items: null })).toBeNull();
    expect(statsGuard.misfit({ ...stats(), triggers: null })).toBeNull();
  });

  it('refuses an empty answer, a list, a count sent as text, and a missing breakdown', () => {
    expect(statsGuard.misfit({})).toBe('hosts is missing');
    expect(statsGuard.misfit([])).toBe('the answer is not an object');
    expect(statsGuard.misfit({ ...stats(), hosts: '24' })).toBe('hosts is not a number');
    expect(statsGuard.misfit({ ...stats(), items: '1000' })).toBe('items is not a number');
    expect(statsGuard.misfit({ ...stats(), bySeverity: null })).toBe('bySeverity is not an object');
  });
});

describe('the problems by host group', () => {
  it('lets groups through, and an empty list', () => {
    expect(groupProblemsGuard.misfit([])).toBeNull();
    expect(groupProblemsGuard.misfit([group(), { ...group(), groupid: '6', bySeverity: {} }])).toBeNull();
  });

  it('refuses a group without a total, and a result that is not a list', () => {
    const { total, ...noTotal } = group();
    void total;
    expect(groupProblemsGuard.misfit([group(), noTotal])).toBe('[1].total is missing');
    expect(groupProblemsGuard.misfit(group())).toBe('the answer is not a list');
  });
});

describe('when Zabbix last collected data', () => {
  it('lets through a time, and a Zabbix that has collected nothing yet', () => {
    expect(freshnessGuard.misfit(fresh())).toBeNull();
    expect(freshnessGuard.misfit({ ...fresh(), lastCollectedAt: null, ageSeconds: null })).toBeNull();
  });

  it('refuses a missing flag, a time sent as text, and a list', () => {
    const { stale, ...noStale } = fresh();
    void stale;
    expect(freshnessGuard.misfit(noStale)).toBe('stale is missing');
    expect(freshnessGuard.misfit({ ...fresh(), lastCollectedAt: '1800000000' })).toBe('lastCollectedAt is not a number');
    expect(freshnessGuard.misfit({ ...fresh(), stale: 'false' })).toBe('stale is not true or false');
    expect(freshnessGuard.misfit([])).toBe('the answer is not an object');
  });

  it('needs the ping counts and the cut-off flag the notices read', () => {
    const { pinged, ...noCount } = fresh();
    void pinged;
    expect(freshnessGuard.misfit(noCount)).toBe('pinged is missing');
    expect(freshnessGuard.misfit({ ...fresh(), answering: '2' })).toBe('answering is not a number');
    expect(freshnessGuard.misfit({ ...fresh(), reachLost: 'true' })).toBe('reachLost is not true or false');
  });
});

describe('who is signed in', () => {
  it('lets through a signed-in user, the answer with sign-in off, and one from a BFF with no page list', () => {
    expect(meGuard.misfit(me())).toBeNull();
    expect(meGuard.misfit({ authEnabled: false, user: { name: 'anonymous', role: 'admin' }, expiresIn: null, pages: {} })).toBeNull();
    expect(meGuard.misfit({ authEnabled: true, user: { name: 'ana', role: 'viewer' } })).toBeNull();
    expect(meGuard.misfit({ authEnabled: true, user: null })).toBeNull();
  });

  it('lets through a role it has not heard of: the page then offers that user nothing extra', () => {
    expect(meGuard.misfit({ ...me(), user: { name: 'ana', role: 'auditor' } })).toBeNull();
  });

  it('refuses an answer without the flag or the user, a role that is not text, and a page list that is not one', () => {
    expect(meGuard.misfit({})).toBe('authEnabled is missing');
    expect(meGuard.misfit({ authEnabled: true })).toBe('user is missing');
    expect(meGuard.misfit({ ...me(), user: { name: 'ana', role: 3 } })).toBe('user.role is not text');
    expect(meGuard.misfit({ ...me(), user: { role: 'admin' } })).toBe('user.name is missing');
    expect(meGuard.misfit({ ...me(), expiresIn: '3600' })).toBe('expiresIn is not a number');
    expect(meGuard.misfit({ ...me(), pages: { '/problems': 1 } })).toBe('pages./problems is not text');
    expect(meGuard.misfit('<html>')).toBe('the answer is not an object');
  });
});

/**
 * Answers as the BFF's own route code sends them, captured on 7 October from the real handlers with a
 * stub in place of Zabbix. What the BFF adds to a Zabbix row (ns, source, urls, an empty host) must not fail a check.
 */
describe('answers as the BFF really sends them', () => {
  const zabbixProblem = (over: Record<string, unknown> = {}) => ({
    eventid: '301',
    source: '0',
    object: '0',
    objectid: '2301',
    clock: '1788838236',
    ns: '123456',
    r_eventid: '0',
    r_clock: '0',
    r_ns: '0',
    correlationid: '0',
    userid: '0',
    name: 'High ICMP ping loss',
    acknowledged: '0',
    severity: '4',
    cause_eventid: '0',
    opdata: '',
    suppressed: '0',
    urls: [],
    tags: [{ tag: 'site', value: 'Jakarta' }],
    host: 'core-1',
    hostid: '10',
    manualClose: true,
    ...over,
  });

  it('a problem list, with a resolved problem, a suppressed one and one with no host', () => {
    const list = [
      zabbixProblem(),
      zabbixProblem({ eventid: '302', r_eventid: '303', r_clock: '1788838300', acknowledged: '1', severity: '2', manualClose: false }),
      zabbixProblem({ eventid: '304', suppressed: '1', tags: [] }),
      zabbixProblem({ eventid: '305', opdata: '97 %', host: '', hostid: '' }),
    ];
    expect(problemListGuard.misfit(list)).toBeNull();
  });

  it('the host list, with a disabled host, one in maintenance and an interface with no address', () => {
    const list = [
      {
        hostid: '10', name: 'core-1', status: '0', maintenance_status: '0',
        interfaces: [{ ip: '10.0.0.1', type: '2', available: '1' }],
        state: 'up', reason: 'interface', problems: { total: 1, bySeverity: { '4': 1 } },
      },
      { hostid: '11', name: 'edge-2', status: '1', maintenance_status: '0', interfaces: [], state: 'disabled', reason: 'disabled', problems: { total: 0, bySeverity: {} } },
      {
        hostid: '12', name: 'mnt-3', status: '0', maintenance_status: '1',
        interfaces: [{ ip: '', type: '1', available: '2' }],
        state: 'down', reason: 'interface', problems: { total: 0, bySeverity: {} },
      },
    ];
    expect(hostOverviewGuard.misfit(list)).toBeNull();
  });

  it('the dashboard counts, the groups, and the freshness of a Zabbix that has collected nothing', () => {
    expect(statsGuard.misfit({ hosts: 24, items: 1000, triggers: 12, groups: 8, problems: 2, unacknowledged: 2, bySeverity: { '4': 2 } })).toBeNull();
    expect(groupProblemsGuard.misfit([{ groupid: '5', name: 'Core', total: 1, bySeverity: { '4': 1 } }])).toBeNull();
    expect(freshnessGuard.misfit({ lastCollectedAt: null, ageSeconds: null, stale: false, staleAfterSeconds: 600, pinged: 0, answering: 0, reachLost: false })).toBeNull();
  });

  it('who is signed in, with sign-in on and with it off', () => {
    const pages = { '/': 'viewer', '/network': 'operator', '/reports/inventory': 'admin' };
    expect(meGuard.misfit({ authEnabled: true, user: { name: 'adi', role: 'admin' }, expiresIn: 43200, pages })).toBeNull();
    expect(meGuard.misfit({ authEnabled: false, user: { name: 'anonymous', role: 'admin' }, expiresIn: null, pages })).toBeNull();
  });
});

describe('what a person reads when an answer fails', () => {
  it('is a plain sentence that names the thing, with no setting, no code and no dash', () => {
    for (const g of [problemListGuard, hostOverviewGuard, statsGuard, groupProblemsGuard, freshnessGuard, meGuard]) {
      const text = unreadableMessage(g.what);
      expect(text).toContain(g.what);
      expect(text).toMatch(/^The portal sent back .+ in a form this page cannot read\. Try again in a minute, or tell the portal admin\.$/);
      expect(text).not.toMatch(/BFF|JSON|payload|schema|undefined|\u2014|\u2013/);
      // The error state adds a hint about reaching Zabbix to any message that names it, and that is not the fault here.
      expect(text).not.toMatch(/zabbix/i);
    }
  });

  it('is what an UnreadableAnswer carries, with the detail kept apart for a log', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let caught: unknown;
    try {
      assertFits(statsGuard, { hosts: '24' }, '/api/stats');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnreadableAnswer);
    const err = caught as UnreadableAnswer;
    expect(err.message).toBe(unreadableMessage('the dashboard counts'));
    expect(err.message).not.toContain('hosts');
    expect(err.path).toBe('/api/stats');
    expect(err.detail).toBe('hosts is not a number');
  });
});

describe('assertFits', () => {
  it('hands back the very object it was given when it fits, and does not log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const body = stats();
    expect(assertFits(statsGuard, body, '/api/stats')).toBe(body);
    expect(warn).not.toHaveBeenCalled();
  });

  it('says once in the console what was wrong, not on every poll', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 3; i++) expect(() => assertFits(freshnessGuard, {}, '/api/freshness-once')).toThrow(UnreadableAnswer);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('/api/freshness-once: lastCollectedAt is missing');
    expect(() => assertFits(freshnessGuard, [], '/api/freshness-once')).toThrow(UnreadableAnswer);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('stops filling the console after fifty different complaints, and still refuses the answer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 60; i++) expect(() => assertFits(statsGuard, {}, `/api/cap-${i}`)).toThrow(UnreadableAnswer);
    expect(warn.mock.calls.length).toBeLessThan(60);
    const said = warn.mock.calls.length;
    expect(() => assertFits(statsGuard, {}, '/api/cap-new')).toThrow(UnreadableAnswer);
    expect(warn.mock.calls.length).toBe(said);
  });
});
