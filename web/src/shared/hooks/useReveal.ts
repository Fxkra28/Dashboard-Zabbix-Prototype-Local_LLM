import { useRef } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * For a panel that opens below a long list: `reveal()` brings it into view and puts the focus on the element in it marked `data-reveal-focus`
 * (give it `tabIndex={-1}`), so that a keyboard or screen reader user is told that something opened (UX-62). It waits for the next frame, when the panel is drawn.
 * Somebody who asked for less motion gets the jump: a smooth scroll beats the CSS rule that stops animation, so it has to be asked of here (UX-52).
 */
export function useReveal() {
  const panel = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const reveal = () =>
    requestAnimationFrame(() => {
      panel.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      panel.current?.querySelector<HTMLElement>('[data-reveal-focus]')?.focus({ preventScroll: true });
    });
  return { panel, reveal };
}
