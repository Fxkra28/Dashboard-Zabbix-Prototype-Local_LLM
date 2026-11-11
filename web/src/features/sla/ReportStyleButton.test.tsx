import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportStyleButton from './ReportStyleButton';
import { REPORT_STYLE_KEY, readReportStyle } from './reportStyle';

/**
 * The "Number and date style" button and its dialog: what it offers, that a choice is kept the moment it is made, and
 * the dialog manners every dialog of the portal has (focus in, Escape out, focus back).
 */

beforeEach(() => localStorage.clear());

const button = () => screen.getByRole('button', { name: 'Number and date style' });
async function open() {
  const user = userEvent.setup();
  render(<ReportStyleButton />);
  await user.click(button());
  return { user, dialog: await screen.findByRole('dialog', { name: 'Number and date style' }) };
}
const field = (dialog: HTMLElement, name: string) => within(dialog).getByRole('combobox', { name }) as HTMLSelectElement;

describe('the button', () => {
  it('is one small ghost button in a group of its own, named for what it sets', () => {
    render(<ReportStyleButton />);
    const group = screen.getByRole('group', { name: 'Number and date style of the report files' });
    expect(group).toHaveClass('report-actions');
    expect(within(group).getAllByRole('button')).toHaveLength(1);
    expect(button()).toHaveClass('btn', 'ghost', 'sm');
    expect(button()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the dialog', () => {
  it('names itself, says what it applies to, and promises that no figure changes', async () => {
    const { dialog } = await open();
    expect(within(dialog).getByRole('heading', { name: 'Number and date style' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Applies to the PDF, Excel and CSV files you download, and to the ones you email.');
    expect(dialog).toHaveTextContent('No figure or verdict changes, only how it is written.');
  });

  it('offers the three settings, each with an example of every choice', async () => {
    const { dialog } = await open();
    expect(within(field(dialog, 'Decimal mark')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Dot, as in 99.38%', 'Comma, as in 99,38%']);
    expect(within(field(dialog, 'Dates')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '4 Nov 2026',
      '04/11/2026 (day, month, year)',
      '2026-11-04 (year, month, day)',
    ]);
    expect(within(field(dialog, 'CSV separator')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Comma', 'Semicolon']);
    expect(dialog).toHaveTextContent('If Excel puts every row in one column, choose the other separator.');
  });

  it('shows the default style when nothing was kept, and the kept style when one was', async () => {
    const first = await open();
    expect(field(first.dialog, 'Decimal mark').value).toBe('dot');
    expect(field(first.dialog, 'Dates').value).toBe('long');
    expect(field(first.dialog, 'CSV separator').value).toBe('comma');
  });

  it('shows what was kept', async () => {
    localStorage.setItem(REPORT_STYLE_KEY, JSON.stringify({ decimal: 'comma', date: 'iso', separator: 'semicolon' }));
    const { dialog } = await open();
    expect(field(dialog, 'Decimal mark').value).toBe('comma');
    expect(field(dialog, 'Dates').value).toBe('iso');
    expect(field(dialog, 'CSV separator').value).toBe('semicolon');
  });

  it('keeps a choice the moment it is made, and leaves the others as they were', async () => {
    const { user, dialog } = await open();
    await user.selectOptions(field(dialog, 'Decimal mark'), 'comma');
    expect(readReportStyle()).toEqual({ decimal: 'comma', date: 'long', separator: 'comma' });
    await user.selectOptions(field(dialog, 'Dates'), 'iso');
    expect(readReportStyle()).toEqual({ decimal: 'comma', date: 'iso', separator: 'comma' });
    await user.selectOptions(field(dialog, 'CSV separator'), 'semicolon');
    expect(readReportStyle()).toEqual({ decimal: 'comma', date: 'iso', separator: 'semicolon' });
  });

  it('shows the choice that was made, in the select', async () => {
    const { user, dialog } = await open();
    await user.selectOptions(field(dialog, 'Dates'), 'numeric');
    expect(field(dialog, 'Dates').value).toBe('numeric');
  });

  it('opens on the first setting, so the keyboard starts where the choices are', async () => {
    const { dialog } = await open();
    expect(field(dialog, 'Decimal mark')).toHaveFocus();
  });
});

describe('closing it', () => {
  it('closes with Done, and the focus goes back to the button', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });

  it('closes with Escape', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });

  it('closes with the cross', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Close the dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the backdrop is pressed, and not when the dialog itself is', async () => {
    const { user, dialog } = await open();
    await user.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.click(dialog.parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps what was chosen after it closes, and shows it when it opens again', async () => {
    const { user, dialog } = await open();
    await user.selectOptions(field(dialog, 'Decimal mark'), 'comma');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(button());
    expect(field(await screen.findByRole('dialog', { name: 'Number and date style' }), 'Decimal mark').value).toBe('comma');
  });

  it('keeps Tab inside the dialog', async () => {
    const { user, dialog } = await open();
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
