/**
 * The report pages in a few lines each, for "host mana yang paling penuh minggu ini?", "alert apa yang paling berisik?", "trigger apa yang paling sering muncul?" and "berapa persen host yang punya owner?": the capacity
 * trends, the alert noise, the top triggers and the inventory and ownership scorecard, from the same reports that the pages keep, at the periods the pages offer so that they share one read.
 */

import { HOST_NAME_MAX, promptText, section, sevName } from './assistantLines.js';
import { valueText } from './assistantValues.js';
import type { CapacityReport } from './capacity.js';
import type { ScorecardResponse } from './inventory.js';
import type { NoiseReport } from './noise.js';
import { windowWords, type PastWindow } from './assistantWhen.js';
import type { getTopTriggers } from './reports.js';

type TopTriggers = Awaited<ReturnType<typeof getTopTriggers>>;

const DAY = 86_400;

/** The pages' default period, which a question that names none is given. */
export const REPORT_DAYS = 7;

/** The whole days a window covers, at least one and at most `max`, or the default when the question named none. */
export function daysOf(window: PastWindow | null, max = 31): number {
  return window ? Math.min(max, Math.max(1, Math.ceil((window.to - window.from) / DAY))) : REPORT_DAYS;
}

/** The periods that the Capacity, Alert noise and Top triggers pages offer, so that a question shares their reads and does not make a new cold one for each number of days (BK-88). */
export const PAGE_PERIODS: readonly number[] = [1, 7, 30, 90];

/** The smallest period that the Capacity page offers which covers the days, or the largest. */
export function capacityPeriod(days: number, offered: readonly number[]): number {
  return offered.find((p) => p >= days) ?? offered[offered.length - 1];
}

/**
 * What a title says a report covers. The reports read the whole days counted back from now, so the window the question named is used only when it is that span; any other (last week, yesterday, a
 * night, the week so far) is said not to be what was read, with the range that was, since a figure given for a period it does not cover reads as exact (BK-86).
 */
const over = (days: number, window: PastWindow | null, tz: string, now: number, actual?: { from: number; to: number }): string => {
  const plain = `the last ${days} day${days === 1 ? '' : 's'}`;
  if (!window) return plain;
  const read = actual ?? { from: now - days * DAY, to: now };
  const same = Math.abs(window.from - read.from) <= 60 && Math.abs(window.to - read.to) <= 60;
  // A report is kept for a while, so the range it read may end earlier than now: the title says when it ends.
  const from = Math.abs(read.to - now) <= 60 ? 'now' : 'when the report was built';
  return same ? windowWords(window, tz) : windowWords({ ...read, label: `${plain} counted back from ${from}, not ${window.label}` }, tz);
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The busiest hosts of each metric by their peak, three of each. */
export function capacitySection(report: CapacityReport, { window, tz, budget, now = nowSeconds() }: { window: PastWindow | null; tz: string; budget: number; now?: number }): { text: string; truncated: boolean } {
  const lines = report.metrics.flatMap((m) => {
    const rows = [...m.rows].sort((a, b) => b.max - a.max).slice(0, 3);
    if (!rows.length) return [];
    // The interfaces are the ports busiest when the report was built, ranked by the days afterwards: a port quiet then may be missing, and the answer must not call this list complete (BK-92).
    const chosen = m.key === 'ifutil' ? ' (only the ports that were busiest when this report was built are listed; a port that was quiet then may be missing)' : '';
    return [`- ${promptText(m.label, 60)}: ${rows.map((r) => `${promptText(r.host, HOST_NAME_MAX)} average ${valueText(String(r.avg), r.units)}, peak ${valueText(String(r.max), r.units)}`).join('; ')}${chosen}`];
  });
  // The report is kept for up to a day and carries the time it was built: the days it read are counted back from then.
  const built = report.generatedAt === undefined ? undefined : { from: report.generatedAt - report.days * DAY, to: report.generatedAt };
  return section(`CAPACITY over ${over(report.days, window, tz, now, built)}, the busiest hosts by peak:`, lines.length ? lines : ['- none: no reading is held for this period'], budget);
}

/** "Never acknowledged" is already said by the acknowledgement rate beside it, so only the other two are written. */
const FLAG_WORDS = { flapping: 'flapping', chronic: 'chronic' } as const;

export function noiseSection(report: NoiseReport, { window, tz, budget, now = nowSeconds() }: { window: PastWindow | null; tz: string; budget: number; now?: number }): { text: string; truncated: boolean } {
  const days = Math.max(1, Math.round(report.windowSeconds / DAY));
  const head = `${report.totalEvents} alerts from ${report.distinctTriggers} triggers; the loudest ${report.concentration.topN} made ${Math.round(report.concentration.percentOfEvents)} percent of them; ${report.counts.flapping} flapping, ${report.counts.unactioned} never acknowledged, ${report.counts.chronic} chronic`;
  const lines = report.triggers.slice(0, 5).map((t) => {
    const minutes = Math.max(1, Math.round(t.medianDuration / 60));
    const flags = t.flags.filter((f): f is keyof typeof FLAG_WORDS => f in FLAG_WORDS).map((f) => FLAG_WORDS[f]);
    return `- [${sevName(t.severity)}] ${promptText(t.host, HOST_NAME_MAX)}: ${promptText(t.name, 100)} x${t.count}, median ${minutes} min, acknowledged ${Math.round(t.ackRate * 100)} percent${flags.length ? `; ${flags.join(', ')}` : ''}`;
  });
  return section(`ALERT NOISE over ${over(days, window, tz, now, { from: report.from, to: report.to })}: ${head}:`, lines.length ? lines : ['- none: no alert in this period'], budget);
}

export function topTriggersSection(report: TopTriggers, { window, tz, budget, now = nowSeconds() }: { window: PastWindow | null; tz: string; budget: number; now?: number }): { text: string; truncated: boolean } {
  const lines = report.triggers.slice(0, 5).map((t) => `- [${sevName(t.severity)}] ${promptText(t.host, HOST_NAME_MAX)}: ${promptText(t.name, 100)} x${t.count}`);
  const cut = report.truncated ? ' (only the newest events were read, so the counts are a floor)' : '';
  return section(`TOP TRIGGERS over ${over(report.days, window, tz, now)}, by problem events${cut}:`, lines.length ? lines : ['- none: no problem event in this period'], budget);
}

export function scorecardSection(card: ScorecardResponse, budget: number): { text: string; truncated: boolean } {
  const lines = [`- ${card.dimensions.filter((d) => d.scored).map((d) => `${d.key} ${Math.round(d.pct)} percent`).join(', ')} of hosts carry each`];
  const worst = [...card.groups].sort((a, b) => a.pct - b.pct).slice(0, 3);
  if (worst.length) lines.push(`- lowest groups: ${worst.map((g) => `${promptText(g.name, 40)} ${Math.round(g.pct)} percent (${g.hosts} hosts)`).join(', ')}`);
  if (card.gaps.length) lines.push(`- ${card.gaps.length} hosts have a gap; the first: ${card.gaps.slice(0, 3).map((g) => `${promptText(g.name, HOST_NAME_MAX)} (missing ${g.missing.join(', ')})`).join('; ')}`);
  return section(`INVENTORY AND OWNERSHIP SCORECARD: ${Math.round(card.overall.pct)} percent of ${card.overall.hosts} hosts are complete (name, site, owner and criticality all present):`, lines, budget);
}
