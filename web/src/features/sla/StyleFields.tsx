import { useId, type RefObject } from 'react';
import type { ReportStyle } from '../../types';
import { DATE_CHOICES, DECIMAL_CHOICES, SEPARATOR_CHOICES } from './reportStyle';

/** The three choices of a report's style, as selects with an example of each, and the one hint that saves a person a search. */
export default function StyleFields({
  style,
  onChange,
  first,
  disabled = false,
}: {
  style: ReportStyle;
  onChange: (next: ReportStyle) => void;
  /** The first select, for a dialog that puts the focus there. */
  first?: RefObject<HTMLSelectElement>;
  disabled?: boolean;
}) {
  const decimalId = useId();
  const dateId = useId();
  const separatorId = useId();
  return (
    <>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor={decimalId}>Decimal mark</label>
        <select id={decimalId} ref={first} value={style.decimal} disabled={disabled} onChange={(e) => onChange({ ...style, decimal: e.target.value as ReportStyle['decimal'] })}>
          {DECIMAL_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor={dateId}>Dates</label>
        <select id={dateId} value={style.date} disabled={disabled} onChange={(e) => onChange({ ...style, date: e.target.value as ReportStyle['date'] })}>
          {DATE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor={separatorId}>CSV separator</label>
        <select id={separatorId} value={style.separator} disabled={disabled} onChange={(e) => onChange({ ...style, separator: e.target.value as ReportStyle['separator'] })}>
          {SEPARATOR_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <p className="muted">If Excel puts every row in one column, choose the other separator.</p>
    </>
  );
}
