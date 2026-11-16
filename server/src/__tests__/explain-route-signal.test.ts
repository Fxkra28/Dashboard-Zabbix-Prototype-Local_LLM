import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The three Explain routes hand the service the signal of their reader's connection (BK-67); without it a closed tab keeps the model slot. */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'false';
  process.env.AI_PROVIDER = 'openai-compatible';
  process.env.AI_BASE_URL = 'http://localhost:11434/v1';
});

const { problemMock, derivedMock, zabbixMock } = vi.hoisted(() => ({ problemMock: vi.fn(), derivedMock: vi.fn(), zabbixMock: vi.fn() }));
vi.mock('../services/explain.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/explain.js')>()),
  explainProblem: problemMock,
  explainDerivedSla: derivedMock,
  explainZabbixSla: zabbixMock,
}));

const { buildTestApp } = await import('./helpers/app.js');
const { explainRoutes } = await import('../routes/explain.js');

/** Whether the signal each service call was given had fired at the moment of the call (app.inject closes its fake response afterwards). */
const liveAtCall: boolean[] = [];
const takingSignalAt = (index: number) => async (...args: unknown[]) => {
  const signal = args[index];
  liveAtCall.push(signal instanceof AbortSignal && !signal.aborted);
  return { notFound: 'none' };
};

beforeEach(() => {
  liveAtCall.length = 0;
  problemMock.mockReset().mockImplementation(takingSignalAt(2));
  derivedMock.mockReset().mockImplementation(takingSignalAt(2));
  zabbixMock.mockReset().mockImplementation(takingSignalAt(3));
});

describe('the Explain routes', () => {
  it('give explainProblem the reader’s signal as its third argument', async () => {
    const app = await buildTestApp(explainRoutes);
    await app.inject({ url: '/api/explain/problem?eventid=7' });
    expect(problemMock).toHaveBeenCalledTimes(1);
    expect(problemMock.mock.calls[0][0]).toBe('7');
    expect(liveAtCall).toEqual([true]);
    await app.close();
  });

  it('give the derived SLA explanation the reader’s signal as its third argument', async () => {
    const app = await buildTestApp(explainRoutes);
    await app.inject({ url: '/api/explain/sla?source=derived&month=2026-08&profile=availability' });
    expect(derivedMock).toHaveBeenCalledTimes(1);
    expect(liveAtCall).toEqual([true]);
    await app.close();
  });

  it('give the Zabbix SLA explanation the reader’s signal as its fourth argument', async () => {
    const app = await buildTestApp(explainRoutes);
    await app.inject({ url: '/api/explain/sla?slaid=3' });
    expect(zabbixMock).toHaveBeenCalledTimes(1);
    expect(liveAtCall).toEqual([true]);
    await app.close();
  });
});
