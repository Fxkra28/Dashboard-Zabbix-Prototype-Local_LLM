import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Gauge from './Gauge';
import { DIAL } from './gaugeDial';
import { stylesheet as css } from '../../__tests__/stylesheet';
import { meter, other, without } from '../../__tests__/meters';

/** One meter on the page: what a person sees, and what a screen reader is given in place of the dial. */

const NOW = 1_800_000_000_000;
// The title is a link to the Graphs page, so a gauge needs a router around it.
const wrap = (m: ReturnType<typeof meter>) => (
  <MemoryRouter>
    <Gauge meter={m} now={NOW} />
  </MemoryRouter>
);
const show = (m = meter()) => render(wrap(m));
const tile = (container: HTMLElement) => container.querySelector('.meter') as HTMLElement;

describe('Gauge with a current reading', () => {
  it('is a meter named by its title, with the value, the scale and the value in words', () => {
    show();
    const m = screen.getByRole('meter', { name: 'SITE ONE INTERNET' });
    expect(m).toHaveAttribute('aria-valuenow', '212060000');
    expect(m).toHaveAttribute('aria-valuemin', '0');
    expect(m).toHaveAttribute('aria-valuemax', '500000000');
    expect(m).toHaveAttribute('aria-valuetext', '212.1 Mbps');
  });

  it('says what it measures to a screen reader, and on hover to everyone else', () => {
    show();
    expect(screen.getByRole('meter')).toHaveAccessibleDescription('Interface wan1(): Bits received on 1.1 SITE1-FW');
    // On the paragraph around the link, so the hover text is the same over the link as beside it.
    expect(screen.getByText('SITE ONE INTERNET').closest('.meter-title')).toHaveAttribute('title', 'SITE ONE INTERNET\nInterface wan1(): Bits received on 1.1 SITE1-FW');
  });

  it('writes the value big, and the zone and the share of the capacity under the dial', () => {
    const { container } = show();
    expect(container.querySelector('.meter-value')).toHaveTextContent('212.1 Mbps');
    expect(container.querySelector('.meter-foot')).toHaveTextContent('Normal · 42% of 500 Mbps');
  });

  it('says whether it counts what comes in or what goes out', () => {
    show();
    expect(screen.getByText('In')).toHaveAttribute('title', 'Traffic received on the interface');
  });

  it('says "Out" for an outbound link and nothing for an item that is neither', () => {
    const { rerender } = show(meter({ direction: 'out' }));
    expect(screen.getByText('Out')).toBeInTheDocument();
    rerender(wrap(meter({ direction: null })));
    expect(screen.queryByText('In')).toBeNull();
    expect(screen.queryByText('Out')).toBeNull();
  });

  it('hides the dial from a screen reader: the value and the zone are text', () => {
    const { container } = show();
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('draws the zones in order, with a gap between each, the frame behind them and the scale around', () => {
    const { container } = show();
    expect([...container.querySelectorAll('.gauge-zone')].map((p) => p.getAttribute('class'))).toEqual([
      'gauge-zone low',
      'gauge-zone ok',
      'gauge-zone warn',
      'gauge-zone critical',
    ]);
    expect(container.querySelectorAll('.gauge-gap')).toHaveLength(3);
    expect(container.querySelectorAll('.gauge-frame')).toHaveLength(1);
    expect([...container.querySelectorAll('.gauge-tick')].map((t) => t.textContent)).toEqual(['0 bps', '125 Mbps', '250 Mbps', '375 Mbps', '500 Mbps']);
  });

  it('points the needle at the value: straight up at half the scale, to the left of that below it', () => {
    const { container, rerender } = show(meter({ fraction: 0.5, value: 250_000_000 }));
    const needle = () => container.querySelector('.gauge-needle') as SVGLineElement;
    expect(Number(needle().getAttribute('x2'))).toBeCloseTo(DIAL.cx, 1);
    expect(Number(needle().getAttribute('y2'))).toBeLessThan(DIAL.cy);
    rerender(wrap(meter({ fraction: 0.1, value: 50_000_000 })));
    expect(Number(needle().getAttribute('x2'))).toBeLessThan(DIAL.cx);
    expect(container.querySelectorAll('.gauge-hub')).toHaveLength(1);
  });

  it('puts the zone on the tile, so a high or critical link is coloured as such', () => {
    const { container, rerender } = show(meter({ zone: 'critical', value: 450_000_000, fraction: 0.9 }));
    expect(tile(container)).toHaveClass('zone-critical');
    expect(container.querySelector('.meter-foot')).toHaveTextContent('Critical · 90% of 500 Mbps');
    rerender(wrap(meter({ zone: 'warn', value: 300_000_000, fraction: 0.6 })));
    expect(tile(container)).toHaveClass('zone-warn');
  });

  it('never writes NaN or undefined, whatever the numbers', () => {
    const { container } = show(meter({ value: 0, fraction: 0 }));
    expect(container.innerHTML).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('Gauge with an old reading', () => {
  const stale = meter({ state: 'stale', clock: NOW / 1000 - 30 * 86_400, zone: 'low', fraction: 0.15, value: 73_880_000 });

  it('is still a meter, and its value in words says it is old', () => {
    show(stale);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '73.88 Mbps, an old reading');
  });

  it('is dimmed, and the line under it says when it is from and not what zone it is in', () => {
    const { container } = show(stale);
    expect(tile(container)).toHaveClass('meter-stale');
    expect(tile(container).className).not.toMatch(/zone-/);
    expect(container.querySelector('.meter-foot')).toHaveTextContent(/^Old reading, from .+ \(30 days ago\)$/);
  });
});

describe('Gauge with nothing to show', () => {
  it('draws the empty dial for a link that has no value yet, and says "No data"', () => {
    const { container } = show(without('nodata'));
    expect(screen.queryByRole('meter')).toBeNull();
    expect(container.querySelector('.meter-value')).toHaveTextContent('No data');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.gauge-needle')).toBeNull();
    expect(container.querySelector('.meter-foot')).toHaveTextContent('No value has been collected.');
  });

  it('draws no dial for a widget whose item is gone, and says so', () => {
    const { container } = show(without('missing', { max: null, host: null, item: null, direction: null, zones: [] }));
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(container.querySelector('.meter-value')).toHaveTextContent('Not found');
    expect(container.querySelector('.meter-foot')).toHaveTextContent('no longer exists');
  });

  it('draws no dial for an item that is disabled or not supported', () => {
    const { container } = show(without('unsupported'));
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.meter-value')).toHaveTextContent('Not collected');
  });

  it('gives the value and says the scale is the trouble when the widget has no usable scale', () => {
    const { container } = show(meter({ state: 'invalid', max: null, fraction: null, zone: null, zones: [] }));
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(container.querySelector('.meter-value')).toHaveTextContent('212.1 Mbps');
    expect(container.querySelector('.meter-foot')).toHaveTextContent('no usable scale');
  });

  it('keeps the title in every state, and quiet text for each', () => {
    for (const m of [without('nodata'), without('missing', { max: null }), without('unsupported')]) {
      const { container, unmount } = show(m);
      expect(within(tile(container)).getByText('SITE ONE INTERNET')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('the edge of a tile that needs a look', () => {
  // jsdom draws no stylesheet, so the rules are read from the file: the states the page marks must each reach the red edge.
  const rule = (selector: string) => css.split('}').find((block) => block.includes(selector) && block.includes('box-shadow: inset'));

  it('is red for a Critical gauge, a Critical other direction and a link that is down, and amber for a High other direction', () => {
    for (const cls of ['.meter.zone-critical', '.meter.flag-critical', '.meter.meter-down']) {
      expect(rule(cls), cls).toMatch(/border-color: var\(--danger\)[\s\S]*box-shadow: inset 5px 0 0 var\(--danger\)/);
    }
    expect(rule('.meter.flag-warn')).toMatch(/var\(--warn\)[\s\S]*inset 5px 0 0 var\(--warn\)/);
  });

  it('is on a tile the page marks: a Critical gauge and a down link carry the classes the edge reads', () => {
    const { container, rerender } = show(meter({ zone: 'critical', value: 450_000_000, fraction: 0.9 }));
    expect(tile(container)).toHaveClass('zone-critical');
    rerender(wrap(meter({ link: 'down', value: 0, fraction: 0, zone: 'low' })));
    expect(tile(container)).toHaveClass('meter-down');
  });
});

describe('Gauge for a link whose interface is down', () => {
  const down = meter({ link: 'down', value: 0, fraction: 0, zone: 'low' });

  it('writes the word Down in place of the value, and says a low reading is not an idle link', () => {
    const { container } = show(down);
    expect(container.querySelector('.meter-value')).toHaveTextContent('Down');
    expect(container.querySelector('.meter-value')).not.toHaveTextContent('bps');
    expect(container.querySelector('.meter-foot')).toHaveTextContent('Interface down, not an idle link.');
    expect(tile(container)).toHaveClass('meter-down');
    expect(tile(container).className).not.toMatch(/zone-/);
  });

  it('keeps the dial and its zones, with no needle, as there is no reading to point at', () => {
    const { container } = show(down);
    expect(container.querySelectorAll('.gauge-zone')).toHaveLength(4);
    expect(container.querySelector('.gauge-needle')).toBeNull();
    expect(container.querySelector('.gauge-hub')).toBeNull();
  });

  it('is not a meter to a screen reader: there is no value to give, and the words say why', () => {
    const { container } = show(down);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(tile(container)).toHaveTextContent('SITE ONE INTERNET');
    expect(tile(container)).toHaveTextContent('Down');
  });

  it('is still down behind an old reading or no data, and a link that is up or not known looks as it did', () => {
    for (const m of [meter({ link: 'down', state: 'stale' }), without('nodata', { link: 'down' })]) {
      const { container, unmount } = show(m);
      expect(container.querySelector('.meter-value')).toHaveTextContent('Down');
      expect(tile(container)).toHaveClass('meter-down');
      unmount();
    }
    for (const link of ['up', 'unknown'] as const) {
      const { container, unmount } = show(meter({ link }));
      expect(tile(container)).not.toHaveClass('meter-down');
      expect(screen.getByRole('meter')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Gauge with the other direction', () => {
  it('writes it, under the dial and above the line that gives the zone, when it is critical', () => {
    const { container } = show(meter({ other: other({ value: 400_000_000, zone: 'critical', fraction: 0.8 }) }));
    const line = container.querySelector('.meter-other') as HTMLElement;
    expect(line).toHaveTextContent('Out 400 Mbps · 80% of 500 Mbps · Critical');
    expect(line).toHaveClass('other-critical');
    expect(line.nextElementSibling).toHaveClass('meter-foot');
  });

  it('says High for a warning, in its own class', () => {
    const { container } = show(meter({ other: other({ value: 300_000_000, zone: 'warn', fraction: 0.6 }) }));
    expect(container.querySelector('.meter-other')).toHaveTextContent('Out 300 Mbps · 60% of 500 Mbps · High');
    expect(container.querySelector('.meter-other')).toHaveClass('other-warn');
  });

  it('is left out while the other direction is quiet, has no current value, or the link has no other item', () => {
    for (const m of [
      meter({ other: other({ zone: 'low' }) }),
      meter({ other: other({ zone: 'ok' }) }),
      meter({ other: other({ value: null, clock: null, fraction: null, zone: null }) }),
      meter({ other: null }),
    ]) {
      const { container, unmount } = show(m);
      expect(container.querySelector('.meter-other')).toBeNull();
      unmount();
    }
  });

  it('puts a red edge on the tile for a critical other direction and an amber one for a high one, so it shows from across a room', () => {
    const { container, rerender } = show(meter({ other: other({ value: 400_000_000, zone: 'critical', fraction: 0.8 }) }));
    expect(tile(container)).toHaveClass('flag-critical');
    expect(tile(container)).not.toHaveClass('flag-warn');
    rerender(wrap(meter({ other: other({ value: 300_000_000, zone: 'warn', fraction: 0.6 }) })));
    expect(tile(container)).toHaveClass('flag-warn');
    expect(tile(container)).not.toHaveClass('flag-critical');
  });

  it('leaves the edge plain while the other direction is quiet, has no current value, or is not there', () => {
    for (const m of [
      meter({ other: other({ zone: 'low' }) }),
      meter({ other: other({ zone: 'ok' }) }),
      meter({ other: other({ value: null, clock: null, fraction: null, zone: null }) }),
      meter({ other: null }),
      meter({ zone: 'critical', value: 450_000_000, fraction: 0.9 }),
    ]) {
      const { container, unmount } = show(m);
      expect(tile(container).className).not.toMatch(/flag-/);
      unmount();
    }
  });

  it('does not change the gauge: its needle, value and zone are the ones it counts', () => {
    const { container } = show(meter({ other: other({ value: 400_000_000, zone: 'critical', fraction: 0.8 }) }));
    expect(container.querySelector('.meter-value')).toHaveTextContent('212.1 Mbps');
    expect(container.querySelector('.meter-foot')).toHaveTextContent('Normal · 42% of 500 Mbps');
    expect(tile(container)).toHaveClass('zone-ok');
    expect(container.querySelector('.gauge-needle')).not.toBeNull();
  });
});

describe('Gauge title as a link to the history', () => {
  const href = () => (screen.getByRole('link') as HTMLAnchorElement).getAttribute('href');

  it('is a link to the Graphs page with the gauge\'s item first, and keeps the title as the name of the meter', () => {
    show();
    expect(href()).toBe('/graphs?hostid=10&itemid=1001');
    expect(screen.getByRole('link', { name: 'SITE ONE INTERNET' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'SITE ONE INTERNET' })).toBeInTheDocument();
  });

  it('opens both directions when the interface has the other one', () => {
    show(meter({ other: other({ itemid: '1101' }) }));
    expect(href()).toBe('/graphs?hostid=10&itemid=1001,1101');
  });

  it('opens the month of an old reading, as the last day would show nothing', () => {
    show(meter({ state: 'stale', clock: Date.UTC(2026, 8, 14, 7, 2) / 1000 }));
    expect(href()).toBe('/graphs?hostid=10&itemid=1001&month=2026-09');
  });

  it('says to a screen reader where the link goes, without that becoming part of the meter\'s name', () => {
    show();
    expect(screen.getByRole('link')).toHaveAccessibleDescription('Opens the history of this link in Graphs');
    expect(screen.getByRole('meter')).toHaveAccessibleName('SITE ONE INTERNET');
  });

  it('is plain text for a widget with no item or no host to graph', () => {
    show(without('missing', { hostid: null, itemid: null, max: null, direction: null, zones: [] }));
    expect(screen.queryByRole('link')).toBeNull();
    show(meter({ hostid: null }));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is there for a link that is down, which is the one someone wants the history of', () => {
    show(meter({ link: 'down' }));
    expect(href()).toBe('/graphs?hostid=10&itemid=1001');
  });
});
