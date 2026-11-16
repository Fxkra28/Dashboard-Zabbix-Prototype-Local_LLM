import { useEffect, type RefObject } from 'react';

/** Keeps `--topbar-h` at the sticky bar's measured height, which `scroll-padding-top` reads, so that a bar that wraps never covers a focused control (UX-51). */
export function useTopBarHeight(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const bar = ref.current;
    if (!active || !bar) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty('--topbar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    write();
    // Without ResizeObserver the height is written once, and the 64px fallback in the stylesheet is the floor.
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write);
    watch?.observe(bar);
    return () => {
      watch?.disconnect();
      root.style.removeProperty('--topbar-h');
    };
  }, [ref, active]);
}
