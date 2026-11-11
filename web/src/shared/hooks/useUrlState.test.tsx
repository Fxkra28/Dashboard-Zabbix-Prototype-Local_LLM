import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useSearchPatch, useUrlState } from './useUrlState';

const wrapper = ({ children }: { children: ReactNode }) => <BrowserRouter>{children}</BrowserRouter>;
const at = (url: string) => window.history.replaceState(null, '', url);
const query = () => new URLSearchParams(window.location.search);

beforeEach(() => at('/problems'));
afterEach(() => vi.useRealTimers());

describe('useUrlState', () => {
  it('reads a value from the URL, and the default when it is missing or not allowed', () => {
    at('/problems?sev=4&acked=1&sort=age&page=x');
    const { result } = renderHook(
      () => ({
        sev: useUrlState<number>('sev', 0)[0],
        acked: useUrlState<boolean>('acked', false)[0],
        sort: useUrlState<string>('sort', 'severity', { options: ['severity', 'host'] })[0],
        page: useUrlState<number>('page', 1)[0],
      }),
      { wrapper },
    );
    expect(result.current).toEqual({ sev: 4, acked: true, sort: 'severity', page: 1 });
  });

  it('writes a change to the URL and leaves the default out', () => {
    const { result } = renderHook(() => useUrlState<number>('sev', 0), { wrapper });
    act(() => result.current[1](5));
    expect(query().get('sev')).toBe('5');
    expect(result.current[0]).toBe(5);
    act(() => result.current[1](0));
    expect(query().has('sev')).toBe(false);
  });

  it('replaces the history entry, so ten changes still leave one Back step', () => {
    const { result } = renderHook(() => useUrlState<string>('q', ''), { wrapper });
    const before = window.history.length;
    for (const q of ['a', 'ab', 'abc']) act(() => result.current[1](q));
    expect(window.history.length).toBe(before);
    expect(query().get('q')).toBe('abc');
  });

  it('shows typing at once and writes the URL once typing pauses', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUrlState<string>('q', '', { debounceMs: 300 }), { wrapper });
    act(() => result.current[1]('cor'));
    expect(result.current[0]).toBe('cor');
    expect(query().has('q')).toBe(false);
    act(() => vi.advanceTimersByTime(300));
    expect(query().get('q')).toBe('cor');
  });
});

describe('useSearchPatch', () => {
  it('lands every patch made in one event', () => {
    const { result } = renderHook(() => useSearchPatch(), { wrapper });
    act(() => {
      result.current({ sev: '4' });
      result.current({ host: 'core-1' });
    });
    expect(query().get('sev')).toBe('4');
    expect(query().get('host')).toBe('core-1');
  });

  it('does not write onto a page the user already left', () => {
    const { result } = renderHook(() => useSearchPatch(), { wrapper });
    at('/hosts');
    act(() => result.current({ sev: '4' }));
    expect(window.location.pathname).toBe('/hosts');
    expect(query().has('sev')).toBe(false);
  });
});
