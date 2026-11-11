import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Signing out clears the saved conversation at once, but the Assistant stays on screen until the
 * sign-out round trip ends. An answer that finishes in that gap must not save the conversation
 * again: it would sit in the tab, readable at the sign-in screen, until someone else signed in.
 */

class FakeChannel {
  postMessage() {}
  addEventListener() {}
}
const { health, chatStream } = vi.hoisted(() => ({ health: vi.fn(), chatStream: vi.fn() }));
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  api: { health },
  chatWarm: vi.fn(async () => undefined),
  chatStream,
}));
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ role: 'admin' }), roleAllows: () => true }));

const KEY = 'hcml_chat';

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  Element.prototype.scrollTo = () => undefined;
  health.mockReset();
  sessionStorage.clear();
});

describe('an answer that lands while signing out', () => {
  it('is shown, but not saved again', async () => {
    health.mockResolvedValue({ ok: true, ts: 1, ai: true, writeBack: false, defaults: { availabilityMinSeverity: 2 } });
    let finish!: () => void;
    chatStream.mockImplementation(
      (_messages: unknown, on: { onToken: (t: string) => void }) =>
        new Promise<void>((resolve) => {
          finish = () => {
            on.onToken('Two hosts are down.');
            resolve();
          };
        }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    // A fresh api/ and chat store: the sign-out state is module-level.
    vi.resetModules();
    const { default: Assistant } = await import('./Assistant');
    const { logout } = await import('../../api');
    const user = userEvent.setup();
    render(<Assistant />);

    await user.type(await screen.findByLabelText('Question for the assistant'), 'which hosts are down?{Enter}');
    expect(sessionStorage.getItem(KEY)).toContain('which hosts are down?');

    await logout();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    await act(async () => finish());
    expect(await screen.findByText('Two hosts are down.')).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
