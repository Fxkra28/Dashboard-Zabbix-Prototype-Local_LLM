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
  return (
    <div className="pager">
      <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Prev
      </button>
      <span className="muted">{children}</span>
      <button type="button" className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next ›
      </button>
    </div>
  );
}
