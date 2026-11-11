import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import themeScript from '../../public/theme.js?raw';
import { THEME_KEY } from '../features/shell/useUiPrefs';

/** The theme picked in the portal is on <html> before the first paint, so a page never fades in from the computer's colours. */

const run = () => new Function(themeScript)();
const root = document.documentElement;

afterEach(() => {
  root.removeAttribute('data-theme');
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('public/theme.js', () => {
  it.each(['light', 'dark'])('puts a stored %s on <html>', (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    run();
    expect(root.getAttribute('data-theme')).toBe(theme);
  });

  it.each([null, 'system', 'blue'])('leaves <html> to the computer when the stored choice is %s', (stored) => {
    if (stored !== null) localStorage.setItem(THEME_KEY, stored);
    run();
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('does not stop the page where storage throws, as in private mode', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(run).not.toThrow();
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('reads the key the theme picker writes', () => {
    expect(themeScript).toContain(`'${THEME_KEY}'`);
  });
});

describe('index.html', () => {
  it('loads it as a plain script in <head>, ahead of the app, so the first paint waits for it', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    expect(head).toMatch(/<script src="\/theme\.js"><\/script>/);
    expect(indexHtml.indexOf('/theme.js')).toBeLessThan(indexHtml.indexOf('/src/main.tsx'));
  });
});
