import type { ReactNode } from 'react';

/** Previous and Next around a line saying where the list stands; the caller words that line. */
export function Pager({
  page,
  pages,
  onPage,
  children,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  children: ReactNode;
}) {
  const atFirst = page <= 1;
  const atLast = page >= pages;
  // aria-disabled, not disabled: the press that reaches an end of the list switches that button off while it holds the focus, and a disabled button drops it (UX-63).
  return (
    <div className="pager">
      <button type="button" className="btn ghost sm" aria-disabled={atFirst || undefined} onClick={() => !atFirst && onPage(page - 1)}>
        ‹ Prev
      </button>
      <span className="muted">{children}</span>
      <button type="button" className="btn ghost sm" aria-disabled={atLast || undefined} onClick={() => !atLast && onPage(page + 1)}>
        Next ›
      </button>
    </div>
  );
}
