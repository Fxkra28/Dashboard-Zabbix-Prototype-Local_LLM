import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary, { reloadOnStaleChunks } from './ErrorBoundary';

/**
 * One broken page shows a card inside the layout instead of a blank portal, and a tab that stayed open across a deploy reloads once
 * to pick up the new build (the troubleshooting page describes both; FR-30).
 */

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('the card for a page that crashed', () => {
  beforeEach(() => {
    // React and the boundary both write the crash to the console.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows its children while nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All well</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All well')).toBeInTheDocument();
    expect(screen.queryByText('This page hit an error')).toBeNull();
  });

  it('shows the message, a hint and a Reload button instead of a blank page', () => {
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This page hit an error')).toBeInTheDocument();
    expect(screen.getByText('Cannot read properties of undefined')).toBeInTheDocument();
    expect(screen.getByText(/Other pages still work/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('writes the crash to the console with the component stack', () => {
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined" />
      </ErrorBoundary>,
    );
    const calls = vi.mocked(console.error).mock.calls.filter((call) => call[0] === 'Page crashed:');
    expect(calls).toHaveLength(1);
    expect((calls[0]![1] as Error).message).toBe('Cannot read properties of undefined');
    expect(String(calls[0]![2])).toContain('Boom');
  });

  it('reloads the page when Reload is pressed', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(
      <ErrorBoundary>
        <Boom message="x" />
      </ErrorBoundary>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('a tab left open across a deploy', () => {
  const KEY = 'hcml_preload_reload';
  let reload: ReturnType<typeof vi.fn>;
  let added: [string, EventListenerOrEventListenerObject][];

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    // Each call adds a listener to the window: take them off again, so that one test does not hear the next one's event.
    added = [];
    const real = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      added.push([type, fn]);
      real(type, fn, options);
    });
  });
  afterEach(() => {
    for (const [type, fn] of added) window.removeEventListener(type, fn);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const preloadError = () => {
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  it('reloads once on a stale chunk, and keeps the browser from showing its own error', () => {
    reloadOnStaleChunks();
    const event = preloadError();
    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });

  it('does not reload a second time: the error reaches the error card', () => {
    reloadOnStaleChunks();
    preloadError();
    const second = preloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });

  it('does not reload at all when this page load is itself that reload', () => {
    sessionStorage.setItem(KEY, String(Date.now()));
    reloadOnStaleChunks();
    const event = preloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets a later deploy reload again once the flag has cleared, thirty seconds on', () => {
    vi.useFakeTimers();
    sessionStorage.setItem(KEY, String(Date.now()));
    reloadOnStaleChunks();
    vi.advanceTimersByTime(30_000);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    preloadError();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still works when the browser blocks session storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    reloadOnStaleChunks();
    const event = preloadError();
    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
