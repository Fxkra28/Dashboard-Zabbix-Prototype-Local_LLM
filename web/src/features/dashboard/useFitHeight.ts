import { useLayoutEffect, useRef } from 'react';
import { fitBounds, fitScale } from './fit';

/** The page's own space under the grid: the panel's padding, the content's, and a little over. */
const BELOW = 32;

/**
 * On a wall (`enabled`), draws `inner` at the scale that fits the window below it and sizes `wrap` to what is seen: the grid is laid out at
 * 1/scale times the width and scaled, so a smaller drawing holds more per row. Measured again on width change, resize and `deps`.
 */
export function useFitHeight<W extends HTMLElement, I extends HTMLElement>(enabled: boolean, deps: unknown[]) {
  const wrap = useRef<W>(null);
  const inner = useRef<I>(null);

  useLayoutEffect(() => {
    const outer = wrap.current;
    const grid = inner.current;
    if (!outer || !grid) return;
    const reset = () => {
      grid.style.width = '';
      grid.style.transform = '';
      grid.style.transformOrigin = '';
      outer.style.height = '';
    };
    if (!enabled) {
      reset();
      return;
    }
    const fit = () => {
      reset();
      const width = outer.clientWidth;
      if (!width) return; // not laid out (no window to measure)
      const room = window.innerHeight - (outer.getBoundingClientRect().top + window.scrollY) - BELOW;
      const scale = fitScale((s) => {
        grid.style.width = `${width / s}px`;
        return grid.offsetHeight;
      }, room, fitBounds(window.innerHeight));
      if (scale === 1) return reset();
      grid.style.width = `${width / scale}px`;
      grid.style.transformOrigin = 'top left';
      grid.style.transform = `scale(${scale})`;
      outer.style.height = `${Math.ceil(grid.offsetHeight * scale)}px`;
    };
    fit();
    let seen = outer.clientWidth;
    // Only the width: the height is what this sets, and watching it would go round in circles.
    const watch =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (outer.clientWidth === seen) return;
            seen = outer.clientWidth;
            fit();
          });
    watch?.observe(outer);
    window.addEventListener('resize', fit);
    return () => {
      watch?.disconnect();
      window.removeEventListener('resize', fit);
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what changes the tiles
  }, [enabled, ...deps]);

  return { wrap, inner };
}
