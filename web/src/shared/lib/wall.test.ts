import { describe, expect, it } from 'vitest';
import {
  ROTATE_DEFAULT,
  WALL_METERS,
  internetCard,
  needsAttention,
  rotateSeconds,
  slideKey,
  slidesOf,
  wallPages,
  wallSlice,
} from './wall';
import { meter, other, response, without } from '../../__tests__/meters';

/** What the wall screen shows in turn, how the meters are split into slides, and the Overview's card for the internet links. */

describe('wallPages and wallSlice', () => {
  it('needs one slide for any number of meters up to what a screen holds, and always at least one', () => {
    expect(wallPages(0)).toBe(1);
    expect(wallPages(1)).toBe(1);
    expect(wallPages(27)).toBe(1);
    expect(wallPages(WALL_METERS)).toBe(1);
    expect(wallPages(WALL_METERS + 1)).toBe(2);
    expect(wallPages(3 * WALL_METERS)).toBe(3);
  });

  it('splits evenly, so 40 meters are 20 and 20 and no page is left over with a few', () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    expect(wallSlice(items, 0, 2)).toHaveLength(20);
    expect(wallSlice(items, 1, 2)).toHaveLength(20);
    expect(wallSlice(items, 0, 2)[0]).toBe(0);
    expect(wallSlice(items, 1, 2)[0]).toBe(20);
  });

  it('leaves out nothing and repeats nothing, whatever the count', () => {
    for (const n of [1, 2, 7, 35, 36, 70, 71, 105]) {
      const items = Array.from({ length: n }, (_, i) => i);
      const pages = wallPages(n);
      const all = Array.from({ length: pages }, (_, p) => wallSlice(items, p, pages)).flat();
      expect(all, `${n} meters`).toEqual(items);
      for (let p = 0; p < pages; p++) expect(wallSlice(items, p, pages).length, `${n} meters, page ${p}`).toBeLessThanOrEqual(WALL_METERS);
    }
  });

  it('gives a page with nothing on it for a page that does not exist', () => {
    expect(wallSlice([1, 2, 3], 5, 1)).toEqual([]);
    expect(wallSlice([], 0, 1)).toEqual([]);
  });
});

describe('slidesOf', () => {
  it('is each view in the order given, the meters as many slides as they have pages', () => {
    expect(slidesOf({ views: ['overview', 'hosts', 'internet'], pages: 2 })).toEqual([
      { view: 'overview' },
      { view: 'hosts' },
      { view: 'internet', page: 0 },
      { view: 'internet', page: 1 },
    ]);
  });

  it('is the Overview and the Hosts alone for a viewer, who has no meters', () => {
    expect(slidesOf({ views: ['overview', 'hosts'], pages: 3 })).toEqual([{ view: 'overview' }, { view: 'hosts' }]);
  });

  it('is one view alone when the address names it', () => {
    expect(slidesOf({ views: ['overview'], pages: 3 })).toEqual([{ view: 'overview' }]);
    expect(slidesOf({ views: ['hosts'], pages: 3 })).toEqual([{ view: 'hosts' }]);
    expect(slidesOf({ views: ['internet'], pages: 2 })).toEqual([
      { view: 'internet', page: 0 },
      { view: 'internet', page: 1 },
    ]);
  });

  it('is never empty', () => {
    expect(slidesOf({ views: [], pages: 1 })).toEqual([{ view: 'overview' }]);
  });

  it('names a slide, so a different set of them can be told from the same one', () => {
    expect(slideKey({ view: 'overview' })).toBe('overview');
    expect(slideKey({ view: 'hosts' })).toBe('hosts');
    expect(slideKey({ view: 'internet', page: 1 })).toBe('internet-1');
  });
});

describe('rotateSeconds', () => {
  it('is 30 when the address says nothing, or something that is not a whole number', () => {
    expect(ROTATE_DEFAULT).toBe(30);
    for (const raw of [null, '', 'soon', '-5', '2.5', '1e3', ' ']) expect(rotateSeconds(raw), String(raw)).toBe(30);
  });

  it('is the seconds asked for, held between 10 and 600', () => {
    expect(rotateSeconds('45')).toBe(45);
    expect(rotateSeconds('10')).toBe(10);
    expect(rotateSeconds('3')).toBe(10);
    expect(rotateSeconds('9000')).toBe(600);
  });

  it('is 0, which stops the turning, for 0', () => {
    expect(rotateSeconds('0')).toBe(0);
    expect(rotateSeconds('00')).toBe(0);
  });
});

describe('needsAttention', () => {
  it('is true for a link that is down, or High or Critical in the gauge\'s own direction', () => {
    expect(needsAttention(meter({ link: 'down', zone: 'low' }))).toBe(true);
    expect(needsAttention(meter({ zone: 'warn' }))).toBe(true);
    expect(needsAttention(meter({ zone: 'critical' }))).toBe(true);
  });

  it('is true when the other direction is High or Critical, though the gauge reads Low', () => {
    expect(needsAttention(meter({ zone: 'low', other: other({ zone: 'warn' }) }))).toBe(true);
    expect(needsAttention(meter({ zone: 'low', other: other({ zone: 'critical' }) }))).toBe(true);
  });

  it('is false for a quiet link, and for an old reading however high it was', () => {
    expect(needsAttention(meter())).toBe(false);
    expect(needsAttention(meter({ zone: 'low', other: other({ zone: 'low' }) }))).toBe(false);
    expect(needsAttention(meter({ state: 'stale', zone: 'critical' }))).toBe(false);
    expect(needsAttention(without('nodata'))).toBe(false);
  });
});

describe('internetCard', () => {
  it('counts the links that need someone to look, once each, and says which way', () => {
    const d = response([
      meter({ link: 'down', zone: 'low' }),
      meter({ id: 'a', zone: 'critical' }),
      meter({ id: 'b', zone: 'critical', other: other({ zone: 'critical' }) }), // both ways: one link
      meter({ id: 'c', zone: 'warn' }),
      meter({ id: 'd', zone: 'low', other: other({ zone: 'warn' }) }),
      meter({ id: 'e' }),
    ]);
    expect(internetCard(d)).toEqual({ value: 5, sub: '1 down, 2 critical, 1 high, 2 other direction', tone: 'critical' });
  });

  it('is orange, not red, when the worst is High', () => {
    expect(internetCard(response([meter({ zone: 'warn' }), meter({ id: 'b' })]))).toEqual({ value: 1, sub: '1 high', tone: 'warn' });
  });

  it('says none are high or critical when something is current and nothing is', () => {
    expect(internetCard(response([meter(), meter({ id: 'b' })]))).toEqual({ value: 0, sub: 'None high or critical, of 2', tone: null });
  });

  it('does not say all is well when no reading is current', () => {
    const d = response([meter({ state: 'stale' }), meter({ id: 'b', state: 'stale' }), without('nodata', { id: 'c' })]);
    expect(internetCard(d)).toEqual({ value: 0, sub: '3 links, none with a current reading', tone: null });
  });

  it('has nothing to count before the answer, or when there is no dashboard or it has no gauges', () => {
    expect(internetCard(null)).toEqual({ value: null, sub: '', tone: null });
    expect(internetCard(undefined)).toEqual({ value: null, sub: '', tone: null });
    expect(internetCard(response([], { found: false }))).toMatchObject({ value: null, sub: 'No Zabbix dashboard of that name' });
    expect(internetCard(response([]))).toMatchObject({ value: null, sub: 'The dashboard has no gauges' });
  });
});
