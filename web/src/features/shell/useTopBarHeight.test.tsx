import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useTopBarHeight } from './useTopBarHeight';

/**
 * The sticky top bar can wrap onto a second row on a narrow window or at 200 to 400 percent zoom, so the room the page keeps under it is the bar's own
 * measured height and not a fixed 72 px, or a control focused with Tab sits under the bar (UX-51, WCAG 2.2, 2.4.11).
 */

let heights: number;
let notify: () => void;
let disconnected: boolean;

beforeEach(() => {
  heights = 64;
  disconnected = false;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        notify = cb;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: heights }) as DOMRect);
});
afterEach(() => {
  document.documentElement.style.removeProperty('--topbar-h');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const value = () => document.documentElement.style.getPropertyValue('--topbar-h');

function Bar({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useTopBarHeight(ref, active);
  return active ? <header ref={ref}>bar</header> : null;
}

describe('useTopBarHeight', () => {
  it('writes the height of the bar once it is on the page', () => {
    heights = 96.4;
    render(<Bar />);
    expect(value()).toBe('97px');
  });

  it('follows the bar when its controls wrap onto a second row', () => {
    render(<Bar />);
    expect(value()).toBe('64px');
    heights = 118;
    notify();
    expect(value()).toBe('118px');
  });

  it('takes the property away, and stops watching, once the bar has left the page', () => {
    const { unmount } = render(<Bar />);
    unmount();
    expect(value()).toBe('');
    expect(disconnected).toBe(true);
  });

  it('writes nothing while there is no bar, as in wall mode', () => {
    render(<Bar active={false} />);
    expect(value()).toBe('');
  });

  it('still writes the height where the browser cannot watch a size', () => {
    vi.unstubAllGlobals();
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    heights = 80;
    const { unmount } = render(<Bar />);
    expect(value()).toBe('80px');
    unmount();
    expect(value()).toBe('');
  });
});
