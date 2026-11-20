import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useUrlRange } from './RangePicker';

/** The graph range as an address says it: a preset, a month, or two times; anything else is the default, and the first reading that fits wins (FR-76). */

const at = (url: string) => renderHook(() => useUrlRange(24), { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter> }).result.current[0];

describe('reading a range from the address', () => {
  it('is the default of the page when the address says nothing', () => {
    expect(at('/graphs')).toEqual({ kind: 'hours', hours: 24 });
  });

  it('reads a preset, and any whole number of hours or days up to a year', () => {
    expect(at('/graphs?range=7d')).toEqual({ kind: 'hours', hours: 168 });
    expect(at('/graphs?range=9d')).toEqual({ kind: 'hours', hours: 216 });
    expect(at('/graphs?range=36h')).toEqual({ kind: 'hours', hours: 36 });
    expect(at('/graphs?range=365d')).toEqual({ kind: 'hours', hours: 8_760 });
  });

  it('falls back to the default for what is not a count of hours or days, zero, or more than a year', () => {
    for (const range of ['', 'week', '7', '7w', '-3d', '1.5d', '0h', '0d', '366d', '8761h', 'd7']) {
      expect(at(`/graphs?range=${range}`), `range=${range}`).toEqual({ kind: 'hours', hours: 24 });
    }
  });

  it('reads a calendar month, and only a real one', () => {
    expect(at('/graphs?month=2026-08')).toEqual({ kind: 'month', month: '2026-08' });
    expect(at('/graphs?month=2026-13')).toEqual({ kind: 'hours', hours: 24 });
    expect(at('/graphs?month=August')).toEqual({ kind: 'hours', hours: 24 });
  });

  it('reads two times, when the second is after the first and both are real', () => {
    expect(at('/graphs?from=1790000000&to=1790086400')).toEqual({ kind: 'custom', from: 1_790_000_000, to: 1_790_086_400 });
    expect(at('/graphs?from=1790086400&to=1790000000')).toEqual({ kind: 'hours', hours: 24 });
    expect(at('/graphs?from=1790000000&to=1790000000')).toEqual({ kind: 'hours', hours: 24 });
    expect(at('/graphs?from=abc&to=def')).toEqual({ kind: 'hours', hours: 24 });
    expect(at('/graphs?from=-5&to=10')).toEqual({ kind: 'hours', hours: 24 });
    expect(at('/graphs?from=1790000000')).toEqual({ kind: 'hours', hours: 24 });
  });

  it('prefers a month to two times to a preset, when an address names more than one', () => {
    expect(at('/graphs?month=2026-08&from=1790000000&to=1790086400&range=7d')).toEqual({ kind: 'month', month: '2026-08' });
    expect(at('/graphs?from=1790000000&to=1790086400&range=7d')).toEqual({ kind: 'custom', from: 1_790_000_000, to: 1_790_086_400 });
  });

  it('keeps the default of the page it was given', () => {
    const range = renderHook(() => useUrlRange(168), { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/network']}>{children}</MemoryRouter> }).result.current[0];
    expect(range).toEqual({ kind: 'hours', hours: 168 });
  });
});
