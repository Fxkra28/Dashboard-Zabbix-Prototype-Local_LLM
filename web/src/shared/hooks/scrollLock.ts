/**
 * Keeps the page behind a dialog from scrolling under the mouse wheel (UX-43), which the focus trap does not cover.
 * Counted, so two dialogs open at once give the scroll back only when both are gone.
 */
let held = 0;
let overflowBefore = '';
let paddingBefore = '';

export function lockScroll(): () => void {
  const root = document.documentElement;
  if (held++ === 0) {
    overflowBefore = root.style.overflow;
    paddingBefore = root.style.paddingRight;
    // A classic scrollbar goes with `overflow: hidden`, and the page would be wider by its width: pad by that much, so that nothing moves.
    const bar = root.clientWidth > 0 ? window.innerWidth - root.clientWidth : 0;
    root.style.overflow = 'hidden';
    if (bar > 0) root.style.paddingRight = `${bar}px`;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--held === 0) {
      root.style.overflow = overflowBefore;
      root.style.paddingRight = paddingBefore;
    }
  };
}
