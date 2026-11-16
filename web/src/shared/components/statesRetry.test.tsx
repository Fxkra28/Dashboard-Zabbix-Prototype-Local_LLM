import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../api';
import { resetAuthProbe } from '../hooks/useAuth';
import { Async, ErrorState, Loaded } from './states';

/**
 * Two small things of the shared states. Content dimmed while a new selection loads is out of reach of the keyboard as well as the mouse, so that a button
 * inside it cannot act on the old data (FR-54); and a failed load on a page that does not poll says how to try again, with a button that does (UX-49).
 */

beforeEach(() => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
});

describe('Loaded (FR-54)', () => {
  it('makes the content inert while it belongs to the previous selection, so that Tab and Enter do not reach it', () => {
    const { container } = render(
      <Loaded stale>
        <button type="button">Download CSV</button>
      </Loaded>,
    );
    expect(container.firstElementChild).toHaveAttribute('inert');
    expect(container.firstElementChild).toHaveClass('stale');
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
  });

  it('leaves the content alone once it is current', () => {
    const { container } = render(
      <Loaded>
        <button type="button">Download CSV</button>
      </Loaded>,
    );
    expect(container.firstElementChild).not.toHaveAttribute('inert');
    expect(container.firstElementChild).not.toHaveClass('stale');
  });

  it('is inert through Async too, while the new selection loads over the old data', () => {
    const { container } = render(
      <Async loading error={null} data={{ n: 1 }} stale>
        {() => <button type="button">Download CSV</button>}
      </Async>,
    );
    expect(container.querySelector('[inert]')).not.toBeNull();
  });
});

describe('ErrorState (UX-49)', () => {
  it('has a Try again button when it is given a way to try again, and the button calls it', async () => {
    const retry = vi.fn();
    render(<ErrorState message="Failed to fetch" onRetry={retry} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('has no button when it is given none, as on a page that polls and tries again by itself', () => {
    render(<ErrorState message="Failed to fetch" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no button for a page the signed-in role may not open: nothing failed, and trying again would not help', () => {
    render(<ErrorState message={'This page needs the "admin" role; you are signed in as "viewer".'} onRetry={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('is reached by the keyboard, and says what it does in its own name', async () => {
    const retry = vi.fn();
    render(<ErrorState message="Failed to fetch" onRetry={retry} />);
    const button = screen.getByRole('button', { name: 'Try again' });
    button.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(retry).toHaveBeenCalled();
  });
});

describe('Async and the retry (UX-49)', () => {
  it('hands its retry to the error it shows, when nothing of this selection is there to show', async () => {
    const retry = vi.fn();
    render(
      <Async loading={false} error="Failed to fetch" data={null} onRetry={retry}>
        {() => <div>data</div>}
      </Async>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows no retry while a failed poll keeps the last good data on screen, with its own note', () => {
    render(
      <Async loading={false} error="Failed to fetch" data={{ n: 1 }} onRetry={() => undefined}>
        {() => <div>data</div>}
      </Async>,
    );
    expect(screen.getByText('data')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

// UX-57: a pager inside the content that goes inert while the next page loads lost its focus, the moment the person pressed it.
describe('Async and a footer that stays reachable (UX-57)', () => {
  it('draws the footer outside what is dimmed and inert while the new selection loads, and the content inside it', () => {
    const { container } = render(
      <Async loading error={null} data={{ n: 1 }} stale footer={() => <button type="button">Next ›</button>}>
        {() => <button type="button">Download CSV</button>}
      </Async>,
    );
    const inert = container.querySelector('[inert]');
    expect(inert).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Download CSV' }).closest('[inert]')).toBe(inert);
    expect(screen.getByRole('button', { name: 'Next ›' }).closest('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Next ›' }).closest('.stale')).toBeNull();
  });

  it('hands the footer the data, once it is there', () => {
    render(
      <Async loading={false} error={null} data={{ total: 7 }} footer={(d) => <span>of {d.total}</span>}>
        {() => <div>rows</div>}
      </Async>,
    );
    expect(screen.getByText('of 7')).toBeInTheDocument();
  });

  it('draws no footer while there is nothing to page, or when the new selection failed to load', () => {
    const footer = () => <button type="button">Next ›</button>;
    const { rerender } = render(
      <Async loading error={null} data={null} footer={footer}>
        {() => <div>rows</div>}
      </Async>,
    );
    expect(screen.queryByRole('button', { name: 'Next ›' })).toBeNull();
    // The old page is not a page of what failed.
    rerender(
      <Async loading={false} error="Failed to fetch" data={{ n: 1 }} stale footer={footer}>
        {() => <div>rows</div>}
      </Async>,
    );
    expect(screen.queryByRole('button', { name: 'Next ›' })).toBeNull();
    rerender(
      <Async loading={false} error="Failed to fetch" data={null} footer={footer}>
        {() => <div>rows</div>}
      </Async>,
    );
    expect(screen.queryByRole('button', { name: 'Next ›' })).toBeNull();
  });

  it('keeps the same output as before for a caller with no footer', () => {
    const { container } = render(
      <Async loading={false} error={null} data={{ n: 1 }}>
        {() => <div>rows</div>}
      </Async>,
    );
    expect(container.children).toHaveLength(1);
  });
});
