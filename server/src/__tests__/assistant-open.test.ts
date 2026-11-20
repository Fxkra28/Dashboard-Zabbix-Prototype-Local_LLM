import { describe, expect, it } from 'vitest';
import { floorOf, openProblemsSection } from '../services/assistantOpen.js';

/**
 * The open problems beyond the few that the snapshot names: all of a site's, or of a severity. The estate as a whole is counted, not listed, since a list of hundreds answers nothing.
 */

const NOW = Date.parse('2026-11-18T05:30:00Z') / 1000;

const problem = (eventid: string, host: string, severity: string, over: Record<string, unknown> = {}) =>
  ({ eventid, host, hostid: host, severity, name: `Problem ${eventid}`, clock: String(NOW - 3600 * Number(eventid)), acknowledged: '0', object: '0', objectid: eventid, ...over }) as never;

describe('floorOf', () => {
  it('reads the severity a question names, in either language', () => {
    expect(floorOf('semua problem critical di Surabaya')).toBe(5);
    expect(floorOf('list all high problems')).toBe(4);
    expect(floorOf('sebutkan masalah yang tingkat sedang')).toBe(3);
    expect(floorOf('tampilkan semua warning')).toBe(2);
    expect(floorOf('sebutkan semua problem di Pasuruan')).toBeNull();
  });
});

describe('openProblemsSection', () => {
  const opts = { scope: 'Pasuruan / GMS', floor: null, now: NOW, budget: 1_000 };

  it('lists every open problem of the scope, worst first, in the words of the snapshot, with how many there are', () => {
    const list = [problem('1', 'A-SW1', '2'), problem('2', 'B-SW2', '5'), problem('3', 'C-SW3', '4')];
    expect(openProblemsSection(list, opts).text.split('\n')).toEqual([
      'OPEN PROBLEMS at Pasuruan / GMS: 3 in all, worst first:',
      '- [Disaster] B-SW2: Problem 2; open 2h, not acked',
      '- [High] C-SW3: Problem 3; open 3h, not acked',
      '- [Warning] A-SW1: Problem 1; open 1h, not acked',
    ]);
  });

  it('keeps to a severity and above, and says which', () => {
    const list = [problem('1', 'A-SW1', '2'), problem('2', 'B-SW2', '5'), problem('3', 'C-SW3', '4'), problem('4', 'D-SW4', '3')];
    const text = openProblemsSection(list, { ...opts, floor: 4 }).text;
    expect(text.split('\n')[0]).toBe('OPEN PROBLEMS at Pasuruan / GMS, High and above: 2 in all, worst first:');
    expect(text).not.toContain('A-SW1');
    expect(text).not.toContain('D-SW4');
  });

  it('counts the whole estate and says what narrows it, instead of listing hundreds', () => {
    const list = [problem('1', 'A', '2'), problem('2', 'B', '5'), problem('3', 'C', '2')];
    const text = openProblemsSection(list, { ...opts, scope: null }).text;
    expect(text).toContain('OPEN PROBLEMS across the estate: 3 in all (Disaster 1, Warning 2); they are not listed without a site, a host or a severity to narrow them:');
    expect(text.split('\n')).toHaveLength(1);
  });

  it('lists the estate for a severity, which narrows it', () => {
    const list = [problem('1', 'A', '2'), problem('2', 'B', '5')];
    expect(openProblemsSection(list, { ...opts, scope: null, floor: 5 }).text.split('\n')).toEqual(['OPEN PROBLEMS across the estate, Disaster and above: 1 in all, worst first:', '- [Disaster] B: Problem 2; open 2h, not acked']);
  });

  it('stays within its budget and says how many it left out', () => {
    const list = Array.from({ length: 40 }, (_, i) => problem(String(i + 1), `HOST-${i}`, '4'));
    const { text, truncated } = openProblemsSection(list, { ...opts, budget: 600 });
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text).toMatch(/- …and \d+ more, not listed$/);
    expect(truncated).toBe(true);
  });

  it('says that there is none when the scope has none', () => {
    expect(openProblemsSection([], opts).text.split('\n')[0]).toBe('OPEN PROBLEMS at Pasuruan / GMS: 0 in all, worst first:');
  });
});
