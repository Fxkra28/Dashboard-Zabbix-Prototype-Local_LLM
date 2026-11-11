/** Assertions for web/src/shared/lib/units.ts. Run from the repo root: ./server/node_modules/.bin/tsx web/scripts/units.check.ts */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERCENT_DP, dur, formatAxis, formatPercent, formatValue, formatDuration } from '../src/shared/lib/units.ts';
import { naturalCompare, siteFromHostName } from '../src/shared/lib/sites.ts';
import { monthBounds } from '../src/shared/lib/time.ts';

const eq = (actual: string, expected: string) => assert.equal(actual, expected);

eq(formatValue(null), '—');
eq(formatValue(undefined, 'bps'), '—');
eq(formatValue(NaN, '%'), '—');

eq(formatValue(0, 'bps'), '0 bps');
eq(formatValue(999, 'bps'), '999 bps');
eq(formatValue(1500, 'bps'), '1.5 Kbps');
eq(formatValue(24_192_312, 'bps'), '24.19 Mbps');
eq(formatValue(20_000_000_000, 'bps'), '20 Gbps');
eq(formatValue(500_000_000, 'bps'), '500 Mbps');
eq(formatValue(100_000, 'bps'), '100 Kbps');
eq(formatValue(10, 'bps'), '10 bps');
eq(formatValue(300, 's'), '5 min');
eq(formatValue(100, 'ms'), '100 ms');
eq(formatValue(107_715_584, 'b/s'), '107.7 Mbps');

eq(formatValue(1024, 'B'), '1 KB');
eq(formatValue(1_039_176_940, 'B'), '991 MB');
eq(formatValue(1536, 'Bps'), '1.5 KB/s');
eq(formatValue(512, 'B'), '512 B');

eq(formatValue(23.77704635174604, '%'), '23.78%');
eq(formatValue(100, '%'), '100.00%');
eq(formatValue(0.5, '%'), '0.50%');

// One rule for a percentage: the sign against the number, one precision per measure.
eq(formatPercent(0.5, 'loss'), '0.50%');
eq(formatPercent(99.96234, 'availability'), '99.96%');
eq(formatPercent(12.34, 'utilisation'), '12.3%');
eq(formatPercent(0, 'loss'), '0.00%');
eq(formatPercent(null, 'loss'), '—');
eq(formatPercent(undefined, 'availability'), '—');
eq(formatPercent(NaN, 'utilisation'), '—');
// The same figure reads the same whichever page prints it: a loss figure on Network (an item in %) and on Links.
eq(formatPercent(0.5, 'loss'), formatValue(0.5, '%'));
eq(formatPercent(23.777, 'item'), formatValue(23.777, '%'));
eq(formatAxis(23.78, '%'), '23.8%');
for (const measure of Object.keys(PERCENT_DP) as (keyof typeof PERCENT_DP)[]) {
  assert.doesNotMatch(formatPercent(1.2345, measure), /\s/, `${measure}: no space before the percent sign`);
  assert.equal(formatPercent(1.2345, measure).split('.')[1], `${(1.2345).toFixed(PERCENT_DP[measure]).split('.')[1]}%`);
}

eq(formatValue(0.123, 's'), '123 ms');
eq(formatValue(0.0254, 's'), '25.4 ms');
eq(formatValue(2.5, 's'), '2.5 s');
eq(formatValue(90, 's'), '1.5 min');
eq(formatValue(7200, 's'), '2 h');

eq(formatValue(3 * 86400 + 4 * 3600 + 120, 'uptime'), '3d 4h');
eq(formatDuration(3600 * 5 + 60 * 7), '5h 7m');
eq(dur(45), '45s');
eq(dur(750), '13m');
eq(dur(3.5 * 3600), '3.5h');
eq(dur(2.1 * 86400), '2.1d');
eq(dur(-5400), '−1.5h');
eq(dur(-0.4), '0s');
assert.match(formatValue(1789617000, 'unixtime'), /2026/);

eq(formatValue(49, '°C'), '49 °C');
eq(formatValue(1, ''), '1');
eq(formatValue(0.5), '0.5');
eq(formatValue(123456), '123,456');

assert.ok(naturalCompare('Gi1/0/2', 'Gi1/0/10') < 0);
assert.ok(naturalCompare('1.2.2. IDXSVFSW01', '1.2.10 IDX24C') < 0);
assert.deepEqual(siteFromHostName('2.1. SUB11FW01'), { code: 2, name: 'Surabaya' });
assert.deepEqual(siteFromHostName('INET : TWSB LINI 2 WAN 1'), { code: 14, name: 'TWSB' });
assert.equal(siteFromHostName('INTERNET'), null);
assert.deepEqual(monthBounds('2026-08'), { from: 1785517200, to: 1788195600 });
assert.deepEqual(monthBounds('2026-12'), { from: 1796058000, to: 1798736400 });

// No page may format a percentage by hand: `x.toFixed(2)%` is how Links read 0.5% while Network read 0.50 %.
// Everything goes through formatPercent, so a measure cannot drift from its precision.
export const HAND_ROLLED_PERCENT = /\.toFixed\(\s*\d+\s*\)\s*\}?\s*%/;
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(HAND_ROLLED_PERCENT.test('`${v.toFixed(2)}%`'), 'self-test: the pattern sees a template literal');
assert.ok(HAND_ROLLED_PERCENT.test('{r.utilisation.toFixed(1)} %'), 'self-test: the pattern sees JSX text with a space');
assert.ok(!HAND_ROLLED_PERCENT.test('formatPercent(v, "loss")'), 'self-test: the pattern leaves the formatter alone');
assert.ok(!HAND_ROLLED_PERCENT.test('{r.avg.toFixed(1)}{r.units}'), 'self-test: the pattern leaves a value with its own unit alone');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const SRC = fileURLToPath(new URL('../src', import.meta.url));
const offenders = sourceFiles(SRC)
  // units.ts is the rule itself, and percent.ts the Met/Missed text that adds digits to stay on the right side of a target.
  .filter((f) => !f.endsWith(join('shared', 'lib', 'units.ts')) && !f.endsWith(join('features', 'sla', 'percent.ts')))
  .filter((f) => HAND_ROLLED_PERCENT.test(withoutComments(readFileSync(f, 'utf8'))))
  .map((f) => f.slice(SRC.length + 1));
assert.deepEqual(offenders, [], `format percentages with formatPercent (shared/lib/units.ts), not toFixed: ${offenders.join(', ')}`);

console.log('units.check: all assertions passed');
