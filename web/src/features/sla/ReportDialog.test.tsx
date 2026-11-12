import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportDialog from './ReportDialog';

/**
 * The frame the report dialogs share. Each dialog tests its own content; this holds what the frame itself promises:
 * how it names itself, how it closes, and that it does not close while work is under way.
 */

function Harness({ busy = false, onSubmit, sub }: { busy?: boolean; onSubmit?: () => void; sub?: string }) {
  const [open, setOpen] = useState(true);
  const field = useRef<HTMLInputElement>(null);
  if (!open) return <p>closed</p>;
  return (
    <ReportDialog
      title="A title"
      sub={sub}
      busy={busy}
      onClose={() => setOpen(false)}
      onSubmit={onSubmit}
      initialFocus={field}
      note="A note"
      actions={<button type="submit">Go</button>}
    >
      <input ref={field} aria-label="Name" />
    </ReportDialog>
  );
}

function NoStart() {
  const field = useRef<HTMLInputElement>(null);
  return (
    <ReportDialog title="A title" onClose={() => undefined} initialFocus={field} actions={null}>
      <p>Reading</p>
    </ReportDialog>
  );
}

describe('the frame', () => {
  it('is a modal dialog named by its title, with its content, its note and its actions', () => {
    render(<Harness sub="A sub" />);
    const dialog = screen.getByRole('dialog', { name: 'A title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('A sub');
    expect(dialog).toHaveTextContent('A note');
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('is built from the classes the Acknowledge dialog uses, so it looks like it', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('modal');
    expect(dialog.parentElement).toHaveClass('drawer-overlay');
    expect(dialog.querySelector('header.drawer-head h2')).not.toBeNull();
    expect(dialog.querySelector('.drawer-body')).not.toBeNull();
    expect(dialog.querySelector('footer.drawer-foot.modal-foot')).not.toBeNull();
  });

  it('leaves out the line under the title when there is none', () => {
    render(<Harness />);
    expect(document.querySelector('.drawer-sub')).toBeNull();
  });

  it('puts the focus on the element it is told to, and lives outside the page’s own tree', () => {
    render(<Harness />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    expect(screen.getByRole('dialog').closest('body')).toBe(document.body);
  });
});

describe('closing', () => {
  it('closes with Escape, with the cross and with a press on the backdrop, but not with a press inside', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Close the dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    document.body.innerHTML = '';
    render(<Harness />);
    await user.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('takes the focus itself while the element it was to focus is not there yet, so it does not stay behind the dialog', () => {
    render(<NoStart />);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('stays open when a press begins inside it and ends on the backdrop, as when text is selected in a box and the mouse slips out', () => {
    render(<Harness />);
    const overlay = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Name' }));
    fireEvent.mouseUp(overlay);
    // A browser sends the click of such a press to the element that holds both ends, which is the backdrop.
    fireEvent.click(overlay);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on a press that begins and ends on the backdrop', () => {
    render(<Harness />);
    const overlay = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not take a press that began on the backdrop earlier for the next one', () => {
    render(<Harness />);
    const overlay = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(overlay);
    fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Name' }));
    fireEvent.click(overlay);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not close while work is under way: not on Escape, not on the backdrop, and the cross is off', async () => {
    const user = userEvent.setup();
    render(<Harness busy />);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close the dialog' })).toBeDisabled();
  });
});

describe('submitting', () => {
  it('hands the submit to the dialog’s own handler and does not reload the page', async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={submit} />);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('stops the browser from submitting the form itself', () => {
    render(<Harness />);
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    screen.getByRole('dialog').querySelector('form')!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
  });

  it('does nothing visible when it has no handler', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
