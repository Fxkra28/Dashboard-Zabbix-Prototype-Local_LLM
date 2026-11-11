import { describe, expect, it } from 'vitest';
import { buildLabel } from './build';
import { setReportTimeZone } from '../../shared/lib/time';

/** The footer's build line: what it says for each kind of build. */
describe('buildLabel', () => {
  setReportTimeZone('Asia/Jakarta');

  it('names the commit and the time, in the report zone', () => {
    const label = buildLabel({ commit: 'abc1234', time: '2026-10-07T09:19:57Z' });
    expect(label).toMatch(/^Build abc1234, /);
    expect(label).toMatch(/WIB$/); // the zone label, so the time is not read as the viewer's own clock
    expect(label).toMatch(/(4:19|16[.:]19)/); // 09:19 UTC is 16:19 in Jakarta, however the locale writes the hour
  });

  it('says "uncommitted" for a build made from a working tree, which is what every build is until the repository has a commit', () => {
    expect(buildLabel({ commit: 'uncommitted', time: '2026-10-07T09:24:31Z' })).toMatch(/^Build uncommitted, /);
  });

  it('keeps the commit when the time is missing or unreadable, and the time when the commit is unknown', () => {
    expect(buildLabel({ commit: 'abc1234', time: 'unknown' })).toBe('Build abc1234');
    expect(buildLabel({ commit: 'abc1234', time: '' })).toBe('Build abc1234');
    expect(buildLabel({ commit: 'unknown', time: '2026-10-07T09:19:57Z' })).toMatch(/^Build \d/);
    expect(buildLabel({ commit: 'unknown', time: '2026-10-07T09:19:57Z' })).not.toContain('unknown');
  });

  it('says nothing for a build that was never stamped, rather than a line that reads "unknown"', () => {
    expect(buildLabel({ commit: 'unknown', time: 'unknown' })).toBeNull();
    expect(buildLabel({ commit: '', time: '' })).toBeNull();
    expect(buildLabel(null)).toBeNull();
  });
});
