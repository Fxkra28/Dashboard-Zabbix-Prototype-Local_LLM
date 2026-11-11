import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { HIGHLIGHT_MS, useChangeHighlight } from './useChangeHighlight';
import { topRows } from '../dashboard/liveList';
import type { Problem } from '../../types';
import { problem } from '../../__tests__/problems';
import { stylesheet } from '../../__tests__/stylesheet';

const none: ReadonlySet<string> = new Set();

/** The hook as the Dashboard mounts it, with the list, the held set and `on` as props. */
function mount(open: Problem[], held: ReadonlySet<string> = none, on = true) {
  return renderHook((p: { open: Problem[]; held: ReadonlySet<string>; on: boolean }) =>
    useChangeHighlight(p.open, p.held, p.on, topRows), { initialProps: { open, held, on } });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useChangeHighlight', () => {
  const a = problem(1, 4, 600);
  const b = problem(2, 3, 300);

  it('lasts as long as the tint the stylesheet fades out (--dur-highlight)', () => {
    const [, value, unit] = /--dur-highlight:\s*(\d+(?:\.\d+)?)(ms|s);/.exec(stylesheet) ?? [];
    expect(value, '--dur-highlight is a token').toBeDefined();
    expect(Number(value) * (unit === 's' ? 1000 : 1)).toBe(HIGHLIGHT_MS);
  });

  it('marks nothing on the first list', () => {
    const { result } = mount([a, b]);
    expect(result.current.marks.size).toBe(0);
  });

  it('marks a new problem, then lets the mark go', () => {
    const { result, rerender } = mount([a]);
    rerender({ open: [a, b], held: none, on: true });
    expect(result.current.marks.get('2')).toBe('new');
    act(() => vi.advanceTimersByTime(HIGHLIGHT_MS + 100));
    expect(result.current.marks.size).toBe(0);
  });

  it('keeps a cleared problem on screen for a while, marked', () => {
    const { result, rerender } = mount([a, b]);
    rerender({ open: [a], held: none, on: true });
    expect(result.current.marks.get('2')).toBe('cleared');
    expect(result.current.cleared.map((p) => p.eventid)).toEqual(['2']);
    act(() => vi.advanceTimersByTime(HIGHLIGHT_MS + 100));
    expect(result.current.cleared).toHaveLength(0);
  });

  it('does not mark a problem going into maintenance or coming out of it', () => {
    const { result, rerender } = mount([a, b]);
    const held = new Set(['2']);
    rerender({ open: [a], held, on: true });
    expect(result.current.marks.size).toBe(0);
    rerender({ open: [a, b], held: none, on: true });
    expect(result.current.marks.size).toBe(0);
  });

  it('marks nothing while off, and nothing from then once turned on', () => {
    const { result, rerender } = mount([a], none, false);
    rerender({ open: [a, b], held: none, on: false });
    expect(result.current.marks.size).toBe(0);
    rerender({ open: [a, b], held: none, on: true });
    expect(result.current.marks.size).toBe(0);
  });

  it('lets a cleared row go for good once worse problems push it off', () => {
    const low = problem(3, 1, 60);
    const { result, rerender } = mount([a, low]);
    rerender({ open: [a], held: none, on: true });
    expect(result.current.marks.get('3')).toBe('cleared');
    const worse = Array.from({ length: 11 }, (_, i) => problem(100 + i, 5, i));
    rerender({ open: [a, ...worse], held: none, on: true });
    expect(result.current.marks.has('3')).toBe(false);
    expect(result.current.cleared).toHaveLength(0);
  });

  it('does not mark a row that clears in the same update that pushes it off', () => {
    const low = problem(5, 1, 60);
    const { result, rerender } = mount([a, low]);
    const worse = Array.from({ length: 12 }, (_, i) => problem(300 + i, 5, i));
    rerender({ open: [a, ...worse], held: none, on: true });
    expect(result.current.marks.has('5')).toBe(false);
    expect(result.current.cleared).toHaveLength(0);
  });

  it('does not mark a problem that was never on screen', () => {
    const many = Array.from({ length: 12 }, (_, i) => problem(200 + i, 5, i));
    const hidden = problem(4, 1, 60);
    const { result, rerender } = mount([...many, hidden]);
    // The list shrinks as well, so the hidden one would have had a place.
    rerender({ open: many.slice(1), held: none, on: true });
    expect(result.current.marks.get(many[0].eventid)).toBe('cleared');
    expect(result.current.marks.has('4')).toBe(false);
  });
});
