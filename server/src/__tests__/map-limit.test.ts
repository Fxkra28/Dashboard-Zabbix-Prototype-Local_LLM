import { describe, expect, it } from 'vitest';
import { mapLimit } from '../sli/events.js';

/** `mapLimit` is the one pool that every slow Zabbix read of the SLA engine goes through (BK-64). */

/** A promise the test settles by hand. */
function gate<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('mapLimit', () => {
  it('returns the results in the order of the input, whatever order they finish in', async () => {
    const gates = [gate<string>(), gate<string>(), gate<string>()];
    const run = mapLimit([0, 1, 2], 3, (i) => gates[i].promise);
    gates[2].resolve('c');
    gates[0].resolve('a');
    gates[1].resolve('b');
    expect(await run).toEqual(['a', 'b', 'c']);
  });

  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      peak = Math.max(peak, ++running);
      await tick();
      running--;
    });
    expect(peak).toBe(3);
  });

  it('copes with an empty list, a limit above the length and a limit below one', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    expect(await mapLimit([1, 2], 50, async (n) => n * 2)).toEqual([2, 4]);
    expect(await mapLimit([1, 2, 3], 0, async (n) => n)).toEqual([1, 2, 3]);
  });

  it('rejects with the first failure', async () => {
    await expect(mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('second failed');
      return n;
    })).rejects.toThrow('second failed');
  });

  // BK-64: the caller has its answer (a failure) and the gate has given the place away, so the other workers must not go on through the list.
  it('starts no item once one has failed, while those already running finish', async () => {
    const started: number[] = [];
    const gates = Array.from({ length: 10 }, () => gate());
    const run = mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async (i) => {
      started.push(i);
      await gates[i].promise;
    });
    const outcome = run.then(() => 'done', (e: unknown) => (e as Error).message);
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0].reject(new Error('item 0 failed'));
    expect(await outcome).toBe('item 0 failed');
    gates[1].resolve();
    gates[2].resolve();
    await tick();
    await tick();
    expect(started).toEqual([0, 1, 2]);
  });
});
