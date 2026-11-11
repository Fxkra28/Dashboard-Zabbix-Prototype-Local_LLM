import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useFitHeight } from './useFitHeight';
import { fitBounds } from './fit';

/**
 * What the hook writes on the grid and the box around it. A test browser has no layout, so the grid is given one: 100 wide a tile, as many to a row as its
 * width allows, in a box 1000 wide that starts 100 down a window 600 tall.
 */

const original = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  rect: HTMLElement.prototype.getBoundingClientRect,
  innerHeight: window.innerHeight,
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const tiles = Number(this.dataset.tiles);
      if (!tiles) return 0;
      const width = parseFloat(this.style.width) || 1000;
      return Math.ceil(tiles / Math.floor(width / 100)) * 100;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 100, left: 0, right: 0, width: 0, height: 0, x: 0, y: 100, toJSON: () => ({}) });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
});
afterEach(() => {
  if (original.clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original.clientWidth);
  if (original.offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original.offsetHeight);
  HTMLElement.prototype.getBoundingClientRect = original.rect;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: original.innerHeight });
});

function Box({ enabled, tiles }: { enabled: boolean; tiles: number }) {
  const { wrap, inner } = useFitHeight<HTMLDivElement, HTMLDivElement>(enabled, [tiles]);
  return (
    <div ref={wrap} data-testid="wrap">
      <div ref={inner} data-testid="inner" data-tiles={tiles} />
    </div>
  );
}
const parts = (c: HTMLElement) => ({ wrap: c.querySelector('[data-testid=wrap]') as HTMLElement, inner: c.querySelector('[data-testid=inner]') as HTMLElement });

describe('useFitHeight', () => {
  it('writes nothing when the grid fits: 40 tiles are 4 rows of 100 in the 468 left', () => {
    const { container } = render(<Box enabled tiles={40} />);
    const { wrap, inner } = parts(container);
    expect(inner.getAttribute('style') ?? '').toBe('');
    expect(wrap.getAttribute('style') ?? '').toBe('');
  });

  it('draws a grid that is too tall smaller, and wide enough to hold the extra tiles it can now fit to a row', () => {
    const { container } = render(<Box enabled tiles={60} />);
    const { wrap, inner } = parts(container);
    expect(inner.style.transform).toBe('scale(0.83)');
    expect(inner.style.transformOrigin).toBe('top left');
    expect(parseFloat(inner.style.width)).toBeCloseTo(1000 / 0.83, 1);
    // 12 to a row, 5 rows of 100, seen at 0.83
    expect(wrap.style.height).toBe('415px');
  });

  it('stops at the smallest scale for this window even when that is still too tall', () => {
    const { container } = render(<Box enabled tiles={400} />);
    const { inner } = parts(container);
    expect(inner.style.transform).toBe(`scale(${fitBounds(600).min})`);
  });

  it('draws a grid larger on a tall window that has the room, as a wall on a 4K screen should be', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 2160 });
    const { container } = render(<Box enabled tiles={10} />);
    const { wrap, inner } = parts(container);
    expect(inner.style.transform).toBe('scale(2)');
    expect(parseFloat(inner.style.width)).toBeCloseTo(500, 1);
    // 5 to a row, 2 rows of 100, seen at 2
    expect(wrap.style.height).toBe('400px');
  });

  it('writes nothing off a wall, and clears what it wrote when the wall is left', () => {
    const { container, rerender } = render(<Box enabled={false} tiles={60} />);
    expect(parts(container).inner.getAttribute('style') ?? '').toBe('');
    rerender(<Box enabled tiles={60} />);
    expect(parts(container).inner.style.transform).not.toBe('');
    rerender(<Box enabled={false} tiles={60} />);
    const { wrap, inner } = parts(container);
    expect(inner.style.transform).toBe('');
    expect(inner.style.width).toBe('');
    expect(wrap.style.height).toBe('');
  });

  it('measures again when what it was given to watch changes', () => {
    const { container, rerender } = render(<Box enabled tiles={60} />);
    expect(parts(container).inner.style.transform).toBe('scale(0.83)');
    rerender(<Box enabled tiles={20} />);
    expect(parts(container).inner.getAttribute('style') ?? '').toBe('');
    rerender(<Box enabled tiles={100} />);
    expect(parts(container).inner.style.transform).toMatch(/^scale\(0\.\d+\)$/);
  });

  it('does nothing where nothing is laid out', () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 0 });
    const { container } = render(<Box enabled tiles={600} />);
    expect(parts(container).inner.getAttribute('style') ?? '').toBe('');
  });
});
