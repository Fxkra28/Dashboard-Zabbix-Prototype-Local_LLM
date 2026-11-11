import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What Explain tells the model about a problem. The portal shows times in the SLA zone, so the start
 * time the model quotes must be in that zone too, not a UTC string seven hours off (BK-37).
 */
const { humanizeMock, problemsMock } = vi.hoisted(() => ({ humanizeMock: vi.fn(), problemsMock: vi.fn() }));
vi.mock('../clients/ai.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/ai.js')>()), humanize: humanizeMock }));
vi.mock('../domain/queries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domain/queries.js')>()),
  cachedProblems: problemsMock,
  withOpdata: async (list: unknown[]) => list,
}));

const { config } = await import('../core/config.js');
const { invalidate } = await import('../core/cache.js');
const { explainProblem } = await import('../services/explain.js');

/** 2026-10-07 08:00 UTC, which is 15:00 in Jakarta. */
const CLOCK = Date.parse('2026-10-07T08:00:00Z') / 1000;
const savedZone = config.sla.timezone;

const problem = (over: Record<string, unknown> = {}) => ({
  eventid: '555',
  host: 'sw-lt3',
  name: 'High ICMP ping loss',
  opdata: '',
  severity: '3',
  clock: String(CLOCK),
  acknowledged: '0',
  r_eventid: '0',
  tags: [],
  ...over,
});

beforeEach(() => {
  invalidate('');
  humanizeMock.mockReset().mockResolvedValue({ plain: 'x' });
  problemsMock.mockReset().mockResolvedValue([problem()]);
});
afterEach(() => {
  config.sla.timezone = savedZone;
});

const startedOf = () => (humanizeMock.mock.calls[0][1] as { started: string }).started;

describe('the start time Explain gives the model (BK-37)', () => {
  it('is the clock of the SLA zone with its name, as the portal shows it, and not a UTC string', async () => {
    config.sla.timezone = 'Asia/Jakarta';
    await explainProblem('555', () => undefined);
    expect(startedOf()).toBe('Wed, 7 Oct 2026, 15:00 WIB (Asia/Jakarta)');
    expect(startedOf()).not.toMatch(/Z$|T08:00/);
  });

  it('follows SLA_TIMEZONE', async () => {
    config.sla.timezone = 'Asia/Makassar';
    await explainProblem('555', () => undefined);
    expect(startedOf()).toBe('Wed, 7 Oct 2026, 16:00 WITA (Asia/Makassar)');
  });

  it('keeps the rest of what the model is told', async () => {
    await explainProblem('555', () => undefined);
    expect(humanizeMock.mock.calls[0][0]).toBe('problem');
    expect(humanizeMock.mock.calls[0][1]).toMatchObject({ host: 'sw-lt3', notification: 'High ICMP ping loss', acknowledged: false, resolved: false });
  });
});
