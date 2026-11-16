import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

/**
 * An explanation whose reader has left (BK-67). Explain used to pass the model no signal at all, so a closed tab kept the one model
 * slot for the whole call. The signal is the cache's: it fires only when every reader of the shared call has gone.
 */
const { humanizeMock, problemsMock, opdataMock } = vi.hoisted(() => ({ humanizeMock: vi.fn(), problemsMock: vi.fn(), opdataMock: vi.fn() }));
vi.mock('../clients/ai.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/ai.js')>()), humanize: humanizeMock }));
vi.mock('../domain/queries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domain/queries.js')>()),
  cachedProblems: problemsMock,
  withOpdata: opdataMock,
}));

const { invalidate } = await import('../core/cache.js');
const { Cancelled } = await import('../core/gate.js');
const { explainProblem } = await import('../services/explain.js');
const { aiUse } = await import('../security/audit.js');

const problem = { eventid: '555', host: 'sw-lt3', name: 'High ICMP ping loss', opdata: '', severity: '3', clock: '1788000000', acknowledged: '0', r_eventid: '0', tags: [] };

beforeEach(() => {
  invalidate('');
  humanizeMock.mockReset();
  problemsMock.mockReset().mockResolvedValue([problem]);
  opdataMock.mockReset().mockImplementation(async (list: unknown[]) => list);
});

/** The signal each model call was handed, in order. */
const signalsSeen = () => humanizeMock.mock.calls.map((c) => c[3] as AbortSignal);

describe('explainProblem and the reader who leaves', () => {
  it('tells the model to stop when its only reader leaves, keeps nothing, and lets the next reader ask afresh', async () => {
    humanizeMock.mockImplementation(() => new Promise(() => undefined));
    const ac = new AbortController();
    const asked = explainProblem('555', () => undefined, ac.signal);
    asked.catch(() => undefined);
    await vi.waitFor(() => expect(humanizeMock).toHaveBeenCalledTimes(1));
    expect(signalsSeen()[0].aborted).toBe(false);

    ac.abort();
    await expect(asked).rejects.toBeInstanceOf(Cancelled);
    expect(signalsSeen()[0].aborted).toBe(true);

    humanizeMock.mockResolvedValue({ summary: 'fresh' });
    expect(await explainProblem('555', () => undefined)).toEqual({ summary: 'fresh' });
    expect(humanizeMock).toHaveBeenCalledTimes(2);
    expect(signalsSeen()[1].aborted).toBe(false);
  });

  // BK-71: the model's signal was read after the operational data came in, and the reader had left before that.
  it('hands the model a signal that has already fired when the reader left while the operational data was being read', async () => {
    let release!: (list: unknown[]) => void;
    opdataMock.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    humanizeMock.mockResolvedValue({ summary: 'for nobody' });
    const ac = new AbortController();
    const asked = explainProblem('555', () => undefined, ac.signal);
    asked.catch(() => undefined);
    await vi.waitFor(() => expect(opdataMock).toHaveBeenCalledTimes(1));

    ac.abort();
    await expect(asked).rejects.toBeInstanceOf(Cancelled);
    release([problem]);
    await vi.waitFor(() => expect(humanizeMock).toHaveBeenCalledTimes(1));
    expect(signalsSeen()[0].aborted).toBe(true);

    opdataMock.mockImplementation(async (list: unknown[]) => list);
    humanizeMock.mockResolvedValue({ summary: 'fresh' });
    expect(await explainProblem('555', () => undefined)).toEqual({ summary: 'fresh' });
    expect(signalsSeen()[1].aborted).toBe(false);
  });

  it('keeps the model going for another reader who joined while the operational data was being read', async () => {
    let release!: (list: unknown[]) => void;
    opdataMock.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    humanizeMock.mockResolvedValue({ summary: 'shared' });
    const leaver = new AbortController();
    const a = explainProblem('555', () => undefined, leaver.signal);
    a.catch(() => undefined);
    await vi.waitFor(() => expect(opdataMock).toHaveBeenCalledTimes(1));
    const b = explainProblem('555', () => undefined);

    leaver.abort();
    await expect(a).rejects.toBeInstanceOf(Cancelled);
    release([problem]);
    expect(await b).toEqual({ summary: 'shared' });
    expect(signalsSeen()[0].aborted).toBe(false);
    expect(humanizeMock).toHaveBeenCalledTimes(1);
  });

  it('does not stop the model while another reader waits for the same explanation, and gives them the answer', async () => {
    let finish!: (v: unknown) => void;
    humanizeMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const leaver = new AbortController();
    const a = explainProblem('555', () => undefined, leaver.signal);
    a.catch(() => undefined);
    await vi.waitFor(() => expect(humanizeMock).toHaveBeenCalledTimes(1));
    const b = explainProblem('555', () => undefined);

    leaver.abort();
    await expect(a).rejects.toBeInstanceOf(Cancelled);
    expect(signalsSeen()[0].aborted).toBe(false);
    finish({ summary: 'shared' });
    expect(await b).toEqual({ summary: 'shared' });
    expect(humanizeMock).toHaveBeenCalledTimes(1);
  });

  it('hands the model a signal that never fires for a caller that gave none', async () => {
    humanizeMock.mockResolvedValue({ summary: 'ok' });
    await explainProblem('555', () => undefined);
    expect(signalsSeen()[0]).toBeInstanceOf(AbortSignal);
    expect(signalsSeen()[0].aborted).toBe(false);
  });
});

describe('aiUse and a read that was dropped', () => {
  const requestWithLog = () => {
    const info = vi.fn();
    return { req: { log: { info }, user: undefined, ip: '203.0.113.5' } as unknown as FastifyRequest, info };
  };

  it('logs a use whose reader left as aborted, not failed, and hands the error on', async () => {
    const { req, info } = requestWithLog();
    await expect(aiUse(req, 'explain').run(async () => Promise.reject(new Cancelled()))).rejects.toBeInstanceOf(Cancelled);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatchObject({ event: 'ai_call', kind: 'explain', outcome: 'aborted' });
  });

  it('still logs any other error as failed', async () => {
    const { req, info } = requestWithLog();
    await expect(aiUse(req, 'explain').run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(info.mock.calls[0][0]).toMatchObject({ outcome: 'failed' });
  });
});
