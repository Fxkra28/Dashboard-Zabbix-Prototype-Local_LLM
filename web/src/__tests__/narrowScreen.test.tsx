import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Layout from '../features/shell/Layout';
import { NARROW_QUERY, useNarrowScreen, useSidebarRail } from '../features/shell/useUiPrefs';
import { stylesheet as styles } from './stylesheet';

const RAIL_KEY = 'hcml.sidebar.collapsed';

// A window of a set width. matchMedia answers a max-width query from it and tells its listeners when it moves.
let width: number;
let listeners: Set<() => void>;
const resize = (to: number) => {
  width = to;
  act(() => listeners.forEach((fn) => fn()));
};

beforeEach(() => {
  width = 1280;
  listeners = new Set();
  localStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1]);
    return {
      get matches() {
        return width <= max;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('useNarrowScreen (UX-14)', () => {
  it.each([
    [320, true],
    [390, true],
    [719, true],
    [719.5, true],
    [720, false],
    [1280, false],
  ])('at %s px wide it says %s', (px, narrow) => {
    width = px;
    const { result } = renderHook(() => useNarrowScreen());
    expect(result.current).toBe(narrow);
  });

  it('follows the window as it is resized or zoomed, and lets go on unmount', () => {
    const { result, unmount } = renderHook(() => useNarrowScreen());
    expect(result.current).toBe(false);
    resize(640);
    expect(result.current).toBe(true);
    resize(1280);
    expect(result.current).toBe(false);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('says no where the browser cannot answer, rather than breaking the page', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useNarrowScreen());
    expect(result.current).toBe(false);
  });
});

describe('useSidebarRail on a narrow screen (UX-14)', () => {
  it('keeps what it did before on a wide one: the Dashboard starts as a rail, other pages do not', () => {
    expect(renderHook(() => useSidebarRail('/')).result.current).toEqual([true, expect.any(Function), false]);
    expect(renderHook(() => useSidebarRail('/problems')).result.current).toEqual([false, expect.any(Function), false]);
  });

  it('forces the rail on any page, even for someone who chose the full sidebar', () => {
    localStorage.setItem(RAIL_KEY, 'false');
    width = 390;
    const { result } = renderHook(() => useSidebarRail('/problems'));
    expect(result.current[0]).toBe(true);
    expect(result.current[2]).toBe(true);
  });

  it('does not save the forced rail, so a wider window gives back what was chosen', () => {
    localStorage.setItem(RAIL_KEY, 'false');
    width = 390;
    const { result } = renderHook(() => useSidebarRail('/problems'));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(RAIL_KEY)).toBe('false');

    resize(1280);
    expect(result.current[0]).toBe(false);
    expect(result.current[2]).toBe(false);
  });

  it('leaves nothing stored for someone who never chose', () => {
    width = 320;
    renderHook(() => useSidebarRail('/problems'));
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
  });

  it('ignores the toggle while the rail is forced, and still saves it on a wide screen', () => {
    width = 390;
    const narrow = renderHook(() => useSidebarRail('/problems'));
    act(() => narrow.result.current[1]());
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
    narrow.unmount();

    width = 1280;
    const wide = renderHook(() => useSidebarRail('/problems'));
    act(() => wide.result.current[1]());
    expect(wide.result.current[0]).toBe(true);
    expect(localStorage.getItem(RAIL_KEY)).toBe('true');
  });
});

/** The shell on its own: nothing answers fetch, and the page inside is empty. */
function shell() {
  vi.stubGlobal('fetch', () => new Promise(() => undefined));
  return render(
    <MemoryRouter initialEntries={['/problems']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
const app = (c: HTMLElement) => c.querySelector('.app') as HTMLElement;

describe('the shell at a narrow width (UX-14)', () => {
  it('shows the rail and no toggle at 390 px, but still has the sidebar and its links', () => {
    width = 390;
    const { container } = shell();
    expect(app(container)).toHaveClass('rail');
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sidebar/i })).toBeNull();
  });

  it('shows the full sidebar and its toggle at 1280 px, as before', () => {
    const { container } = shell();
    expect(app(container)).not.toHaveClass('rail');
    expect(screen.getByRole('button', { name: 'Collapse the sidebar' })).toBeInTheDocument();
  });

  it('turns the rail on and off as the window crosses 720 px', () => {
    width = 721;
    const { container } = shell();
    expect(app(container)).not.toHaveClass('rail');
    resize(719);
    expect(app(container)).toHaveClass('rail');
    expect(screen.queryByRole('button', { name: /sidebar/i })).toBeNull();
    resize(721);
    expect(app(container)).not.toHaveClass('rail');
    expect(screen.getByRole('button', { name: 'Collapse the sidebar' })).toBeInTheDocument();
  });

  it('keeps the rail a person chose on a wide screen', () => {
    localStorage.setItem(RAIL_KEY, 'true');
    const { container } = shell();
    expect(app(container)).toHaveClass('rail');
    expect(screen.getByRole('button', { name: 'Expand the sidebar' })).toBeInTheDocument();
  });
});

describe('the stylesheet agrees with the hook (UX-14)', () => {
  /** The text between the braces of the first rule that opens with `head`. */
  const block = (head: string) => {
    const start = styles.indexOf(head);
    expect(start, `${head} is in the stylesheet`).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = styles.indexOf('{', start); i < styles.length; i++) {
      if (styles[i] === '{') depth++;
      if (styles[i] === '}' && --depth === 0) return styles.slice(styles.indexOf('{', start) + 1, i);
    }
    throw new Error(`${head} is never closed`);
  };

  it('changes the topbar and the padding at the same width that forces the rail', () => {
    const narrow = block(`@media ${NARROW_QUERY}`);
    expect(narrow).toMatch(/\.topbar\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(narrow).toMatch(/\.topbar\s*\{[^}]*padding-left:\s*var\(--s-3\)[^}]*padding-right:\s*var\(--s-3\)/);
    expect(narrow).toMatch(/\.content\s*\{[^}]*padding:\s*var\(--s-4\) var\(--s-3\) var\(--s-8\)/);
  });

  it('takes its width from the --bp-md token, 0.02 px under it', () => {
    const bp = /--bp-md:\s*(\d+)px/.exec(styles)?.[1];
    expect(bp, '--bp-md is a token').toBeDefined();
    expect(NARROW_QUERY).toBe(`(max-width: ${(Number(bp) - 0.02).toFixed(2)}px)`);
  });

  it('still has the rail the hook relies on, 68 px wide', () => {
    expect(block('.app.rail {')).toMatch(/grid-template-columns:\s*68px 1fr/);
  });
});

describe('the sign-in card at a width of 320 CSS pixels (UX-40)', () => {
  /** The declarations of the rule `selector { ... }` that stands alone in the stylesheet, outside any media query. */
  const rule = (selector: string) => {
    const found = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(styles);
    expect(found, `${selector} is in the stylesheet`).not.toBeNull();
    return found![1]!;
  };

  it('is as wide as its box allows up to 360 px, instead of a fixed 360 px that scrolls the page sideways', () => {
    const card = rule('.login-card');
    expect(card).toMatch(/width:\s*100%/);
    expect(card).toMatch(/max-width:\s*360px/);
    expect(card).not.toMatch(/(^|[;\s])width:\s*360px/);
  });

  it('keeps a margin to each edge of the page, so it does not touch the screen at 360 px', () => {
    expect(rule('.login-wrap')).toMatch(/padding:\s*var\(--s-4\)/);
  });

  it('is measured with its padding inside its width, so 100% plus padding does not overflow', () => {
    expect(styles).toMatch(/(^|\})\s*\*\s*\{[^}]*box-sizing:\s*border-box/);
  });
});

describe('the foot of a dialog at 320 CSS pixels (reviewer, 11 November)', () => {
  const rule = (selector: string) => {
    const found = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.>:()]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(styles);
    expect(found, `${selector} is in the stylesheet`).not.toBeNull();
    return found![1]!;
  };

  // A send that takes long shows three buttons (Cancel, Close the send continues, Sending): about 330 px against 248 inside the box.
  it('lets its buttons wrap, so the way out is never pushed past the edge of the box', () => {
    expect(rule('.modal-foot')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('keeps the last button at the right edge when the row wraps, and only when there is more than one', () => {
    expect(rule('.modal-foot > :last-child:not(:first-child)')).toMatch(/margin-left:\s*auto/);
  });
});
