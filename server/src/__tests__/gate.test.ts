import { describe, expect, it } from 'vitest';
import { createGate } from '../core/gate.js';

/** At most `limit` jobs at once, the rest in order, and a failure gives its place back. */

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

describe('createGate', () => {
  it('runs up to the limit at once and holds the next', async () => {
    const gate = createGate(2);
    const started: number[] = [];
    const jobs = [1, 2, 3, 4].map((n) => ({ n, d: deferred() }));
    const results = jobs.map(({ n, d }) =>
      gate.run(async () => {
        started.push(n);
        await d.promise;
        return n * 10;
      }),
    );
    await tick();
    expect(started).toEqual([1, 2]);
    expect(gate.running).toBe(2);
    expect(gate.waiting).toBe(2);

    jobs[0]!.d.resolve();
    await tick();
    expect(started).toEqual([1, 2, 3]);
    expect(gate.running).toBe(2);

    jobs[1]!.d.resolve();
    jobs[2]!.d.resolve();
    jobs[3]!.d.resolve();
    expect(await Promise.all(results)).toEqual([10, 20, 30, 40]);
    expect(gate.running).toBe(0);
    expect(gate.waiting).toBe(0);
  });

  it('never has more than the limit running, however many are asked', async () => {
    const gate = createGate(3);
    let now = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 25 }, () =>
        gate.run(async () => {
          now++;
          peak = Math.max(peak, now);
          await tick();
          now--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });

  it('gives the place back when a job throws, and passes the error on', async () => {
    const gate = createGate(1);
    const failing = gate.run(async () => {
      throw new Error('zabbix down');
    });
    const after = gate.run(async () => 'ran');
    await expect(failing).rejects.toThrow('zabbix down');
    expect(await after).toBe('ran');
    expect(gate.running).toBe(0);
  });

  it('does not let a newcomer jump the queue when a place is handed on', async () => {
    const gate = createGate(1);
    const order: string[] = [];
    const first = deferred();
    const a = gate.run(async () => {
      order.push('a');
      await first.promise;
    });
    const b = gate.run(async () => void order.push('b'));
    await tick();
    first.resolve();
    // Asked in the same turn that `a` ends: it still comes after `b`.
    const c = gate.run(async () => void order.push('c'));
    await Promise.all([a, b, c]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('refuses a limit that is not a whole number of at least 1', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => createGate(bad)).toThrow(RangeError);
  });
});
