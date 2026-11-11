import { useEffect, useId, useRef, type FormEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../shared/hooks/useDialogFocus';

/**
 * The frame the report dialogs share, the Acknowledge dialog's shape: a backdrop, a form with a head, a body and a foot.
 * Escape, the cross and the backdrop close it, unless `busy`: work under way is not to be walked away from by accident.
 */

/** Brings the element into view when `when` turns on: the foot stays in view while the body scrolls, so a result at the other end would go unseen. */
export function useReveal(ref: RefObject<HTMLElement>, when: unknown): void {
  useEffect(() => {
    if (when) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [ref, when]);
}

export interface ReportDialogProps {
  title: string;
  sub?: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** What takes the focus when the dialog opens. */
  initialFocus?: RefObject<HTMLElement>;
  /** The muted line at the left of the foot. */
  note?: ReactNode;
  /** The buttons at the right of the foot. */
  actions: ReactNode;
  children: ReactNode;
}

export default function ReportDialog({ title, sub, busy = false, onClose, onSubmit, initialFocus, note, actions, children }: ReportDialogProps) {
  const titleId = useId();
  const form = useRef<HTMLFormElement>(null);
  // Whether the press that ends in a click began on the backdrop: one that began in a box and slipped out must not close it.
  const pressedBackdrop = useRef(false);
  useDialogFocus(form, initialFocus);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return createPortal(
    // A click on the backdrop cancels, unless work is under way.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Esc and the close button do this from the keyboard
    <div
      className="drawer-overlay"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
        if (pressedBackdrop.current) e.preventDefault();
      }}
      onClick={() => !busy && pressedBackdrop.current && onClose()}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only keeps the click from reaching the backdrop */}
      <form
        ref={form}
        className="modal"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(e);
        }}
      >
        <header className="drawer-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {sub && <div className="drawer-sub">{sub}</div>}
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close the dialog" disabled={busy}>
            ×
          </button>
        </header>

        <div className="drawer-body">{children}</div>

        <footer className="drawer-foot modal-foot">
          <span className="muted">{note}</span>
          <span style={{ display: 'inline-flex', gap: 8 }}>{actions}</span>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
