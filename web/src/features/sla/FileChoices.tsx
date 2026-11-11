import type { ReportFileFormat } from '../../types';

/** The kinds of file the report comes in, in the order they are listed and attached. `noun` fits "Sent ..." in a sentence. */
export const FILE_CHOICES: { format: ReportFileFormat; label: string; noun: string }[] = [
  { format: 'pdf', label: 'PDF', noun: 'the PDF' },
  { format: 'xlsx', label: 'Excel', noun: 'the Excel file' },
  { format: 'csv', label: 'CSV (a zip of files)', noun: 'the CSV zip' },
];

export const nounOf = (format: ReportFileFormat): string => FILE_CHOICES.find((c) => c.format === format)?.noun ?? format;

/** Which files to send: one checkbox each, and at least one is the person's to keep. */
export default function FileChoices({
  chosen,
  onChange,
  disabled = false,
}: {
  chosen: readonly ReportFileFormat[];
  onChange: (next: ReportFileFormat[]) => void;
  disabled?: boolean;
}) {
  const toggle = (format: ReportFileFormat, on: boolean) =>
    onChange(FILE_CHOICES.map((c) => c.format).filter((f) => (f === format ? on : chosen.includes(f))));
  return (
    <div className="field" role="group" aria-label="Files" style={{ marginBottom: 12 }}>
      <span className="field-label">Files</span>
      {FILE_CHOICES.map((c) => (
        <label key={c.format} className={`check${disabled ? ' disabled' : ''}`}>
          <input
            type="checkbox"
            name={`file-${c.format}`}
            checked={chosen.includes(c.format)}
            disabled={disabled}
            onChange={(e) => toggle(c.format, e.target.checked)}
          />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  );
}
