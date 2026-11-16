import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, tabButtonId, tabsPanelId } from './Tabs';

/** The tabs pattern the SLA page uses, as one component: one tab stop, arrow keys, a panel the tab controls. */

const TABS = [
  { key: 'a', label: 'Overview' },
  { key: 'b', label: 'Internet traffic' },
  { key: 'c', label: 'Third' },
] as const;

function Harness({ onChange }: { onChange?: (k: string) => void }) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
  return (
    <>
      <Tabs
        id="t"
        label="Dashboard view"
        tabs={TABS}
        value={value}
        onChange={(k) => {
          setValue(k);
          onChange?.(k);
        }}
      />
      <div role="tabpanel" id={tabsPanelId('t')} aria-labelledby={tabButtonId('t', value)}>
        panel {value}
      </div>
    </>
  );
}
const tab = (name: string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it('is a tab list with one tab selected, and a panel that the selected tab names', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Dashboard view' })).toBeInTheDocument();
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Internet traffic')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Overview')).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Overview');
  });

  it('is one tab stop: only the selected tab can be reached with Tab', () => {
    render(<Harness />);
    expect(tab('Overview')).toHaveAttribute('tabindex', '0');
    expect(tab('Internet traffic')).toHaveAttribute('tabindex', '-1');
    expect(tab('Third')).toHaveAttribute('tabindex', '-1');
  });

  it('selects on a click, and tells its owner', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.setup().click(tab('Internet traffic'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(tab('Internet traffic')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Internet traffic');
  });

  it('walks with the arrow keys, wrapping at both ends, with focus following', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    tab('Overview').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Internet traffic')).toHaveFocus();
    expect(tab('Internet traffic')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tab('Overview')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Third')).toHaveFocus();
  });

  it('jumps to the first and the last with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    tab('Overview').focus();
    await user.keyboard('{End}');
    expect(tab('Third')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('Overview')).toHaveFocus();
  });

  // UX-50: Alt, Ctrl or Cmd with an arrow is the browser's Back and Forward, as FR-44 made it on the SLA tabs.
  it.each([
    ['Alt', '{Alt>}{ArrowRight}{/Alt}'],
    ['Alt', '{Alt>}{ArrowLeft}{/Alt}'],
    ['Control', '{Control>}{ArrowRight}{/Control}'],
    ['Meta', '{Meta>}{ArrowLeft}{/Meta}'],
    ['Alt', '{Alt>}{Home}{/Alt}'],
    ['Meta', '{Meta>}{End}{/Meta}'],
  ])('does not take %s with an arrow, Home or End: the tab stays, and the browser gets the key (%s)', async (_modifier, keys) => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const seen: boolean[] = [];
    render(<Harness onChange={onChange} />);
    // keydown reaches the document after the tab list: the browser's own shortcut is the default action, which preventDefault would cancel.
    document.addEventListener('keydown', (e) => seen.push(e.defaultPrevented), { once: true });
    tab('Overview').focus();
    await user.keyboard(keys);
    expect(onChange).not.toHaveBeenCalled();
    expect(tab('Overview')).toHaveFocus();
    expect(seen).toEqual([false]);
  });

  it('still walks with a plain arrow after a modified one', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    tab('Overview').focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}{ArrowRight}');
    expect(tab('Internet traffic')).toHaveFocus();
  });

  it('leaves the other keys alone (Enter and Space press the focused tab, as for any button)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    tab('Overview').focus();
    await user.keyboard('x{ArrowDown}{ArrowUp}{Tab}');
    expect(onChange).not.toHaveBeenCalled();
  });
});
