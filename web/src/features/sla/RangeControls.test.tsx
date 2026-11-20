import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RangeControls from './RangeControls';
import { resetServerClock } from '../../shared/lib/clock';
import { ALL_DAY, type RangeChoice } from './rangeWindow';

/**
 * The lists of months and years follow the day the controls are drawn on (FR-67): a page left open across the first of a month, or across the day a year passes out of what the server answers for,
 * offers what is true when it is drawn again, and not what was true when it was first drawn.
 */

const choice: RangeChoice = { mode: 'year', day: '2026-11-18', month: '2026-10', year: 2026, fromDate: '2026-11-01', fromHour: 0, toDate: '2026-11-02', toHour: 0 };
const props = { choice, onChoice: () => undefined, hours: ALL_DAY, onHours: () => undefined, zone: 'Asia/Jakarta' };
const optionsOf = (label: string) => [...screen.getByLabelText(label).querySelectorAll('option')].map((o) => o.textContent);

beforeEach(() => {
  resetServerClock();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-19T05:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('the years of the Year choice', () => {
  it('are those of the day it is drawn on, again when drawn on another day', () => {
    const { rerender } = render(<RangeControls {...props} />);
    expect(optionsOf('Year')).toEqual(['2026']);
    vi.setSystemTime(Date.parse('2027-01-15T05:00:00Z'));
    rerender(<RangeControls {...props} />);
    expect(optionsOf('Year')).toEqual(['2027', '2026']);
    vi.setSystemTime(Date.parse('2027-02-07T05:00:00Z'));
    // The first midnight of 2026 is more than 400 days back: last year is no longer offered (the year that is chosen stays in its own list, so this is drawn with 2027 chosen).
    rerender(<RangeControls {...props} choice={{ ...choice, year: 2027 }} />);
    expect(optionsOf('Year')).toEqual(['2027']);
  });
});

describe('the months of the Month choice', () => {
  it('start with the month of the day it is drawn on, again when drawn on the first of the next', () => {
    const { rerender } = render(<RangeControls {...props} choice={{ ...choice, mode: 'month' }} />);
    expect(optionsOf('Month')[0]).toBe('Nov 2026');
    vi.setSystemTime(Date.parse('2026-12-01T05:00:00Z'));
    rerender(<RangeControls {...props} choice={{ ...choice, mode: 'month' }} />);
    expect(optionsOf('Month')[0]).toBe('Dec 2026');
  });
});
