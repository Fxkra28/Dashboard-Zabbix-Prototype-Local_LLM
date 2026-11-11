import { describe, expect, it } from 'vitest';
import { LIVE_ROWS, liveRows, topRows, worstFirst } from './liveList';
import { ids, problem } from '../../__tests__/problems';

describe('worstFirst', () => {
  it('orders by severity, then newest, then event id', () => {
    const list = [problem(1, 3, 60), problem(2, 5, 600), problem(3, 5, 60), problem(4, 3, 60)];
    expect(ids([...list].sort(worstFirst))).toEqual(['3', '2', '4', '1']);
  });
});

describe('topRows', () => {
  it(`keeps the worst ${LIVE_ROWS} and leaves the input alone`, () => {
    const list = Array.from({ length: 20 }, (_, i) => problem(i + 1, (i % 5) + 1, i));
    const before = ids(list);
    const top = topRows(list);
    expect(top).toHaveLength(LIVE_ROWS);
    expect(top.every((p) => Number(p.severity) >= 3)).toBe(true);
    expect(ids(list)).toEqual(before);
  });
});

describe('liveRows', () => {
  const open = Array.from({ length: 15 }, (_, i) => problem(i + 1, 3, i * 60));

  it('puts a cleared problem back in its place among the open ones', () => {
    const cleared = problem(99, 4, 30);
    const rows = liveRows(open, [cleared]);
    expect(rows[0].eventid).toBe('99');
    expect(rows).toHaveLength(LIVE_ROWS + 1);
  });

  it('drops a cleared problem that falls below the last open row', () => {
    const rows = liveRows(open, [problem(99, 1, 30)]);
    expect(ids(rows)).not.toContain('99');
    expect(rows).toHaveLength(LIVE_ROWS);
  });

  it('shows a problem once when it is open again', () => {
    const again = open[0];
    const rows = liveRows(open, [again]);
    expect(ids(rows).filter((id) => id === again.eventid)).toHaveLength(1);
  });

  it('keeps cleared rows after a short list', () => {
    const rows = liveRows([problem(1, 5)], [problem(2, 1)]);
    expect(ids(rows)).toEqual(['1', '2']);
  });
});
