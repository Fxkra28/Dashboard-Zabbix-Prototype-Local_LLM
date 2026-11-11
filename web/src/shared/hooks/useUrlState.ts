import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Change query-string parameters in place: `null` or `''` removes one.
 *
 * Replaces the history entry rather than pushing one, so a filter changed ten times still leaves
 * one Back step. Reads the live URL rather than the render's copy, so several patches in one event
 * all land: React Router's own `setSearchParams(prev => …)` hands every call the same render-time
 * `prev`, and the second call undoes the first.
 */
export function useSearchPatch(): (patch: Record<string, string | null>) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (patch) => {
      // A late write (a debounce firing) must not land on the page navigated to.
      if (window.location.pathname !== pathname) return;
      const params = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') params.delete(k);
        else params.set(k, v);
      }
      const search = params.toString() ? `?${params}` : '';
      if (search === window.location.search) return;
      navigate({ search, hash: window.location.hash }, { replace: true });
    },
    [navigate, pathname],
  );
}

type UrlValue = string | number | boolean;

function parse<T extends UrlValue>(raw: string | null, fallback: T, options?: readonly T[]): T {
  if (raw === null) return fallback;
  let value: UrlValue;
  if (typeof fallback === 'number') {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return fallback;
    value = n;
  } else if (typeof fallback === 'boolean') {
    value = raw === '1' || raw === 'true';
  } else {
    value = raw;
  }
  return options && !options.includes(value as T) ? fallback : (value as T);
}

const serialize = (v: UrlValue) => (typeof v === 'boolean' ? (v ? '1' : '0') : String(v));

/**
 * One piece of page state, a filter, a sort, a selection, kept in the query
 * string, so Back to the page (and a shared link) restores it. The default
 * value is left out of the URL.
 *
 * - `options`: the values accepted from the URL; anything else reads as the default.
 * - `debounceMs`: for text inputs: the value updates at once, the URL once
 *   typing pauses (browsers throttle a history write per keystroke).
 *
 * The setter keeps one identity for a given key, fallback and debounce.
 */
export function useUrlState<T extends UrlValue>(
  key: string,
  fallback: T,
  { options, debounceMs }: { options?: readonly T[]; debounceMs?: number } = {},
): [T, (value: T) => void] {
  const { search } = useLocation();
  const patch = useSearchPatch();
  const fromUrl = parse(new URLSearchParams(search).get(key), fallback, options);

  // What was just set, shown until the URL: updated in a transition, or after
  // the debounce, says the same. Without it a controlled input could briefly
  // render the old value mid-typing and lose the caret.
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (draft && timer.current === undefined && Object.is(draft.value, fromUrl)) setDraft(null);
  }, [draft, fromUrl]);

  const setValue = useCallback(
    (value: T) => {
      const write = () => {
        timer.current = undefined;
        patch({ [key]: Object.is(value, fallback) ? null : serialize(value) });
        // Unchanged URL (or a value the URL can't hold): nothing to wait for.
        setDraft((d) => (d && Object.is(d.value, value) ? { value } : d));
      };
      setDraft({ value });
      window.clearTimeout(timer.current);
      if (debounceMs) timer.current = window.setTimeout(write, debounceMs);
      else write();
    },
    [patch, key, fallback, debounceMs],
  );

  return [draft ? draft.value : fromUrl, setValue];
}
