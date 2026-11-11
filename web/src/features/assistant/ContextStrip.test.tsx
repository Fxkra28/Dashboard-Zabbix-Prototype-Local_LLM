import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ContextStrip } from './Assistant';
import type { ChatContext } from '../../types';

/** The strip over the conversation says how old the snapshot behind the last answer is, and the age moves on its own (FR-24). */
afterEach(() => vi.useRealTimers());

const context = (generatedAt: number): ChatContext => ({
  generatedAt,
  hosts: 10,
  sites: 3,
  problems: 2,
  unacknowledged: 1,
  slas: 1,
  degradedServices: 0,
  truncated: false,
});

describe('the age of the snapshot in the Assistant', () => {
  it('moves on while the page stays open, in seconds and then in minutes', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const now = Date.now();
    render(<ContextStrip context={context(now - 12_000)} />);
    expect(screen.getByText('snapshot 12s ago')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText(/^snapshot (3[0-9]|4[0-9])s ago$/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(screen.getByText('snapshot 6 min ago')).toBeInTheDocument();
  });

  it('reads 0s for a snapshot taken a moment ago and never a negative age', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    render(<ContextStrip context={context(Date.now() + 4_000)} />);
    expect(screen.getByText('snapshot 0s ago')).toBeInTheDocument();
  });

  it('shows no age before the first answer', () => {
    render(<ContextStrip context={null} />);
    expect(screen.queryByText(/^snapshot \d/)).toBeNull();
  });
});
