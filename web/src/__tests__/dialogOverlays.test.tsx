import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { api } from '../api';
import AckDialog from '../features/problems/AckDialog';
import { ProblemExplainPanel } from '../features/assistant/ExplainPanel';
import ReportDialog from '../features/sla/ReportDialog';
import { problem } from './problems';
import { stylesheet } from './stylesheet';

/**
 * What the three dialogs of the portal (Acknowledge, Explain, and the report frame under Email, Schedule and the style choices)
 * share: the page behind them does not scroll while one is open (UX-43), the role of a dialog sits on an element that may carry it
 * (UX-45), and each is drawn on the page, so that a wrapper with a transform cannot become its frame (UX-46).
 */

const dialogs: [string, (onClose: () => void) => ReactElement][] = [
  ['the Acknowledge dialog', (onClose) => <AckDialog problem={problem(1, 4, 600)} onClose={onClose} onDone={() => undefined} />],
  ['the Explain drawer', (onClose) => <ProblemExplainPanel problem={problem(1, 3)} onClose={onClose} />],
  [
    'the report dialog',
    (onClose) => (
      <ReportDialog title="A title" onClose={onClose} actions={null}>
        <p>Body</p>
      </ReportDialog>
    ),
  ],
];

/** The page's way of closing a dialog: it stops drawing it. */
function Page({ make }: { make: (onClose: () => void) => ReactElement }) {
  const [open, setOpen] = useState(true);
  return open ? make(() => setOpen(false)) : <p>closed</p>;
}

const root = document.documentElement;
beforeEach(() => {
  vi.spyOn(api, 'freshness').mockResolvedValue({ lastCollectedAt: 1_799_999_960, ageSeconds: 40, stale: false, staleAfterSeconds: 600, pinged: 0, answering: 0, reachLost: false });
  vi.spyOn(api, 'explainProblem').mockResolvedValue({ summary: 'A link is down.', tagsExplained: [], businessImpact: 'None.', recommendation: 'Check it.' });
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 1, ai: true, writeBack: false, defaults: { availabilityMinSeverity: 2 } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  root.style.overflow = '';
});

describe('the page behind a dialog (UX-43)', () => {
  it.each(dialogs)('does not scroll while %s is open, and scrolls again when it is gone', (_name, make) => {
    const view = render(make(() => undefined));
    expect(root.style.overflow).toBe('hidden');
    view.unmount();
    expect(root.style.overflow).toBe('');
  });

  it.each(dialogs)('is released when %s is closed with Escape', (_name, make) => {
    render(<Page make={make} />);
    expect(root.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(root.style.overflow).toBe('');
  });

  it.each(dialogs)('is released when %s is closed with its cross', (_name, make) => {
    render(<Page make={make} />);
    expect(root.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: /^Close/ }));
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(root.style.overflow).toBe('');
  });

  it.each(dialogs)('is released when %s is closed by a click on the backdrop', (_name, make) => {
    render(<Page make={make} />);
    expect(root.style.overflow).toBe('hidden');
    const overlay = document.querySelector('.drawer-overlay')!;
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(root.style.overflow).toBe('');
  });
});

describe('the element that carries the role of a dialog (UX-45)', () => {
  it.each(dialogs)('is not a form in %s, which HTML lets take no such role', (_name, make) => {
    render(make(() => undefined));
    const dialog = screen.getByRole('dialog');
    expect(['FORM', 'ASIDE']).not.toContain(dialog.tagName);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName();
  });

  it.each([dialogs[0]!, dialogs[2]!])('wraps the form of %s inside the dialog, with no role of its own', (_name, make) => {
    render(make(() => undefined));
    const dialog = screen.getByRole('dialog');
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    expect(form).not.toHaveAttribute('role');
    expect(form!.querySelector('header')).not.toBeNull();
    expect(form!.querySelector('.drawer-body')).not.toBeNull();
    expect(form!.querySelector('footer')).not.toBeNull();
  });
});

describe('the head and the foot of a dialog drawn on the page (UX-45)', () => {
  it.each(dialogs)('are not landmarks in %s: outside <main>, a header and a footer would be a second banner and a second contentinfo', (_name, make) => {
    render(make(() => undefined));
    const dialog = screen.getByRole('dialog');
    const parts = dialog.querySelectorAll('header, footer');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const part of parts) expect(part).toHaveAttribute('role', 'none');
    expect(within(dialog).queryAllByRole('banner')).toEqual([]);
    expect(within(dialog).queryAllByRole('contentinfo')).toEqual([]);
  });
});

describe('a dialog called from inside a page wrapper (UX-46)', () => {
  it.each(dialogs)('draws %s on the page itself, not inside the wrapper', (_name, make) => {
    render(
      <div data-testid="wrapper" style={{ transform: 'translateX(1px)' }}>
        {make(() => undefined)}
      </div>,
    );
    expect(screen.getByTestId('wrapper').querySelector('.drawer-overlay')).toBeNull();
    expect(document.querySelector('.drawer-overlay')!.parentElement).toBe(document.body);
  });
});

describe('the entrance of the page content (UX-46)', () => {
  it('ends with the page content as it is, and not holding the last frame, which a dialog inside it would be framed by', () => {
    const rule = /(?:^|\n|\})[ \t]*\.content > \*\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? '';
    expect(rule).toMatch(/animation:\s*soft-rise/);
    expect(rule).not.toMatch(/\b(both|forwards)\b/);
    expect(rule).toMatch(/\bbackwards\b/);
  });
});
