import { fixedBelow100 } from '../../shared/lib/units';

/**
 * 98.996 against 99 must not print as "99.00%": digits are added from `digits` until the text is on the real side.
 * Same rule as the server's percentText (export/slaReport.ts).
 */
export function percentText(value: number, target: number, digits = 2): string {
  const met = value >= target;
  const steps = [digits, 4, 6, 8].filter((d) => d >= digits);
  const found = steps.find((d) => (Number(fixedBelow100(value, d)) >= target) === met);
  // Closer to the target than eight decimals can show: cut instead of rounding.
  if (found === undefined) return `${(Math.trunc(value * 1e8) / 1e8).toFixed(8)}%`;
  const text = fixedBelow100(value, found);
  // 98.996 reads as such, not as 98.9960: the extra digits are only there to stay on the right side.
  return `${found === digits ? text : text.replace(new RegExp(`(\\.\\d{${digits}}\\d*?)0+$`), '$1')}%`;
}
