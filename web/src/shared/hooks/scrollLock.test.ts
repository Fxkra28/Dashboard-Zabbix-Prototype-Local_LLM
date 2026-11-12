import { afterEach, describe, expect, it } from 'vitest';
import { lockScroll } from './scrollLock';

/** The page behind a dialog does not scroll under the mouse wheel while the dialog is open (UX-43). */

const root = document.documentElement;
afterEach(() => {
  root.style.overflow = '';
});

describe('lockScroll', () => {
  it('stops the page from scrolling, and gives back what the page had set', () => {
    root.style.overflow = 'scroll';
    const release = lockScroll();
    expect(root.style.overflow).toBe('hidden');
    release();
    expect(root.style.overflow).toBe('scroll');
  });

  it('leaves no trace when the page had set nothing', () => {
    const release = lockScroll();
    release();
    expect(root.style.overflow).toBe('');
  });

  it('holds until the last of two dialogs has gone', () => {
    const first = lockScroll();
    const second = lockScroll();
    first();
    expect(root.style.overflow).toBe('hidden');
    second();
    expect(root.style.overflow).toBe('');
  });

  it('gives back once however often a dialog lets go, so another dialog’s lock is not undone', () => {
    const first = lockScroll();
    const second = lockScroll();
    first();
    first();
    first();
    expect(root.style.overflow).toBe('hidden');
    second();
    expect(root.style.overflow).toBe('');
  });

  it('can lock again after everything was released', () => {
    lockScroll()();
    const again = lockScroll();
    expect(root.style.overflow).toBe('hidden');
    again();
    expect(root.style.overflow).toBe('');
  });
});

describe('lockScroll and the scrollbar it takes away', () => {
  const html = document.documentElement;
  const window_ = window as unknown as { innerWidth: number };
  const before = window_.innerWidth;
  const bar = (width: number) => {
    window_.innerWidth = 1024;
    Object.defineProperty(html, 'clientWidth', { value: 1024 - width, configurable: true });
  };
  afterEach(() => {
    window_.innerWidth = before;
    delete (html as unknown as Record<string, unknown>).clientWidth;
    html.style.paddingRight = '';
  });

  it('pads the page by the width of the bar, so that nothing shifts when the bar goes, and takes the padding away with it', () => {
    bar(15);
    const release = lockScroll();
    expect(html.style.paddingRight).toBe('15px');
    release();
    expect(html.style.paddingRight).toBe('');
  });

  it('adds no padding when the page has no bar to lose', () => {
    bar(0);
    const release = lockScroll();
    expect(html.style.paddingRight).toBe('');
    release();
  });

  it('gives back the padding the page had', () => {
    html.style.paddingRight = '4px';
    bar(15);
    const release = lockScroll();
    expect(html.style.paddingRight).toBe('15px');
    release();
    expect(html.style.paddingRight).toBe('4px');
  });
});

