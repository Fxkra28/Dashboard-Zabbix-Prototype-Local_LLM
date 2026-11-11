import type { GraphSeries } from '../../types';
import { ago, fmtTime } from '../../shared/lib/severity';

const hoursText = (s: number) => {
  const h = s / 3600;
  if (h >= 48) return `${Math.round(h / 24)} d`;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} h`;
};

/**
 * Says so when a graph is thinner or older than it looks:
 *   - "Data covers 0.5 h of 24 h" when a series has values for under 90 % of the window;
 *   - "No new data since …" when the window ends now but the newest value is old.
 * Without it a mostly-empty or day-old graph would pass for a complete, live one.
 */
export default function StaleNote({
  from,
  to,
  series,
  latestClock,
}: {
  from: number;
  to: number;
  series: GraphSeries[];
  latestClock: number | null;
}) {
  const now = Date.now() / 1000;
  const window = to - from;
  const notes: string[] = [];

  const withData = series.filter((s) => s.coverage.coveredSeconds > 0);
  if (withData.length) {
    const least = withData.reduce((a, b) => (b.coverage.coveredSeconds < a.coverage.coveredSeconds ? b : a));
    if (window > 0 && least.coverage.coveredSeconds / window < 0.9) {
      notes.push(
        `Data covers ${hoursText(least.coverage.coveredSeconds)} of ${hoursText(window)}${
          series.length > 1 ? ` (${least.name})` : ''
        }${least.coverage.lastClock ? `, last value ${fmtTime(least.coverage.lastClock)}` : ''}.`,
      );
    }
  }
  const empty = series.filter((s) => !s.stats);
  if (empty.length && empty.length < series.length) {
    notes.push(`No data in this range for ${empty.map((s) => s.name).join(', ')}.`);
  }

  const delay = Math.max(0, ...series.map((s) => s.delaySeconds || 0));
  if (latestClock && to >= now - 120 && now - latestClock > Math.max(600, 3 * delay)) {
    notes.push(`No new data since ${fmtTime(latestClock)} (${ago(latestClock)}).`);
  }

  if (!notes.length) return null;
  return (
    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
      {notes.join(' ')}
    </div>
  );
}
