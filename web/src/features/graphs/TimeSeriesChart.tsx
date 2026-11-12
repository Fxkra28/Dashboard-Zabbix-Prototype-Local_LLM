import { useEffect, useId, useMemo, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
// ECharts 6 restyled its defaults; this registers the 5.x look as the theme
// 'v5', so the parts this chart does not colour itself stay as they were.
import 'echarts/theme/v5.js';
// The ESM build: Vite 8 hands a default import of the CommonJS lib/ build the
// whole exports object in a "type": "module" package, not the component.
import ReactEChartsCore from 'echarts-for-react/esm/core';
import type { GraphPoint, GraphRange, GraphResponse, GraphSeries } from '../../types';
import { theme } from '../../theme';
import { formatAxis, formatValue } from '../../shared/lib/units';
import { fmtTime } from '../../shared/lib/severity';
import { axisNeedsDays, formatAxisTime, formatDateTime, formatDayTime } from '../../shared/lib/time';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import { chartTable, seriesLabel } from './chartTable';
import { chartCsvFileName, chartCsvRows } from './chartCsv';
import { downloadCsv } from '../../shared/lib/csv';
import { NoData, orNoData } from '../../shared/components/NoData';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useThemeChange } from './useThemeChange';
import StaleNote from './StaleNote';
import { MAX_UNIT_SCALES, unitFamilies } from './unitScales';
import { Async, Loading } from '../../shared/components/states';
import { isLiveRange, rangeKey } from './RangePicker';

/**
 * Register only what this chart draws.
 *
 * The convenience import (`echarts-for-react` → the `echarts` barrel) pulls in
 * every chart type, coordinate system and renderer ECharts ships, roughly a
 * megabyte. This registers the pieces actually used and leaves the rest out.
 */
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

const SERIES_TOKENS = ['--series-1', '--series-2', '--series-3', '--series-4'];
/** From this series on, the line is dashed: a second cue for a reader who cannot tell two of the hues apart. */
const DASHED_FROM = 2;

/**
 * The four series colours, read out of the stylesheet rather than written here, because ECharts
 * paints to a canvas and a canvas cannot resolve `var()`; reading them at render gives the dark
 * theme its own set.
 *
 * A chart is the one place the palette allows a second hue: four shades of the brand blue on one
 * line chart cannot be told apart. None of the four sits in severity's warm range, so a plotted
 * line is never mistaken for an alarm.
 */
export function seriesColors(): string[] {
  if (typeof window === 'undefined') return [theme.primary];
  const style = getComputedStyle(document.documentElement);
  return SERIES_TOKENS.map((t) => style.getPropertyValue(t).trim() || theme.primary);
}

/**
 * Axis, gridline and tooltip colours, resolved the same way and for the same
 * reason. Without this the chart keeps its light axes on a dark page, which is
 * the usual way a canvas gets left out of a theme.
 */
function chartInk(): { muted: string; border: string; surface: string; text: string } {
  if (typeof window === 'undefined') {
    return { muted: theme.muted, border: theme.border, surface: theme.surface, text: theme.text };
  }
  const style = getComputedStyle(document.documentElement);
  const read = (token: string, fallback: string) => style.getPropertyValue(token).trim() || fallback;
  return {
    muted: read('--muted', theme.muted),
    border: read('--border', theme.border),
    surface: read('--surface', theme.surface),
    text: read('--text', theme.text),
  };
}

type Meta = { kind: 'line' | 'low' | 'high'; s: GraphSeries; color: string };

/**
 * Line chart for 1 to 4 /api/graph series.
 *
 * - The x-axis is pinned to the requested window, so a sparse item doesn't
 *   stretch its few points across the whole width.
 * - Straight segments (no smoothing), step lines for 0/1 states, and a break
 *   wherever the BFF marked a collection gap (null), never a line across it.
 * - A single series from trends gets a shaded min to max band.
 * - No `notMerge`: a refresh merges new data and keeps the user's zoom. The
 *   parent remounts the chart (React `key`) when the selection or range changes.
 */
export default function TimeSeriesChart({
  series,
  from,
  to,
  height = 320,
  dataOpen,
  onDataOpenChange,
}: {
  series: GraphSeries[];
  from: number;
  to: number;
  height?: number;
  /**
   * Whether the Show data table is open, when the parent holds that: the chart is remounted whenever the selection or range changes,
   * so a panel only this component knew about would close itself. Left out, the chart keeps its own.
   */
  dataOpen?: boolean;
  onDataOpenChange?: (open: boolean) => void;
}) {
  const summaryId = useId();
  const dataId = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const showData = dataOpen ?? ownOpen;
  const toggleData = () => {
    const next = !showData;
    if (dataOpen === undefined) setOwnOpen(next);
    onDataOpenChange?.(next);
  };
  const chartName = `Line chart of ${series.map((s) => seriesLabel(s, series)).join('; ')}, ${fmtTime(from)} to ${fmtTime(to)}`;
  // Up to two unit families get their own axis (bps left, % right). A third goes on the first: the picker refuses it, an address can ask for it.
  const unitAxes = unitFamilies(series.map((s) => s.units)).slice(0, MAX_UNIT_SCALES);
  const axisOf = (s: GraphSeries) => Math.max(0, unitAxes.indexOf(s.units));
  const offScale = series.filter((s) => !unitAxes.includes(s.units));

  const band =
    series.length === 1 &&
    !series[0].step &&
    series[0].points.some((p) => p[2] !== null && p[3] !== null);

  // The colours are read at render, so a theme switch must cause one even when no new data arrives.
  useThemeChange();
  // The axis is drawn in the report zone, so a change of zone redraws it.
  useReportTimeZone();
  const dayOnTicks = axisNeedsDays(from, to);
  const palette = seriesColors();
  const ink = chartInk();
  const metas: Meta[] = [];
  const chartSeries: Record<string, unknown>[] = [];

  series.forEach((s, i) => {
    const color = palette[i % palette.length];
    metas.push({ kind: 'line', s, color });
    chartSeries.push({
      name: seriesLabel(s, series),
      type: 'line',
      yAxisIndex: axisOf(s),
      smooth: false,
      step: s.step ? 'end' : false,
      connectNulls: false,
      showSymbol: s.points.length < 40,
      symbolSize: 4,
      sampling: undefined,
      lineStyle: { width: 1.6, color, type: i % palette.length >= DASHED_FROM ? 'dashed' : 'solid' },
      itemStyle: { color },
      areaStyle: series.length === 1 && !band ? { opacity: 0.07, color } : undefined,
      data: s.points.map((p) => [p[0], p[1]]),
      z: 3,
    });
    if (band && i === 0) {
      metas.push({ kind: 'low', s, color });
      chartSeries.push({
        name: '__low',
        type: 'line',
        stack: 'band',
        symbol: 'none',
        connectNulls: false,
        lineStyle: { opacity: 0 },
        data: s.points.map((p) => [p[0], p[2]]),
        silent: true,
        z: 1,
      });
      metas.push({ kind: 'high', s, color });
      chartSeries.push({
        name: '__high',
        type: 'line',
        stack: 'band',
        symbol: 'none',
        connectNulls: false,
        lineStyle: { opacity: 0 },
        areaStyle: { color, opacity: 0.14 },
        data: s.points.map((p) => [p[0], p[2] !== null && p[3] !== null ? p[3] - p[2] : null]),
        silent: true,
        z: 1,
      });
    }
  });

  const option = {
    animation: false,
    grid: {
      left: 64,
      right: unitAxes.length > 1 ? 64 : 20,
      top: series.length > 1 ? 34 : 16,
      bottom: 64,
      // ECharts 6 shrinks the grid to fit a long axis label; 5.x kept it where set.
      outerBoundsMode: 'none',
    },
    legend:
      series.length > 1
        ? {
            top: 0,
            data: metas.filter((m) => m.kind === 'line').map((m) => seriesLabel(m.s, series)),
            textStyle: { color: ink.muted },
          }
        : undefined,
    tooltip: {
      trigger: 'axis',
      confine: true,
      // The library paints a white box with dark text unless told: the tokens keep it on the page's plane in both themes (UX-41).
      backgroundColor: ink.surface,
      borderColor: ink.border,
      textStyle: { color: ink.text },
      formatter: (params: { seriesIndex: number; dataIndex: number; value: [number, number | null] }[]) => {
        if (!params.length) return '';
        const t = params[0].value[0];
        const rows = params
          .filter((p) => metas[p.seriesIndex]?.kind === 'line')
          .map((p) => {
            const m = metas[p.seriesIndex];
            const point = m.s.points[p.dataIndex];
            const value = point?.[1];
            const range =
              point && point[2] !== null && point[3] !== null && !m.s.step
                ? ` <span style="color:${ink.muted}">(${esc(formatValue(point[2], m.s.units))} – ${esc(
                    formatValue(point[3], m.s.units),
                  )})</span>`
                : '';
            return `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${
              m.color
            };margin-right:6px"></span>${esc(seriesLabel(m.s, series))}: <b>${
              value === null || value === undefined ? 'no data' : esc(formatValue(value, m.s.units))
            }</b>${range}</div>`;
          });
        return `<div style="font-size:12px"><div style="margin-bottom:4px;color:${ink.muted}">${esc(
          formatDateTime(t),
        )}</div>${rows.join('')}</div>`;
      },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        height: 18,
        bottom: 12,
        backgroundColor: ink.surface,
        borderColor: ink.border,
        textStyle: { color: ink.text },
        labelFormatter: (value: number) => formatDayTime(value),
      },
    ],
    xAxis: {
      type: 'time',
      min: from * 1000,
      max: to * 1000,
      // ECharts draws a time axis in the browser's zone: the ticks are its own, the words are the report zone's.
      axisLabel: { color: ink.muted, hideOverlap: true, formatter: (value: number) => formatAxisTime(value, to - from, undefined, dayOnTicks) },
      axisLine: { lineStyle: { color: ink.border } },
    },
    yAxis: (unitAxes.length ? unitAxes : ['']).map((units, i) => ({
      type: 'value',
      position: i === 0 ? 'left' : 'right',
      scale: false,
      axisLabel: { color: ink.muted, formatter: (v: number) => formatAxis(v, units) },
      splitLine: i === 0 ? { lineStyle: { color: ink.border } } : { show: false },
      ...(series.every((s) => s.step) ? { max: (v: { max: number }) => Math.max(1, v.max) } : {}),
    })),
    series: chartSeries,
  };

  return (
    <div className="tsc">
      {offScale.length > 0 && (
        <div className="notice warn" role="status">
          A graph has two scales at most, one for each kind of unit. {offScale.map((s) => seriesLabel(s, series)).join(', ')} {offScale.length === 1 ? 'does' : 'do'} not fit
          and {offScale.length === 1 ? 'is' : 'are'} drawn on the first scale, so {offScale.length === 1 ? 'its line reads' : 'their lines read'} wrongly. The tooltip and the table have the true values;
          remove an item to draw them properly.
        </div>
      )}
      {/* A canvas says nothing to a screen reader: name it, and point at the figures under it.
          The summary stays outside the img, since an img's children are not read (UX-17). */}
      <div role="img" aria-label={chartName} aria-describedby={summaryId}>
        <ReactEChartsCore echarts={echarts} theme="v5" option={option} style={{ height }} lazyUpdate />
      </div>
      <div className="chart-summary" id={summaryId}>
        {series.map((s, i) => (
          <div key={s.itemid} className="chart-summary-row">
            <span className="dot" style={{ background: palette[i % palette.length] }} />
            <span className="chart-summary-name" title={`${s.host}: ${s.name}`}>
              {seriesLabel(s, series)}
            </span>
            {s.stats ? (
              <span className="chart-summary-stats">
                <span>
                  <em>min</em> {orNoData(formatValue(s.stats.min, s.units))}
                </span>
                <span>
                  <em>avg</em> {orNoData(formatValue(s.stats.avg, s.units))}
                </span>
                <span>
                  <em>max</em> {orNoData(formatValue(s.stats.max, s.units))}
                </span>
                <span>
                  <em>last</em> {orNoData(formatValue(s.stats.last, s.units))}
                </span>
              </span>
            ) : (
              <span className="muted">no data in this range</span>
            )}
          </div>
        ))}
      </div>
      {/* The chart gives its values only on hover. The tables give them to a keyboard and a screen reader. */}
      <div className="chart-data-bar">
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={showData}
          aria-controls={dataId}
          onClick={toggleData}
        >
          {showData ? 'Hide data' : 'Show data'}
        </button>
        {/* The file is what the table shows, whether or not the table is open. */}
        <button
          type="button"
          className="btn ghost sm"
          disabled={!series.some((s) => s.points.length)}
          onClick={() => downloadCsv(chartCsvFileName(from, to), chartCsvRows(series))}
        >
          Download CSV
        </button>
      </div>
      <div id={dataId}>{showData && <ChartData series={series} />}</div>
    </div>
  );
}

/**
 * What the chart plots as one plain table, a column group per selected item joined on time (chartTable.ts), so it always matches the selection.
 * Only built while the reader has it open.
 */
function ChartData({ series }: { series: GraphSeries[] }) {
  const labels = series.map((s) => seriesLabel(s, series));
  const { ranged, rows } = useMemo(() => chartTable(series), [series]);
  const many = series.length > 1;
  // The names of a series' columns: a trend series has three, any other one.
  const subHeads = (isRange: boolean) => (isRange ? ['Average', 'Min', 'Max'] : ['Value']);
  const value = (s: GraphSeries, p: GraphPoint | undefined, at: 1 | 2 | 3) =>
    p === undefined ? <NoData label="No value at this time" /> : orNoData(formatValue(p[at], s.units));

  return (
    <div className="chart-data">
      {/* A long table scrolls in its own box, which takes focus so the keyboard can scroll it. */}
      <div className="table-wrap chart-data-scroll" role="region" aria-label={`Data of ${labels.join(', ')}`} tabIndex={0}>
        <table className="data compact">
          <caption>{labels.join('; ')}</caption>
          <thead>
            {many ? (
              <>
                <tr>
                  <th className="chart-time" rowSpan={2} scope="col">
                    Time
                  </th>
                  {series.map((s, i) => (
                    <th key={s.itemid} colSpan={ranged[i] ? 3 : 1} scope="colgroup">
                      {labels[i]}
                    </th>
                  ))}
                </tr>
                <tr>
                  {series.flatMap((s, i) => subHeads(ranged[i]).map((h) => <th key={`${s.itemid}:${h}`} scope="col">{h}</th>))}
                </tr>
              </>
            ) : (
              <tr>
                <th className="chart-time" scope="col">
                  Time
                </th>
                {subHeads(ranged[0]).map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.at}>
                <td className="nowrap chart-time">{formatDateTime(r.at)}</td>
                {series.flatMap((s, i) => {
                  const p = r.cells[i];
                  const cells = [
                    <td key={`${s.itemid}:1`} className="nowrap">
                      {value(s, p, 1)}
                    </td>,
                  ];
                  if (ranged[i]) {
                    cells.push(
                      <td key={`${s.itemid}:2`} className="nowrap">
                        {value(s, p, 2)}
                      </td>,
                      <td key={`${s.itemid}:3`} className="nowrap">
                        {value(s, p, 3)}
                      </td>,
                    );
                  }
                  return cells;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const SOURCE_LABEL: Record<GraphResponse['source'], string> = {
  history: 'raw history',
  trend: 'hourly trends',
  'trend+history': 'hourly trends + recent history',
};

/**
 * Fetch + stale note + chart for a set of items over a range. Refreshes only
 * for windows ending now, at the items' own update interval (30 s to 5 min).
 * The chart is keyed on selection + range, so a refresh keeps the zoom.
 */
export function GraphView({
  itemids,
  range,
  height,
  empty = 'No data in this range.',
}: {
  itemids: string[];
  range: GraphRange;
  height?: number;
  empty?: string;
}) {
  const idsKey = itemids.join(',');
  const rk = rangeKey(range);
  const live = isLiveRange(range);
  // Held here, not in the chart, which is remounted on every change of selection or range and would close the table.
  const [dataOpen, setDataOpen] = useState(false);
  // Poll at the items' own interval once it is known. useAsync only moves its
  // timer when the interval changes, so learning it doesn't refetch.
  const [pollMs, setPollMs] = useState(30_000);
  const q = useAsync<(GraphResponse & { requestKey: string }) | null>(
    () =>
      itemids.length
        ? api.graph(itemids, range).then((g) => ({ ...g, requestKey: `${idsKey}|${rk}` }))
        : Promise.resolve(null),
    [idsKey, rk],
    live && itemids.length ? pollMs : undefined,
  );
  const delay = Math.max(0, ...(q.data?.series.map((s) => s.delaySeconds) ?? [0]));
  const intervalMs = Math.min(Math.max(delay * 1000, 30_000), 300_000);
  useEffect(() => setPollMs(intervalMs), [intervalMs]);

  if (!itemids.length) return <div className="state">Pick an item to graph.</div>;
  // Data for a previous selection is still in hand while the new one loads.
  const current = q.data?.requestKey === `${idsKey}|${rk}` ? q.data : null;
  if (!current && !q.error) return <Loading label="Loading graph…" />;

  return (
    <Async
      loading={q.loading}
      error={q.error}
      data={current}
      updatedAt={q.updatedAt}
      loadingLabel="Loading graph…"
    >
      {(g) => (
        <>
          <div className="graph-meta">
            <span className="pill">{SOURCE_LABEL[g.source]}</span>
            {g.downsampled && <span className="muted">downsampled</span>}
            {live && <span className="muted">refreshes every {Math.round(intervalMs / 1000)} s</span>}
          </div>
          <StaleNote from={g.from} to={g.to} series={g.series} latestClock={g.latestClock} />
          {g.series.some((s) => s.points.length) ? (
            <TimeSeriesChart
              key={`${idsKey}|${rk}`}
              series={g.series}
              from={g.from}
              to={g.to}
              height={height}
              dataOpen={dataOpen}
              onDataOpenChange={setDataOpen}
            />
          ) : (
            <div className="state">{empty}</div>
          )}
        </>
      )}
    </Async>
  );
}
