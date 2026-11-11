import { useEffect, useReducer } from 'react';

const DARK = '(prefers-color-scheme: dark)';

/** Re-renders when data-theme or the system colour scheme changes: a canvas cannot follow a CSS variable by itself. */
export function useThemeChange(): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const watch = new MutationObserver(bump);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const query = window.matchMedia?.(DARK);
    query?.addEventListener('change', bump);
    return () => {
      watch.disconnect();
      query?.removeEventListener('change', bump);
    };
  }, []);
}
