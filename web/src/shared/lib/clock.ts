/**
 * The server's clock, for every age and every "now" the page works out. A Zabbix timestamp is compared with the time of the machine that draws the page, and a wall PC whose clock is wrong printed
 * wrong ages: behind, every problem read 0s ago; ahead, it read old (FR-74). The `Date` header of every answer says what time the server has, so the offset is taken from it once and applied
 * wherever the page asks for the time. Timers, which only need a length of time, still use the machine's own clock.
 */

let offsetMs = 0;
let known = false;

/** A reading closer than this to the one held is the header's whole seconds and the network, not a clock that moved. */
const SETTLE_MS = 2_000;
/** A machine within this of the server is taken to be right: the header counts whole seconds. */
const AGREE_MS = 1_500;

/**
 * The dates a portal can be running on. The server's clock is believed, even over a machine that is years wrong, but a date outside these is a clock that was never set or a header that is not
 * one: believing it would make every time a page writes an Invalid Date.
 */
const EARLIEST_MS = Date.UTC(2024, 0, 1);
const LATEST_MS = Date.UTC(2100, 0, 1);

const listeners = new Set<() => void>();

/** `listener` runs when the offset is first learned and whenever it moves, for the page that was drawn before the first answer came. Returns the way to stop. */
export function onServerClockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Learns the offset from the `Date` header of an answer received at `receivedAt` (ms since epoch on this machine). A header that is missing, is not a date, or is not a date a portal can be running on changes nothing. */
export function noteServerTime(dateHeader: string | null, receivedAt = Date.now()): void {
  if (!dateHeader) return;
  const server = Date.parse(dateHeader);
  if (!Number.isFinite(server) || server < EARLIEST_MS || server > LATEST_MS) return;
  // The header is rounded down to the second, so the server's time was on average half a second later.
  const measured = server + 500 - receivedAt;
  const next = Math.abs(measured) < AGREE_MS ? 0 : measured;
  if (!known || Math.abs(next - offsetMs) > SETTLE_MS) {
    const moved = next !== offsetMs;
    offsetMs = next;
    known = true;
    if (moved) for (const listener of listeners) listener();
  }
}

/** The server's time now, in milliseconds since the epoch. */
export const serverNow = (): number => Date.now() + offsetMs;

/** How far the server's clock is ahead of this machine's, in milliseconds; negative when it is behind. */
export const clockOffsetMs = (): number => offsetMs;

/** Forgets what was learned, as at the start of a page and between tests. */
export function resetServerClock(): void {
  offsetMs = 0;
  known = false;
}
