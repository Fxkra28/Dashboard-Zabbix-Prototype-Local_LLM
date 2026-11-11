import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The tabs' channel is not under test here; api/ only needs one to exist. */
class FakeChannel {
  postMessage() {}
  addEventListener() {}
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const aborted = () => new DOMException('The operation was aborted.', 'AbortError');

/** A whole answer from /api/stats: the read is checked against its shape, so a stand-in must have one. */
const STATS = { hosts: 24, items: 1000, triggers: 300, groups: 8, problems: 3, unacknowledged: 1, bySeverity: { '4': 3 } };

let fetchMock: ReturnType<typeof vi.fn>;

/** A fresh api/ for each test: its session state lives at module level (api/session.ts). */
async function load() {
  vi.resetModules();
  return import('../api');
}

/** A fetch that never answers, and gives up with an AbortError only when its signal says so, as a real one does. */
function stalled() {
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (init.signal?.aborted) reject(aborted());
        else init.signal?.addEventListener('abort', () => reject(aborted()));
      }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', { pathname: '/problems', search: '', href: '', origin: 'http://localhost:3000' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What a settled promise came to, so a rejection is never left unhandled while the clock moves. */
const outcome = (p: Promise<unknown>) =>
  p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error: error as Error }),
  );

describe('a read that never answers (tracker FR-11)', () => {
  it('fails after 330 s with a sentence a person can read, not a bare AbortError', async () => {
    const { api } = await load();
    stalled();
    const result = outcome(api.stats());
    await vi.advanceTimersByTimeAsync(329_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const { error } = (await result) as { error: Error };
    expect(error.message).toBe('No answer from the server within 330 seconds.');
    expect(error.name).not.toBe('AbortError');
  });

  it('also gives up on a body that stops part-way, not only on a missing reply', async () => {
    const { api } = await load();
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(aborted()))),
      }),
    );
    const result = outcome(api.stats());
    await vi.advanceTimersByTimeAsync(330_000);
    expect(((await result) as { error: Error }).error.message).toMatch(/No answer from the server/);
  });

  it('leaves a reply that comes in time alone, and leaves no timer behind', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, STATS));
    const result = outcome(api.stats());
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toEqual({ value: STATS });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves a failure alone too: a 502 still says what the BFF said, and clears its timer', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(502, { message: 'Could not reach Zabbix.' }));
    const result = outcome(api.stats());
    await vi.advanceTimersByTimeAsync(0);
    expect(((await result) as { error: Error }).error.message).toBe('Could not reach Zabbix.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the page cancelling its own read: that stays an abort, never a timeout message', async () => {
    const { api, withSignal } = await load();
    stalled();
    const run = new AbortController();
    const result = outcome(withSignal(run.signal, () => api.stats()));
    await vi.advanceTimersByTimeAsync(5_000);
    run.abort();
    const { error } = (await result) as { error: Error };
    expect(error.name).toBe('AbortError');
    expect(error.message).not.toMatch(/No answer/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a read for a page that was already gone', async () => {
    const { api, withSignal } = await load();
    stalled();
    const run = new AbortController();
    run.abort();
    const { error } = (await outcome(withSignal(run.signal, () => api.stats()))) as { error: Error };
    expect(error.name).toBe('AbortError');
  });

  it('stops watching the page once the read has finished', async () => {
    const { api, withSignal } = await load();
    fetchMock.mockResolvedValue(json(200, STATS));
    const run = new AbortController();
    const read = withSignal(run.signal, () => api.stats());
    await vi.advanceTimersByTimeAsync(0);
    await read;
    const used = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    run.abort();
    expect(used.aborted).toBe(false);
  });

  it('gives an acknowledgement a deadline too, and says that the change may have been made (FR-24)', async () => {
    const { api } = await load();
    stalled();
    const result = outcome(api.acknowledge({ eventids: ['1'], acknowledge: true }));
    await vi.advanceTimersByTimeAsync(329_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const { error } = (await result) as { error: Error };
    expect(error.message).toBe('No answer from the server within 330 seconds. Check whether the change was made before you send it again.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves an acknowledgement that is answered in time alone, with no timer left behind', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, { ok: true, eventids: ['1'], action: 6 }));
    const result = outcome(api.acknowledge({ eventids: ['1'], acknowledge: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toEqual({ value: { ok: true, eventids: ['1'], action: 6 } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives an email as long as a monthly report takes to build, since a second send would be a second email', async () => {
    const { api } = await load();
    stalled();
    const result = outcome(api.sliEmail('2026-08', { formats: ['pdf'] }));
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(331_000); // past an ordinary write's deadline
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(((await result) as { error: Error }).error.message).toBe('No answer from the server within 450 seconds. Check whether the change was made before you send it again.');
  });

  it('gives an explanation longer, because a language model is behind it', async () => {
    const { api } = await load();
    stalled();
    const result = outcome(api.explainProblem('42'));
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(331_000); // past an ordinary read's deadline
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(((await result) as { error: Error }).error.message).toBe('No answer from the server within 450 seconds.');
  });
});
