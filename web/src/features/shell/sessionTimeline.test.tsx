import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { recordSession, sessionTiming } from '../../api';
import { endSession } from '../../api/session';
import { useSessionRenewal } from './useSessionRenewal';

/**
 * The renewal margin over a whole session, with the real session module and the real hook: `/api/auth/me` answers with the time that is left, not with the whole life, and the access watch asks
 * it every ten minutes (FR-70). A margin taken from what was left would shrink as the session aged, and a renewal that fails once near the end would sign a wall screen out.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const ANA = { name: 'ana', role: 'admin' };
let refreshes = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(Date.parse('2026-11-19T04:00:00Z'));
  refreshes = 0;
  endSession();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      refreshes++;
      return new Response(JSON.stringify({ user: ANA, expiresIn: 12 * 3600 }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const run = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('the session as the page keeps it', () => {
  it('keeps the whole life of a session when /api/auth/me tells how much is left of it, and moves its end', () => {
    recordSession(12 * 3600, ANA);
    vi.setSystemTime(Date.now() + 10 * HOUR);
    recordSession(2 * 3600, ANA, 'left');
    expect(sessionTiming()?.lifeMs).toBe(12 * HOUR);
    expect(sessionTiming()?.endsAt).toBe(Date.now() + 2 * HOUR);
  });

  it('takes what is left as the life when it is all the page has heard, as when it opens late in a session', () => {
    recordSession(3 * 60, ANA, 'left');
    expect(sessionTiming()?.lifeMs).toBe(3 * MIN);
  });

  it('takes the whole life again from a renewal, and a sign-in, whatever it was before', () => {
    recordSession(8 * 3600, ANA);
    recordSession(12 * 3600, ANA);
    expect(sessionTiming()?.lifeMs).toBe(12 * HOUR);
    recordSession(4 * 3600, ANA);
    expect(sessionTiming()?.lifeMs).toBe(4 * HOUR);
  });
});

describe('the renewal of a session that is read again every ten minutes', () => {
  it('still comes an hour before the end, and not minutes before it', async () => {
    recordSession(12 * 3600, ANA);
    renderHook(() => useSessionRenewal(true));
    for (let elapsed = 10; elapsed < 650; elapsed += 10) {
      await run(10 * MIN);
      recordSession(12 * 3600 - elapsed * 60, ANA, 'left');
    }
    // 10 hours 40 minutes in, with the last of the re-reads just made: the renewal is due at 11 hours, an hour before the end of twelve.
    await run(19 * MIN);
    expect(refreshes).toBe(0);
    await run(2 * MIN);
    expect(refreshes).toBe(1);
  });
});
