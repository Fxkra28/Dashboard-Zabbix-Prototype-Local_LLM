import { describe, expect, it, vi } from 'vitest';
import { Cancelled, createGate } from '../core/gate.js';

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

describe('a waiting job nobody wants any more (BK-59)', () => {
  it('is dropped when its turn comes, rejects with Cancelled, and passes its place to the next in line', async () => {
    const gate = createGate(1);
    const first = deferred();
    const ran: string[] = [];
    let wanted = true;
    const a = gate.run(async () => {
      ran.push('a');
      await first.promise;
    });
    const b = gate.run(async () => void ran.push('b'), { wanted: () => wanted });
    const c = gate.run(async () => void ran.push('c'));
    b.catch(() => undefined);
    await tick();
    expect(gate.waiting).toBe(2);

    wanted = false; // the reader left while b was in line
    first.resolve();
    await a;
    await expect(b).rejects.toBeInstanceOf(Cancelled);
    await c;
    expect(ran).toEqual(['a', 'c']);
    expect(gate.running).toBe(0);
    expect(gate.waiting).toBe(0);
  });

  it('still runs a waiting job that is wanted when its turn comes', async () => {
    const gate = createGate(1);
    const first = deferred();
    const a = gate.run(() => first.promise);
    const b = gate.run(async () => 'ran', { wanted: () => true });
    await tick();
    first.resolve();
    await a;
    expect(await b).toBe('ran');
  });

  it('asks once, when the turn comes, and not while the job waits', async () => {
    const gate = createGate(1);
    const first = deferred();
    const wanted = vi.fn(() => true);
    const a = gate.run(() => first.promise);
    const b = gate.run(async () => 'ran', { wanted });
    await tick();
    expect(wanted).not.toHaveBeenCalled();
    first.resolve();
    await Promise.all([a, b]);
    expect(wanted).toHaveBeenCalledTimes(1);
  });

  it('never asks about a job that starts at once, which has a reader by definition', async () => {
    const gate = createGate(2);
    const wanted = vi.fn(() => false);
    expect(await gate.run(async () => 'ran', { wanted })).toBe('ran');
    expect(wanted).not.toHaveBeenCalled();
  });

  it('drops a whole run of unwanted jobs in turn and starts the first wanted one behind them', async () => {
    const gate = createGate(1);
    const first = deferred();
    const ran: string[] = [];
    const a = gate.run(() => first.promise);
    const dropped = [1, 2, 3].map((n) => gate.run(async () => void ran.push(`dropped${n}`), { wanted: () => false }));
    dropped.forEach((d) => d.catch(() => undefined));
    const last = gate.run(async () => void ran.push('last'));
    await tick();
    first.resolve();
    await a;
    await last;
    expect(ran).toEqual(['last']);
    expect((await Promise.allSettled(dropped)).every((r) => r.status === 'rejected')).toBe(true);
    expect(gate.running).toBe(0);
    expect(gate.waiting).toBe(0);
  });

  it('keeps the limit while it drops: a job that took the place of a dropped one is still alone', async () => {
    const gate = createGate(1);
    const first = deferred();
    const second = deferred();
    let live = 0;
    let peak = 0;
    const track = (d: { promise: Promise<void> }) => async () => {
      live++;
      peak = Math.max(peak, live);
      await d.promise;
      live--;
    };
    const a = gate.run(track(first));
    const dropped = gate.run(async () => undefined, { wanted: () => false });
    dropped.catch(() => undefined);
    const b = gate.run(track(second));
    await tick();
    first.resolve();
    await a;
    await tick();
    second.resolve();
    await b;
    expect(peak).toBe(1);
  });
});
