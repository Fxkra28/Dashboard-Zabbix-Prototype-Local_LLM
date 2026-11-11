import type { ReactNode } from 'react';

/** One cell of a controls row: a label above its control. */
export function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/** A cell whose control is not one input (a group of buttons, a checkbox): the heading is plain text, not a label. */
export function FieldGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** A cell with nothing to label (a count, a button): a hidden heading keeps it level with the labelled cells beside it. */
export function FieldSpacer({ children }: { children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label" aria-hidden="true">&nbsp;</span>
      {children}
    </div>
  );
}
