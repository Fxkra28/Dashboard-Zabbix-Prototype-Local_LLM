import { describe, expect, it } from 'vitest';

/**
 * The naming convention the inventory scorecard (§16, HCML Goal 1) scores
 * against, read off HCML's 2026-06/07/08 Availability Reports.
 *
 * This is pinned here because an earlier, invented `SITE-DEVTYPE-SEQ` pattern
 * matched *zero* real HCML hosts: the scorecard would have reported 0% naming
 * compliance across their whole estate as a confident, wrong number. These are
 * real names from those reports.
 */
const PATTERN = /^(\d{1,2}\.\d{1,2}(\.\d{1,2})?\.?\s|(INET|WEB|SERVER)\s:\s).+$/;

const COMPLIANT = [
  // Two-segment device names.
  '1.1 ALPHA-FW01',
  '3.1 FG60F-CHARLIE-01',
  '12.1 FG-100F-POR-1',
  // Three-segment device names.
  '1.2.1 IDX02CORESWITCH',
  '9.1.1 WHP-MBH_IE3200_AS01',
  '11.3.5 MOPU ARUBA 5',
  '12.1.1 POR-C9200-01',
  '4.3.3 FPSO ARUBA 3',
  '6.3.2 STP ARUBA 2',
  // Two-digit site numbers.
  '11.1 FG-60F-MAC-MOPU-1',
  '14.2.1 TWSB-SW-01',
  // HCML's own stray trailing dots: real, and deliberately tolerated.
  '1.2.2. IDX02ACCESSSWITCH',
  '2.1. SBY01FW01',
  // Service names use the second form.
  'INET : SAMPANG WAN 1',
  'INET : MOPU WAN 2',
  'SERVER : CUCM JAKARTA',
  'WEB : PORTAL',
];

const NON_COMPLIANT = [
  'INTERNET', // no prefix at all, a real gap in HCML's estate
  'Zabbix server', // infrastructure, correctly unscored
  'SPG-SW-01', // the invented scheme this replaced
  'MPR-FW-01',
  '', // empty
  '1.2.1', // prefix with no name after it
  'INET: NO SPACES', // the form requires " : "
];

describe('HOST_NAME_PATTERN', () => {
  it.each(COMPLIANT)('accepts %s', (name) => {
    expect(PATTERN.test(name)).toBe(true);
  });

  it.each(NON_COMPLIANT)('rejects %s', (name) => {
    expect(PATTERN.test(name)).toBe(false);
  });

  it('is deliberately tolerant of HCML\u2019s own inconsistency', () => {
    // Site 1 numbers Cisco switches 1.2.x while site 9 uses 9.1.1; site 12 has
    // both 12.1 and 12.1.1. Enforcing one depth would score HCML's estate
    // against a convention it does not actually operate: the scorecard
    // measures whether a host carries *a* recognisable identifier.
    expect(PATTERN.test('12.1 FG-100F-POR-1')).toBe(true);
    expect(PATTERN.test('12.1.1 POR-C9200-01')).toBe(true);
  });

  it('matches the pattern the env templates ship', async () => {
    const { readFile } = await import('node:fs/promises');
    const env = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('HOST_NAME_PATTERN='));
    expect(line, 'HOST_NAME_PATTERN missing from server/.env.example').toBeDefined();
    // The committed template must stay in step with what is tested here.
    expect(new RegExp(line!.slice('HOST_NAME_PATTERN='.length)).source).toBe(PATTERN.source);
  });
});
