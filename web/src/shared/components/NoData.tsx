import type { ReactNode } from 'react';

/**
 * The "no value" placeholder: the dash for the eye, words for a screen reader,
 * which otherwise reads "em dash" or nothing at all (DESIGN.md section 9).
 * `label` is for a dash that means something narrower, such as a count of none.
 */
export function NoData({ label = 'No data' }: { label?: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/** A formatter's output as page text: its bare "—" becomes the readable placeholder. */
export const orNoData = (text: string | number): ReactNode => (text === '—' ? <NoData /> : text);
