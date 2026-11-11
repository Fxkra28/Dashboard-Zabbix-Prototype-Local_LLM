import { useEffect } from 'react';

export const APP_TITLE = 'HCML Monitoring Portal';

/** Names the browser tab and its history entry after the page, with the portal's name after it. */
export function usePageTitle(page: string): void {
  useEffect(() => {
    document.title = `${page} · ${APP_TITLE}`;
  }, [page]);

  // Leaving the shell (to the sign-in page) puts the plain name back.
  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );
}
