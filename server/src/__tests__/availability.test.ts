import { describe, expect, it } from 'vitest';
import { mergedSeconds } from '../sli/intervals.js';
import { severitiesAtLeast } from '../services/incidents.js';

/**
 * Availability is computed by merging problem intervals. Getting this wrong
 * does not throw: it produces a plausible-looking percentage that is simply
 * false, which is the worst failure this codebase can have. Hence the detail.
 */
describe('mergedSeconds', () => {
  it('returns zero for no intervals', () => {
    expect(mergedSeconds([])).toEqual({ total: 0, longest: 0 });
  });

  it('measures a single interval', () => {
    expect(mergedSeconds([[100, 160]])).toEqual({ total: 60, longest: 60 });
  });

  it('adds disjoint intervals', () => {
    expect(mergedSeconds([
      [0, 10],
      [100, 130],
    ])).toEqual({ total: 40, longest: 30 });
  });

  it('does not double-count overlapping problems', () => {
    // Two triggers firing on one host over the same window is one outage.
    // Summing them naively gave 60s of downtime in a 40s window, which is how
    // availability could once compute as negative.
    expect(mergedSeconds([
      [0, 40],
      [20, 60],
    ])).toEqual({ total: 60, longest: 60 });
  });

  it('absorbs a fully nested interval', () => {
    expect(mergedSeconds([
      [0, 100],
      [30, 40],
    ])).toEqual({ total: 100, longest: 100 });
  });

  it('joins intervals that touch exactly', () => {
    expect(mergedSeconds([
      [0, 50],
      [50, 90],
    ])).toEqual({ total: 90, longest: 90 });
  });

  it('is order-independent', () => {
    const shuffled = mergedSeconds([
      [100, 130],
      [0, 40],
      [20, 60],
    ]);
    expect(shuffled).toEqual({ total: 90, longest: 60 });
  });

  it('never exceeds the window it was given', () => {
    const window = 3600;
    const { total } = mergedSeconds([
      [0, 1800],
      [900, 2700],
      [2000, 3600],
    ]);
    expect(total).toBeLessThanOrEqual(window);
    expect(total).toBe(3600);
  });
});

describe('severitiesAtLeast', () => {
  it('lists every level at or above the floor', () => {
    expect(severitiesAtLeast(2)).toEqual([2, 3, 4, 5]);
    expect(severitiesAtLeast(0)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(severitiesAtLeast(5)).toEqual([5]);
  });

  it('clamps out-of-range input rather than producing an empty filter', () => {
    // An empty `severities` array would make Zabbix return nothing, turning a
    // bad query parameter into a silently empty report.
    expect(severitiesAtLeast(-3)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(severitiesAtLeast(99)).toEqual([5]);
    expect(severitiesAtLeast(2.7)).toEqual([2, 3, 4, 5]);
  });
});
