import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

/** Gives the box a tab stop and a name while it holds more than it shows, in either direction, and takes both away when it does not. */
function markScrollable(el: HTMLElement, label: string) {
  if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
    el.tabIndex = 0;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', label);
  } else {
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  }
}

/**
 * The box that lets a wide table scroll. While it scrolls it takes a tab stop and a name, so a keyboard can
 * scroll it too (WCAG 2.1.1); while it does not, it stays out of the tab order.
 */
export function TableWrap({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const watch = useRef<ResizeObserver | null>(null);
  const name = useRef(label);

  // After every render, since the table inside may now be wider or taller, and a table that arrives late is watched from then on.
  // The attributes go on the element itself and not through state, which would render the whole table a second time.
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    name.current = label;
    markScrollable(el, label);
    if (typeof ResizeObserver === 'undefined') return;
    // The box follows the window and the sidebar; the table follows its data and its fonts.
    watch.current ??= new ResizeObserver(() => markScrollable(el, name.current));
    watch.current.observe(el);
    el.querySelectorAll('table').forEach((table) => watch.current?.observe(table));
  });
  useEffect(
    () => () => {
      watch.current?.disconnect();
      watch.current = null;
    },
    [],
  );

  return (
    <div ref={box} className={className ? `table-wrap ${className}` : 'table-wrap'}>
      {children}
    </div>
  );
}
