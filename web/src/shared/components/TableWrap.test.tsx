import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { TableWrap } from './TableWrap';

/**
 * A test browser has no layout, so the box is given one: what it holds against what it shows. The sizes are read
 * from `size` each time the component measures, and a fake ResizeObserver lets a test say "the window changed".
 */

let size = { held: { w: 100, h: 100 }, shown: { w: 100, h: 100 } };
const watchers: FakeObserver[] = [];

class FakeObserver {
  seen: Element[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    watchers.push(this);
  }
  observe(el: Element) {
    if (!this.seen.includes(el)) this.seen.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
}

const original = {
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
};

beforeEach(() => {
  size = { held: { w: 100, h: 100 }, shown: { w: 100, h: 100 } };
  watchers.length = 0;
  const get = (read: () => number) => ({ configurable: true, get: read });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', get(() => size.held.w));
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', get(() => size.shown.w));
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', get(() => size.held.h));
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', get(() => size.shown.h));
});
afterEach(() => {
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

const withObserver = () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeObserver;
};
const table = (
  <table>
    <tbody>
      <tr>
        <td>cell</td>
      </tr>
    </tbody>
  </table>
);

describe('the box around a wide table', () => {
  it('stays a plain box, out of the tab order, while its table fits', () => {
    const { container } = render(<TableWrap label="Hosts">{table}</TableWrap>);
    expect(container.innerHTML).toBe('<div class="table-wrap"><table><tbody><tr><td>cell</td></tr></tbody></table></div>');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('takes a tab stop and a name while the table is wider than the box', () => {
    size.held.w = 300;
    render(<TableWrap label="Open problems">{table}</TableWrap>);
    const box = screen.getByRole('region', { name: 'Open problems' });
    expect(box).toHaveAttribute('tabindex', '0');
    expect(box).toHaveClass('table-wrap');
  });

  it('does the same when it is taller than the box, as the capped lists are', () => {
    size = { held: { w: 100, h: 700 }, shown: { w: 100, h: 620 } };
    render(<TableWrap label="Availability of each host" className="sli-scroll">{table}</TableWrap>);
    const box = screen.getByRole('region', { name: 'Availability of each host' });
    expect(box).toHaveAttribute('tabindex', '0');
    expect(box.className).toBe('table-wrap sli-scroll');
  });

  it('does not count a pixel of rounding as something to scroll', () => {
    size.held.w = 101;
    render(<TableWrap label="Hosts">{table}</TableWrap>);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('is focusable by keyboard when it scrolls, which a plain div is not', () => {
    size.held.w = 300;
    render(<TableWrap label="Hosts">{table}</TableWrap>);
    screen.getByRole('region', { name: 'Hosts' }).focus();
    expect(screen.getByRole('region', { name: 'Hosts' })).toHaveFocus();
  });

  it('follows the window: the stop appears when the box narrows and goes when it widens again', () => {
    withObserver();
    render(<TableWrap label="Links and WAN health">{table}</TableWrap>);
    expect(screen.queryByRole('region')).toBeNull();

    size.shown.w = 60;
    act(() => watchers[0].callback());
    expect(screen.getByRole('region', { name: 'Links and WAN health' })).toHaveAttribute('tabindex', '0');

    size.shown.w = 100;
    act(() => watchers[0].callback());
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('follows its data: a table that grows wider on the next render gets the stop', () => {
    const { rerender } = render(<TableWrap label="Latest data">{table}</TableWrap>);
    expect(screen.queryByRole('region')).toBeNull();

    size.held.w = 400;
    rerender(<TableWrap label="Latest data">{table}</TableWrap>);
    expect(screen.getByRole('region', { name: 'Latest data' })).toHaveAttribute('tabindex', '0');
  });

  it('watches the box and each table inside it, once, and stops when it goes', () => {
    withObserver();
    const { rerender, unmount, container } = render(<TableWrap label="Hosts">{table}</TableWrap>);
    rerender(<TableWrap label="Hosts">{table}</TableWrap>);
    expect(watchers).toHaveLength(1);
    expect(watchers[0].seen).toEqual([container.firstElementChild, container.querySelector('table')]);

    unmount();
    expect(watchers[0].disconnected).toBe(true);
  });

  it('measures once and does not fail where there is no ResizeObserver', () => {
    size.held.w = 300;
    expect(() => render(<TableWrap label="Hosts">{table}</TableWrap>)).not.toThrow();
    expect(screen.getByRole('region', { name: 'Hosts' })).toBeInTheDocument();
  });
});
