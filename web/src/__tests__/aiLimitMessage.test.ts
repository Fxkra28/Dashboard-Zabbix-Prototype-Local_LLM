import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * When the BFF refuses an AI call for going over a limit, the person reads the
 * BFF's own sentence (what the limit is, when to try again), not "HTTP 429" or a bare error code.
 */

const RATE = {
  error: 'rate_limited',
  message: 'You are asking too quickly: the limit is 10 questions to the assistant a minute for each person. Try again in 42 seconds.',
};
const BUDGET = {
  error: 'ai_budget',
  message: 'You have used your share of AI answers for today. It starts again at midnight (Asia/Jakarta), about 5 hours from now. The rest of the portal still works.',
};

const refused = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '42' } });

let fetchMock: ReturnType<typeof vi.fn>;

/** A fresh api/ for each test: its session state lives at module level (api/session.ts). */
async function load() {
  vi.resetModules();
  return import('../api');
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} addEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('a refused AI call', () => {
  it('shows the Assistant the limit in the BFF words, for the minute limit and for the daily budget', async () => {
    const { chatStream } = await load();
    for (const body of [RATE, BUDGET]) {
      fetchMock.mockResolvedValueOnce(refused(body));
      await expect(chatStream([{ role: 'user', content: 'hi' }], { onToken: () => undefined })).rejects.toThrow(body.message);
    }
  });

  it('shows Explain the limit in the BFF words, for the problem and the SLA explanation', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(refused(RATE));
    await expect(api.explainProblem('1')).rejects.toThrow(RATE.message);
    fetchMock.mockResolvedValueOnce(refused(BUDGET));
    await expect(api.explainSla('1')).rejects.toThrow(BUDGET.message);
  });

  it('is not a sign-out: a 429 leaves the session alone', async () => {
    const { chatStream, isSignedOut } = await load();
    fetchMock.mockResolvedValueOnce(refused(RATE));
    await expect(chatStream([{ role: 'user', content: 'hi' }], { onToken: () => undefined })).rejects.toThrow();
    expect(isSignedOut()).toBe(false);
  });
});
