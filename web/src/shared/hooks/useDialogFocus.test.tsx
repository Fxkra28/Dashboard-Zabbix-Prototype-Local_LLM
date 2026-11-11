import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useDialogFocus } from './useDialogFocus';

/** What a modal dialog owes a keyboard user (UX-08): focus in on open, Tab kept inside, focus back on close. */

function Dialog({ onClose, items = true, startAtFirst = false }: { onClose: () => void; items?: boolean; startAtFirst?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useDialogFocus(box, startAtFirst ? first : undefined);
  return (
    <div ref={box} role="dialog" aria-label="Dialog" tabIndex={-1}>
      {items && (
        <>
          <button ref={first}>First</button>
          <button>Middle</button>
          <button onClick={onClose}>Last</button>
        </>
      )}
    </div>
  );
}

function Page({ items = true, startAtFirst = false, removeOpener = false, disableOpener = false }: { items?: boolean; startAtFirst?: boolean; removeOpener?: boolean; disableOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  const [openerOff, setOpenerOff] = useState(false);
  return (
    <>
      <main id="main">
        <p>Content</p>
      </main>
      <button>Before</button>
      <button onClick={() => setShowOpener(false)}>Remove opener</button>
      {showOpener && (
        <button disabled={openerOff} onClick={() => setOpen(true)}>
          Open
        </button>
      )}
      {open && (
        <Dialog
          items={items}
          startAtFirst={startAtFirst}
          onClose={() => {
            if (removeOpener) setShowOpener(false);
            if (disableOpener) setOpenerOff(true);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Open the way a keyboard user does: the opener has focus when it is pressed. */
function open(props: Parameters<typeof Page>[0] = {}) {
  render(<Page {...props} />);
  const opener = screen.getByRole('button', { name: 'Open' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}
const tab = (shiftKey = false) => fireEvent.keyDown(document, { key: 'Tab', shiftKey });

function DisabledStart() {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useDialogFocus(box, first);
  return (
    <div ref={box} role="dialog" aria-label="Dialog" tabIndex={-1}>
      <button ref={first} disabled>
        First
      </button>
      <button>Second</button>
    </div>
  );
}

describe('useDialogFocus', () => {
  it('moves focus into the dialog when it opens: to the box, or to the element it names', () => {
    open();
    expect(screen.getByRole('dialog')).toHaveFocus();
    cleanup();
    open({ startAtFirst: true });
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('falls back to the dialog itself when the element it was told to focus cannot take focus', () => {
    render(<DisabledStart />);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('wraps Tab from the last element to the first, and Shift+Tab from the first to the last', () => {
    open({ startAtFirst: true });
    screen.getByRole('button', { name: 'Last' }).focus();
    expect(tab()).toBe(false);
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    expect(tab(true)).toBe(false);
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('wraps Shift+Tab from the box itself to the last element', () => {
    open();
    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(tab(true)).toBe(false);
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('leaves Tab alone in the middle of the dialog, for the browser to move on', () => {
    open({ startAtFirst: true });
    screen.getByRole('button', { name: 'Middle' }).focus();
    expect(tab()).toBe(true);
    expect(tab(true)).toBe(true);
    expect(screen.getByRole('button', { name: 'Middle' })).toHaveFocus();
  });

  it('brings focus back in when it has got out, in either direction', () => {
    open({ startAtFirst: true });
    screen.getByRole('button', { name: 'Before' }).focus();
    expect(tab()).toBe(false);
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    screen.getByRole('button', { name: 'Before' }).focus();
    expect(tab(true)).toBe(false);
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('keeps focus on the box when there is nothing in it to move to', () => {
    open({ items: false });
    expect(tab()).toBe(false);
    expect(tab(true)).toBe(false);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('ignores other keys', () => {
    open({ startAtFirst: true });
    screen.getByRole('button', { name: 'Last' }).focus();
    expect(fireEvent.keyDown(document, { key: 'Enter' })).toBe(true);
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('gives focus back to what opened it, when it closes', () => {
    const opener = open();
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('gives focus to the main content when what opened it is gone, as an Ack button is once the problem has closed', () => {
    open({ removeOpener: true });
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('gives focus to the main content when the same close switches the opener off, as the Email report button is while a send goes on (reviewer, 11 November)', () => {
    open({ disableOpener: true });
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('lets go of its key listener when it closes, so a page that opens many dialogs does not gather them', () => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    open({ startAtFirst: true });
    const mine = added.mock.calls.filter(([type]) => type === 'keydown').map(([, handler]) => handler);
    expect(mine.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    for (const handler of mine) expect(removed.mock.calls.some(([type, h]) => type === 'keydown' && h === handler)).toBe(true);
  });

  it('stops catching Tab once it has closed', () => {
    open({ startAtFirst: true });
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(tab()).toBe(true);
  });

  it('follows focus to the main content when what opened it is removed later, while focus is on it', async () => {
    const opener = open();
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(opener).toHaveFocus();
    // A refresh of the list takes the button away; the click does not move focus, as a timer would not.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove opener' }));
    });
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
