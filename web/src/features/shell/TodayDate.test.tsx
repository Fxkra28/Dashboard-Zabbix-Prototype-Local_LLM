import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import TodayDate from './TodayDate';
import { formatDate } from '../../shared/lib/time';

afterEach(() => vi.useRealTimers());

describe('TodayDate', () => {
  it('turns over at midnight in the report zone on a tab that stays open (FR-08)', () => {
    vi.useFakeTimers();
    // 23:59:30 on 7 October in Jakarta, whatever zone this machine is in.
    vi.setSystemTime(Date.UTC(2026, 9, 7, 16, 59, 30));
    render(<TodayDate />);
    const seventh = formatDate(Date.UTC(2026, 9, 7, 12));
    const eighth = formatDate(Date.UTC(2026, 9, 8, 12));
    expect(seventh).not.toBe(eighth);
    expect(screen.getByText(seventh)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText(eighth)).toBeInTheDocument();
    expect(screen.queryByText(seventh)).toBeNull();
  });
});
