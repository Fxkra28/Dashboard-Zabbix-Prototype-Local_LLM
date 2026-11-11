import { describe, expect, it } from 'vitest';
import { changeKey } from './liveChange';
import { problem } from '../../__tests__/problems';

describe('changeKey (the Problems page re-reads its list when the live stream says it changed, IN-11)', () => {
  const base = [problem(1, 4, 600), problem(2, 3, 300), problem(3, 2, 60)];

  it('is the same for the same problems in another order, and for a name, a host, a live value or a tag that moved', () => {
    const moved = [base[2], { ...base[0], name: 'renamed', host: 'other-host', opdata: '99 %', tags: [{ tag: 'site', value: 'JKT' }] }, base[1]];
    expect(changeKey(moved)).toBe(changeKey(base));
  });

  it('changes when a problem opens or is gone', () => {
    expect(changeKey([...base, problem(4, 5, 10)])).not.toBe(changeKey(base));
    expect(changeKey(base.slice(1))).not.toBe(changeKey(base));
  });

  it('changes when a problem is resolved, acknowledged, put in maintenance or re-graded', () => {
    const key = changeKey(base);
    expect(changeKey([{ ...base[0], r_eventid: '555' }, base[1], base[2]])).not.toBe(key);
    expect(changeKey([{ ...base[0], acknowledged: '1' }, base[1], base[2]])).not.toBe(key);
    expect(changeKey([{ ...base[0], suppressed: '1' }, base[1], base[2]])).not.toBe(key);
    expect(changeKey([{ ...base[0], severity: '5' }, base[1], base[2]])).not.toBe(key);
  });

  it('treats a missing suppressed or r_eventid as the empty string, as the server does', () => {
    const bare = { ...base[0] };
    delete bare.suppressed;
    delete bare.r_eventid;
    expect(changeKey([bare])).toBe(`${bare.eventid}:${bare.severity}:${bare.acknowledged}::`);
  });
});
