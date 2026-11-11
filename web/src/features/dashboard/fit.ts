/**
 * A wall cannot be scrolled and a tile's height depends on what it says, so what is on it is drawn at the scale that fits the screen, all by one factor.
 * It is sized for a 1080p screen: a taller one draws it larger, a shorter one smaller, never below FIT_MIN of that (the wall's text still reads from across a room).
 */

export const DESIGN_HEIGHT = 1080;

/** The smallest scale at 1080p: the wall's text at this factor is about a normal page's. */
export const FIT_MIN = 0.8;
/** No wall is drawn larger than this, whatever the screen. */
const BIGGEST = 3;
/** The search stops when the scale it brackets is this narrow. */
const NARROW = 0.015;

const round = (n: number) => Math.round(n * 100) / 100;

/** The smallest and largest scale for a window this tall, in proportion to 1080p: never above 1 at or below it. */
export function fitBounds(windowHeight: number): { min: number; max: number } {
  const ratio = windowHeight > 0 ? windowHeight / DESIGN_HEIGHT : 1;
  return { min: round(FIT_MIN * Math.min(1, ratio)), max: round(Math.min(BIGGEST, Math.max(1, ratio))) };
}

/**
 * The largest scale within `bounds` at which the grid fits `room` pixels; `heightAt(s)` is its height laid out 1/s times as wide, as it is when drawn at scale s.
 * The bound's minimum when nothing fits: a little too tall beats too small to read.
 */
export function fitScale(heightAt: (scale: number) => number, room: number, bounds = fitBounds(DESIGN_HEIGHT)): number {
  if (!(room > 0)) return 1;
  const fits = (s: number) => heightAt(s) * s <= room;
  const { min, max } = bounds;
  if (fits(max)) return max;
  if (!fits(min)) return min;
  let lo = min;
  let hi = max;
  for (let i = 0; i < 24 && hi - lo > NARROW; i++) {
    const mid = round((lo + hi) / 2);
    if (mid <= lo || mid >= hi) break;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
