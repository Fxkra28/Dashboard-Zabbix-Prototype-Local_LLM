/**
 * The series behind a graph, for "rata-rata CPU switch X kemarin?" and "suhu tertinggi 1.2.11 minggu ini?": the lowest, the average, the highest and the last of an item over a window, given as four figures and never as
 * points. They are the figures that the Graphs page computes for the same item and window (history up to a day, hourly trends beyond), so a graph and an answer agree.
 */

import { itemName, valueText, type ValueItem } from './assistantValues.js';
import { HOST_NAME_MAX, promptText, section } from './assistantLines.js';
import { windowWords, type PastWindow } from './assistantWhen.js';
import type { getGraph } from './history.js';

type Graph = Awaited<ReturnType<typeof getGraph>>;

const LABEL: Record<string, string> = { cpu: 'CPU', memory: 'Memory', temperature: 'Temperature', disk: 'Disk', traffic: 'Traffic', uptime: 'Uptime', latency: 'Latency' };

/** The window, with how much of it the item has readings for. */
function coverageText(covered: number, w: PastWindow): string {
  const share = Math.round((Math.min(covered, w.to - w.from) / Math.max(1, w.to - w.from)) * 100);
  return share >= 98 ? 'readings for all of it' : `readings for ${share} percent of it`;
}

export function seriesSection(graph: Graph, picks: ValueItem[], { host, window, tz, budget, local = true }: { host: string; window: PastWindow; tz: string; budget: number; local?: boolean }): { text: string; truncated: boolean } {
  const lines = picks.flatMap((item) => {
    const series = graph.series.find((s) => s.itemid === item.itemid);
    if (!series) return [];
    if (!series.stats) return [`- ${LABEL[item.metric] ?? item.metric}: ${itemName(item.name, local)}: no reading in this window`];
    const { min, avg, max, last } = series.stats;
    const v = (n: number) => valueText(String(n), series.units);
    return [`- ${LABEL[item.metric] ?? item.metric}: ${itemName(series.name, local)}: lowest ${v(min)}, average ${v(avg)}, highest ${v(max)}, last ${v(last)} (${coverageText(series.coverage.coveredSeconds, window)})`];
  });
  const title = `SERIES of ${promptText(host, HOST_NAME_MAX)} over ${windowWords(window, tz)}, from ${graph.source === 'history' ? 'the readings' : 'the hourly trends'}:`;
  return section(title, lines.length ? lines : ['- none: no reading of that item is held for this window'], budget);
}
