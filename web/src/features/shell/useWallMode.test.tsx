import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useWallMode } from './useWallMode';

/** The Dashboard's wall mode: the address says it, the button asks for the browser's fullscreen, a refusal does not matter, and Esc ends it (FR-76). */

let fullscreen: Element | null = null;
const requestFullscreen = vi.fn();
const exitFullscreen = vi.fn();

beforeEach(() => {
  fullscreen = null;
  requestFullscreen.mockReset().mockImplementation(async () => {
    fullscreen = document.documentElement;
  });
  exitFullscreen.mockReset().mockImplementation(async () => {
    fullscreen = null;
  });
  document.documentElement.requestFullscreen = requestFullscreen as never;
  document.exitFullscreen = exitFullscreen as never;
  // jsdom has no fullscreenElement to spy on.
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'fullscreenElement');
  vi.restoreAllMocks();
});

// The address is the browser's own: the patch that writes ?wall=1 reads the live location.
const Wrapper = ({ children }: { children: ReactNode }) => <BrowserRouter>{children}</BrowserRouter>;
const hook = (url: string) => {
  window.history.replaceState(null, '', url);
  return renderHook(
    () => {
      const mode = useWallMode();
      return { ...mode, search: useLocation().search };
    },
    { wrapper: Wrapper },
  );
};

describe('wall mode', () => {
  it('is on for the Dashboard with ?wall=1, and for no other page or value', () => {
    expect(hook('/?wall=1').result.current.wall).toBe(true);
    expect(hook('/').result.current.wall).toBe(false);
    expect(hook('/?wall=0').result.current.wall).toBe(false);
    expect(hook('/problems?wall=1').result.current.wall).toBe(false);
  });

  it('is entered by writing it into the address, and asks the browser for the whole screen', async () => {
    const { result } = hook('/');
    await act(async () => result.current.enter());
    expect(result.current.wall).toBe(true);
    expect(result.current.search).toContain('wall=1');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('works when the browser refuses the whole screen, as in a frame or under a policy', async () => {
    requestFullscreen.mockRejectedValue(new Error('not allowed'));
    const { result } = hook('/');
    await act(async () => result.current.enter());
    expect(result.current.wall).toBe(true);
  });

  it('works where the browser has no such call at all', async () => {
    // @ts-expect-error a browser without the Fullscreen API
    document.documentElement.requestFullscreen = undefined;
    const { result } = hook('/');
    await act(async () => result.current.enter());
    expect(result.current.wall).toBe(true);
  });

  it('is left with the button: the address drops it, and the whole screen it asked for is given back', async () => {
    const { result } = hook('/');
    await act(async () => result.current.enter());
    await act(async () => result.current.exit());
    expect(result.current.wall).toBe(false);
    expect(result.current.search).not.toContain('wall');
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('leaves a whole screen alone that the browser was already in, as a kiosk is', async () => {
    fullscreen = document.documentElement;
    const { result } = hook('/?wall=1');
    await act(async () => result.current.exit());
    expect(result.current.wall).toBe(false);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('ends with Esc, which ends the whole screen without asking the page', async () => {
    const { result } = hook('/');
    await act(async () => result.current.enter());
    expect(result.current.wall).toBe(true);
    fullscreen = null;
    await act(async () => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(result.current.wall).toBe(false);
  });

  it('does not end for a change of the whole screen that it did not ask for', async () => {
    fullscreen = document.documentElement;
    const { result } = hook('/?wall=1');
    fullscreen = null;
    await act(async () => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(result.current.wall).toBe(true);
  });
});
