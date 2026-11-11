import { describe, expect, it } from 'vitest';
import { DESIGN_HEIGHT, FIT_MIN, fitBounds, fitScale } from './fit';

/** Drawing a wall at the scale that fits a screen that cannot be scrolled, larger or smaller than 1080p. */

/** A grid of `count` tiles `tile` wide and tall in a `width` wide space, laid out as a browser would: as many to a row as fit. */
const grid = (count: number, tile: number, width: number) => (scale: number) => Math.ceil(count / Math.max(1, Math.floor(width / scale / tile))) * tile;
const fits = (heightAt: (s: number) => number, room: number, s: number) => heightAt(s) * s <= room;

describe('fitBounds', () => {
  it('is 0.8 to 1 at 1080p, the size the wall is drawn for', () => {
    expect(DESIGN_HEIGHT).toBe(1080);
    expect(fitBounds(1080)).toEqual({ min: FIT_MIN, max: 1 });
  });

  it('shrinks the smallest scale in proportion on a shorter screen, and never goes above 1 there', () => {
    expect(fitBounds(720)).toEqual({ min: 0.53, max: 1 });
    expect(fitBounds(768)).toEqual({ min: 0.57, max: 1 });
    expect(fitBounds(900)).toEqual({ min: 0.67, max: 1 });
  });

  it('allows a taller screen a larger drawing in proportion, and keeps the smallest at 0.8', () => {
    expect(fitBounds(1440)).toEqual({ min: 0.8, max: 1.33 });
    expect(fitBounds(2160)).toEqual({ min: 0.8, max: 2 });
  });

  it('stops at 3 whatever the screen, and reads a height it cannot use as 1080p', () => {
    expect(fitBounds(8640).max).toBe(3);
    for (const h of [0, -5, Number.NaN]) expect(fitBounds(h), String(h)).toEqual({ min: FIT_MIN, max: 1 });
  });
});

describe('fitScale', () => {
  it('leaves a grid that fits at the top of the range', () => {
    expect(fitScale(grid(20, 100, 1000), 500)).toBe(1);
    expect(fitScale(grid(20, 100, 1000), 200)).toBe(1);
  });

  it('draws a grid that is too tall smaller, and so that it fits', () => {
    // 60 tiles of 100: 6 rows at full size, 600 tall, in 500. 12 to a row need a scale of 0.8333 or less.
    const heightAt = grid(60, 100, 1000);
    const s = fitScale(heightAt, 500, { min: 0.4, max: 1 });
    expect(fits(heightAt, 500, s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0.82);
    expect(s).toBeLessThanOrEqual(0.8333);
  });

  it('counts the width a smaller grid has: it holds more tiles to a row', () => {
    const heightAt = grid(33, 100, 800);
    const s = fitScale(heightAt, 400, { min: 0.4, max: 1 });
    expect(s).toBeLessThan(1);
    expect(heightAt(s)).toBeLessThan(heightAt(1));
    expect(fits(heightAt, 400, s)).toBe(true);
  });

  it('draws a grid larger when the screen has the room, up to the top of the range', () => {
    expect(fitScale(grid(10, 100, 1000), 1000, { min: 0.8, max: 2 })).toBe(2);
    const heightAt = grid(40, 100, 1000);
    const s = fitScale(heightAt, 600, { min: 0.8, max: 2 });
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThan(2);
    expect(fits(heightAt, 600, s)).toBe(true);
    expect(fits(heightAt, 600, s + 0.05)).toBe(false);
  });

  it('never goes below the bottom of the range, whatever the grid', () => {
    expect(fitScale(grid(1000, 100, 1000), 500)).toBe(FIT_MIN);
    expect(fitScale(() => 1e9, 10, { min: 0.53, max: 1 })).toBe(0.53);
  });

  it('says so after two measurements when even the smallest scale is too tall, and does not search', () => {
    let asked = 0;
    const s = fitScale(() => {
      asked++;
      return 1e9;
    }, 10, { min: 0.53, max: 1 });
    expect(s).toBe(0.53);
    expect(asked).toBe(2);
  });

  it('leaves the grid alone when there is no room to measure against', () => {
    expect(fitScale(() => 1000, 0)).toBe(1);
    expect(fitScale(() => 1000, -40)).toBe(1);
    expect(fitScale(() => 1000, Number.NaN)).toBe(1);
  });

  it('measures a handful of times, not once for every hundredth', () => {
    let asked = 0;
    fitScale((s) => {
      asked++;
      return s <= 0.9 ? 100 : 1000;
    }, 500, { min: 0.4, max: 3 });
    expect(asked).toBeLessThanOrEqual(12);
  });

  it('gives a scale a person can read: whole hundredths', () => {
    for (const count of [30, 45, 60, 90]) {
      const s = fitScale(grid(count, 100, 1000), 400, { min: 0.4, max: 2 });
      expect(Math.round(s * 100) / 100).toBe(s);
    }
  });
});
