import { useRef, useState } from 'react';
import type { ReportStyle } from '../../types';
import ReportDialog from './ReportDialog';
import StyleFields from './StyleFields';
import { readReportStyle, writeReportStyle } from './reportStyle';

/**
 * How the report files write their numbers and dates, and what a CSV file puts between its fields. A choice is kept
 * in this browser the moment it is made and used by the next download. It never changes a figure or a verdict.
 */

function StyleDialog({ onClose }: { onClose: () => void }) {
  const [style, setStyle] = useState<ReportStyle>(readReportStyle);
  const first = useRef<HTMLSelectElement>(null);

  const choose = (next: ReportStyle) => {
    setStyle(next);
    writeReportStyle(next);
  };

  return (
    <ReportDialog
      title="Number and date style"
      sub="Applies to the PDF, Excel and CSV files you download, and to the ones you email."
      onClose={onClose}
      initialFocus={first}
      note="No figure or verdict changes, only how it is written."
      actions={
        <button type="button" className="btn sm" onClick={onClose}>
          Done
        </button>
      }
    >
      <StyleFields style={style} onChange={choose} first={first} />
    </ReportDialog>
  );
}

export default function ReportStyleButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <div className="report-actions" role="group" aria-label="Number and date style of the report files">
        <button type="button" className="btn ghost sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          Number and date style
        </button>
      </div>
      {open && <StyleDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
