import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ReportFileFormat } from '../../types';
import FileChoices, { FILE_CHOICES, nounOf } from './FileChoices';

/** The tick boxes for the kinds of file: their names, their order, and that what is sent on is always in that order. */

function Harness({ start = ['pdf'], onChange = () => undefined, disabled = false }: { start?: ReportFileFormat[]; onChange?: (f: ReportFileFormat[]) => void; disabled?: boolean }) {
  const [chosen, setChosen] = useState(start);
  return (
    <FileChoices
      chosen={chosen}
      disabled={disabled}
      onChange={(next) => {
        setChosen(next);
        onChange(next);
      }}
    />
  );
}
const box = (name: string) => screen.getByRole('checkbox', { name });

describe('the choices', () => {
  it('are the PDF, the Excel file and the CSV files as one zip, in that order, with a noun for a sentence each', () => {
    expect(FILE_CHOICES.map((c) => c.format)).toEqual(['pdf', 'xlsx', 'csv']);
    expect(FILE_CHOICES.map((c) => c.label)).toEqual(['PDF', 'Excel', 'CSV (a zip of files)']);
    expect(['pdf', 'xlsx', 'csv'].map((f) => nounOf(f as ReportFileFormat))).toEqual(['the PDF', 'the Excel file', 'the CSV zip']);
  });

  it('give an unknown kind back as it came, rather than nothing', () => {
    expect(nounOf('odt' as ReportFileFormat)).toBe('odt');
  });
});

describe('the group', () => {
  it('is named Files, with one checkbox for each kind and the ones chosen ticked', () => {
    render(<Harness start={['pdf', 'csv']} />);
    const group = screen.getByRole('group', { name: 'Files' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3);
    expect(box('PDF')).toBeChecked();
    expect(box('Excel')).not.toBeChecked();
    expect(box('CSV (a zip of files)')).toBeChecked();
  });

  it('hands on the kinds ticked, in the fixed order whatever order they were ticked in', async () => {
    const seen = vi.fn();
    const user = userEvent.setup();
    render(<Harness start={[]} onChange={seen} />);
    await user.click(box('CSV (a zip of files)'));
    await user.click(box('PDF'));
    await user.click(box('Excel'));
    expect(seen.mock.calls.map((c) => c[0])).toEqual([['csv'], ['pdf', 'csv'], ['pdf', 'xlsx', 'csv']]);
  });

  it('hands on the rest when one is unticked', async () => {
    const seen = vi.fn();
    const user = userEvent.setup();
    render(<Harness start={['pdf', 'xlsx', 'csv']} onChange={seen} />);
    await user.click(box('Excel'));
    expect(seen).toHaveBeenLastCalledWith(['pdf', 'csv']);
    await user.click(box('PDF'));
    await user.click(box('CSV (a zip of files)'));
    expect(seen).toHaveBeenLastCalledWith([]);
  });

  it('looks shut when it is shut, as the other tick boxes of the portal do', () => {
    const { rerender } = render(<FileChoices chosen={['pdf']} onChange={() => undefined} />);
    for (const c of FILE_CHOICES) expect(box(c.label).closest('label')).not.toHaveClass('disabled');
    rerender(<FileChoices chosen={['pdf']} onChange={() => undefined} disabled />);
    for (const c of FILE_CHOICES) expect(box(c.label).closest('label')).toHaveClass('check', 'disabled');
  });

  it('can be shut, and then does nothing', async () => {
    const seen = vi.fn();
    const user = userEvent.setup();
    render(<Harness disabled onChange={seen} />);
    for (const c of FILE_CHOICES) expect(box(c.label)).toBeDisabled();
    await user.click(box('Excel'));
    expect(seen).not.toHaveBeenCalled();
  });
});
