# Web app: the pages

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 30 min | [Web app: the API client, the types and the guards](web-api-types-guards.md) | [Web app: the stylesheet](web-styles.md) |

The pages are in `web/src/features/`, one folder for each part of the portal. A page is a component that reads through `useAsync` or `useSSE`, draws what it gets with the shared components, and keeps its filters in the address with `useUrlState`. Most of them are plain and are explained by their cards. This chapter walks through the ones with something to explain: the Dashboard and its wall mode, the Problems page and the one write, the chart, the gauge, and the Assistant.

## The pages

The sidebar is the list. Which role may see a page is not written in the web app: the server says so in `/api/auth/me`, and the menu follows it. The server is still the authority, and a page above the signed-in role gets the server's refusal, which the error state words calmly.

| Page | Address | Main file |
|---|---|---|
| Dashboard | `/` | `web/src/features/dashboard/Overview.tsx` |
| Problems | `/problems` | `web/src/features/problems/Problems.tsx` |
| Sites | `/sites` | `web/src/features/network/Sites.tsx` |
| Hosts | `/hosts` | `web/src/features/hosts/Hosts.tsx` |
| Devices | `/devices` | `web/src/features/hosts/Devices.tsx` |
| Latest data | `/latest` | `web/src/features/hosts/LatestData.tsx` |
| Graphs | `/graphs` | `web/src/features/graphs/HostDetail.tsx` |
| Maps | `/maps` | `web/src/features/network/Maps.tsx` |
| Network | `/network` | `web/src/features/network/Network.tsx` |
| Links and WAN health | `/links` | `web/src/features/network/Links.tsx` |
| Services | `/services` | `web/src/features/sla/Services.tsx` |
| SLA | `/sla` | `web/src/features/sla/Sla.tsx` |
| Availability and response | `/reports/availability` | `web/src/features/sla/Availability.tsx` |
| Capacity trends | `/reports/capacity` | `web/src/features/reports/Capacity.tsx` |
| Alert noise | `/reports/noise` | `web/src/features/reports/AlertNoise.tsx` |
| Top 100 triggers | `/reports/top-triggers` | `web/src/features/reports/TopTriggers.tsx` |
| Inventory and ownership scorecard | `/reports/inventory` | `web/src/features/reports/Inventory.tsx` |
| Assistant | `/assistant` | `web/src/features/assistant/Assistant.tsx` |

## The Dashboard

`web/src/features/dashboard/`. The page that runs on the wall. It has three views, like the pages of a Zabbix dashboard: the problems, the hosts, and the internet traffic meters, which are for a wall screen, an operator or an admin.

### Live list or poll

<!-- gen:snippet web/src/features/dashboard/Overview.tsx#Overview lines=58-96 sha=3f61407d160e -->
`web/src/features/dashboard/Overview.tsx:178-216` (lines 58 to 96 of Overview)

```tsx
// Live problems over SSE. The poll is a safety net for a dropped stream, not a second source of
// truth: at 10 s it would duplicate every SSE tick, so it runs slowly and only while the stream
// has given us nothing. A stream that stays open but goes silent counts as dropped (useSSE's
// watchdog).
const live = useSSE<Problem[]>(streamUrl(), 'problems', STREAM_SILENT_MS, problemListGuard);
// Trust the stream only while it is connected. Keying on `live.data` alone
// stopped the poll for good after the first frame, so a stream that later
// failed left a frozen list on screen with nothing refreshing it.
const streaming = Boolean(live.data) && live.connected;
// Toggling the interval never fetches by itself (useAsync), so the stream
// connecting no longer costs a second full problem list.
const pollQ = useAsync<Problem[]>(() => api.problems(), [], streaming ? undefined : 60_000);
// Falling off the stream fetches at once rather than a full interval later.
const wasStreaming = useRef(streaming);
const { reload } = pollQ;
useEffect(() => {
  if (wasStreaming.current && !streaming) reload();
  wasStreaming.current = streaming;
}, [streaming, reload]);
// Off the stream, show whichever source is newer: the poll's list from page
// load must not replace the stream's last frame.
const fromStream = streaming || (live.updatedAt ?? 0) > (pollQ.updatedAt ?? 0);
const current = fromStream ? live.data : pollQ.data;
const open = useMemo(() => (current ? current.filter(isOpen) : null), [current]);
// Inside a maintenance window: not counted, and not "cleared" when it goes in.
const held = useMemo(
  () => new Set((current ?? []).filter((p) => p.suppressed === '1' && (!p.r_eventid || p.r_eventid === '0')).map((p) => p.eventid)),
  [current],
);
const problems = open ?? [];
// How old the numbers on screen are, whichever source they came from.
const shownAt = fromStream ? live.updatedAt : pollQ.updatedAt;
const late = shownAt !== null && now - shownAt > DATA_LATE_MS;
const lateMinutes = late && shownAt !== null ? Math.floor((now - shownAt) / 60_000) || 1 : null;
// Zabbix itself stopped collecting: the stream stays up and keeps sending, all of it old.
// The age counts on from the last poll's value, so the words stay right between polls.
const collectedAt = freshQ.data?.stale ? freshQ.data.lastCollectedAt : null;
const idleFor = collectedAt !== null ? ageWords(now / 1000 - collectedAt) : null;
const cutOff = reachLost(freshQ.data);
```
<!-- /gen -->

1. The problem list comes from the stream. The poll is a safety net for a dropped stream, and not a second source of truth: at 10 seconds it would duplicate every stream tick, so it runs slowly, every 60 seconds, and only while the stream has given nothing.
2. `streaming` is true only while the stream is connected and has sent a list. Keying the poll on `live.data` alone once stopped it for good after the first frame, so a stream that later failed left a frozen list on screen with nothing refreshing it.
3. Switching the interval never fetches by itself, which is how `useAsync` works, so the stream connecting does not cost a second full list. When the page falls off the stream, it fetches at once rather than a full interval later.
4. Off the stream the page shows whichever source is newer, because the poll's list from page load must not replace the stream's last frame. `shownAt` says how old what is on screen is, whichever source it came from, and the page says "data is late" when it is too old.
5. Every clock on the page is the report zone's, with the zone's name (`formatClockLabeled`, and the big digits of the wall), so a wall in a browser set to another zone shows the time the reports and the Problems page use.
6. The server can be answering while Zabbix has stopped collecting: the stream stays up and keeps sending, all of it old. So the page reads `/api/freshness` too. `idleFor` is how long ago Zabbix last collected, and `cutOff` is true when almost nothing answers ping, which `CollectorNotice` words as "Zabbix cannot reach the network".

### liveRows

`web/src/features/dashboard/liveList.ts`. Which problems the live list shows.

<!-- gen:snippet web/src/features/dashboard/liveList.ts#worstFirst sha=50dddedc1246 -->
`web/src/features/dashboard/liveList.ts:7-10`

```ts
export const worstFirst = (a: Problem, b: Problem) =>
  Number(b.severity) - Number(a.severity) ||
  Number(b.clock) - Number(a.clock) ||
  Number(b.eventid) - Number(a.eventid);
```
<!-- /gen -->

<!-- gen:snippet web/src/features/dashboard/liveList.ts#liveRows sha=08760c3e13dc -->
`web/src/features/dashboard/liveList.ts:19-32`

```ts
export function liveRows(open: Problem[], cleared: Problem[]): Problem[] {
  const openIds = new Set(open.map((p) => p.eventid));
  const gone = cleared.filter((p) => !openIds.has(p.eventid));
  const rows: Problem[] = [];
  let shown = 0;
  for (const p of [...open, ...gone].sort(worstFirst)) {
    if (openIds.has(p.eventid)) {
      if (shown === LIVE_ROWS) break;
      shown++;
    }
    rows.push(p);
  }
  return rows;
}
```
<!-- /gen -->

1. The list shows the worst `LIVE_ROWS` (12) open problems, in severity order and then newest first. The rest are one click away on the Problems page. On a wall there is no scrolling, so the number is fixed.
2. A problem that just cleared stays in its place, marked, for a short highlight, so a glance at the wall still catches what went away. `liveRows` adds those back among the open ones, each in the place its severity and age give it. A cleared problem does not take a row from the open ones: only open problems count toward the twelve.
3. `useChangeHighlight`, in the Problems folder, decides which problems are new and which have cleared. It compares the open list with the previous one, treats the first list only as a baseline, since nothing is new on page load, and ignores problems that move in and out of a maintenance window. It is off for anyone who asked their system for less motion.

### The wall

`web/src/shared/lib/wall.ts`. A wall cannot be scrolled and has nobody to click it, so it turns through its views by itself, and each view must fit one screen.

<!-- gen:snippet web/src/shared/lib/wall.ts#slidesOf sha=229144806fd9 -->
`web/src/shared/lib/wall.ts:25-32`

```ts
export function slidesOf({ views, pages }: { views: readonly DashboardView[]; pages: number }): Slide[] {
  const out: Slide[] = [];
  for (const view of views) {
    if (view === 'internet') for (let page = 0; page < pages; page++) out.push({ view, page });
    else out.push({ view });
  }
  return out.length ? out : [{ view: 'overview' }];
}
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/lib/wall.ts#rotateSeconds sha=57e27810b298 -->
`web/src/shared/lib/wall.ts:43-47`

```ts
export function rotateSeconds(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw.trim())) return ROTATE_DEFAULT;
  const n = Number(raw);
  return n === 0 ? 0 : Math.min(ROTATE_MAX, Math.max(ROTATE_MIN, n));
}
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/lib/wall.ts#internetCard sha=3e5c3c08df70 -->
`web/src/shared/lib/wall.ts:65-83`

```ts
export function internetCard(d: MetersResponse | null | undefined): InternetCard {
  if (!d) return { value: null, sub: '', tone: null };
  if (!d.found) return { value: null, sub: 'No Zabbix dashboard of that name', tone: null };
  if (d.meters.length === 0) return { value: null, sub: 'The dashboard has no gauges', tone: null };
  const s = d.summary;
  const value = d.meters.filter(needsAttention).length;
  const parts = [
    s.down > 0 ? `${s.down} down` : '',
    s.critical > 0 ? `${s.critical} critical` : '',
    s.warn > 0 ? `${s.warn} high` : '',
    s.otherHigh > 0 ? `${s.otherHigh} other direction` : '',
  ].filter(Boolean);
  const sub = parts.length
    ? parts.join(', ')
    : s.current > 0
      ? `None high or critical, of ${s.total}`
      : `${s.total} links, none with a current reading`;
  return { value, sub, tone: s.down > 0 || s.critical > 0 ? 'critical' : value > 0 ? 'warn' : null };
}
```
<!-- /gen -->

1. A slide is a view, and the internet view takes as many slides as its meters need: `wallPages` splits them at `WALL_METERS` (35) to a slide and `wallSlice` splits them evenly, so 40 meters are two pages of 20 and not 35 and 5. `slidesOf` lists the slides in order and is never empty.
2. `rotateSeconds` reads `?rotate=` from the address: 30 seconds when it is absent or not a whole number, 0 to stop turning, and otherwise between 10 and 600. An address that names a view with `?view=` holds it, and a click on a tab or on Pause stops the turning until Resume.
3. `useWallRotation` runs the timer. A different set of slides starts at the first, in the render that sees it, so nothing flashes the wrong one. With one slide, 0 seconds, or while paused, it stands still.
4. `internetCard` makes the Overview's card for the internet links: how many links need a look, and which way. A link needs a look when its interface is down, or it is High or Critical in the gauge's direction or in the other. With no current reading it does not claim all is well.
5. `useFitHeight` and `fitScale`, in the same folder, draw the whole wall at the scale that fits the window, measured again when the lists change, since a wall cannot be scrolled. `useWallMode`, in the shell, reads `?wall=1`, asks the browser for fullscreen on the click that enters wall mode, and follows when Esc ends it.

## The Problems page and the one write

`web/src/features/problems/`. The list of problems with filters, the Explain panel, and the Acknowledge dialog.

<!-- gen:snippet web/src/features/problems/AckDialog.tsx#AckDialog lines=44-67 sha=ff9652e1053b -->
`web/src/features/problems/AckDialog.tsx:70-93` (lines 44 to 67 of AckDialog)

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [onClose, busy]);

const nothingToDo = !acknowledge && !close && !message.trim();

const submit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (nothingToDo) return;
  setBusy(true);
  setError('');
  try {
    await api.acknowledge({
      eventids: [problem.eventid],
      message: message.trim() || undefined,
      acknowledge,
      close,
    });
    onDone({ acknowledge, close });
    if (open.current) onClose();
  } catch (err) {
    if (!open.current) return;
```
<!-- /gen -->

<!-- gen:snippet web/src/features/problems/Problems.tsx#applied sha=45af3a96b768 -->
`web/src/features/problems/Problems.tsx:56-57`

```tsx
const applied = (p: Problem, sent: Sent) =>
  (!sent.acknowledge || p.acknowledged === '1') && (!sent.close || isResolved(p));
```
<!-- /gen -->

1. The dialog is the one place a click changes something in Zabbix, so it confirms and never acts on a single tap, and it does not offer Close for a trigger that does not allow a manual close (`manualClose`). While a request is under way the cross, Cancel and Escape are switched off and a click on the backdrop does nothing, so a refusal cannot arrive at a dialog that has gone (FR-33). Otherwise Escape closes it, and a click on the backdrop closes it unless that would throw away a typed message. The message box takes 1,974 characters, which is Zabbix's 2,048 less the longest tag the server puts in front, so the end of a long note is never cut off unseen.
2. `submit` calls `api.acknowledge` with the event id, the message, and the two flags. If the dialog is closed before Zabbix answers, the page is still told what was sent, but the late answer does not close the dialog of another problem that was opened meanwhile (`open`). On failure the dialog shows the sentence the portal sends back and puts focus back in the message box, since disabling the Confirm button had dropped focus to the page. A refusal by Zabbix, such as a close on a trigger that does not allow it, reaches the dialog in the portal's own words, "Zabbix refused the change. It may already be closed, or this account may not be allowed to change it.", with the reference to quote, and a timeout says that the change may or may not have been made (BK-43). When the web server answered instead of the portal, the dialog says "The portal did not answer (HTTP 502)" and what to check, as the report dialogs do (FR-32).
3. The dialog also asks `/api/freshness`. With no `zabbix-server` collecting, a close is accepted and never applied, so a person is told before sending. A failed check says nothing, so it never gets in the way.
4. Zabbix applies a change a moment after it answers. After a write the server clears the cached answers that the write changes and, for 15 seconds, keeps a new copy of each for only 2 seconds, so the next reads are fresh, though Zabbix itself may still say open for a few seconds. The page keeps what it sent for each problem (`sent`), shows it until the refreshed list says the same (`applied`), and polls every 3 seconds, instead of every 30, while a change is awaited. After `WAIT_FOR_ZABBIX_MS`, a minute, a change that has not shown stops being "waiting": the row says it is late and goes back to offering Ack.
5. The stream's frames leave out what this page also shows, such as the tags and the live value, so they only say that something changed. The full list is then read at once, and the poll stays as the fallback. Filters (severity, acknowledged or not, search, the open Explain panel) live in the address through `useUrlState`, so Back and a shared link restore them.

## The chart

`web/src/features/graphs/TimeSeriesChart.tsx`. A line chart for one to four series from `/api/graph`, drawn by ECharts on a canvas.

<!-- gen:snippet web/src/features/graphs/TimeSeriesChart.tsx#seriesColors sha=fc5c40068586 -->
`web/src/features/graphs/TimeSeriesChart.tsx:64-68`

```tsx
export function seriesColors(): string[] {
  if (typeof window === 'undefined') return [theme.primary];
  const style = getComputedStyle(document.documentElement);
  return SERIES_TOKENS.map((t) => style.getPropertyValue(t).trim() || theme.primary);
}
```
<!-- /gen -->

<!-- gen:snippet web/src/features/graphs/TimeSeriesChart.tsx#TimeSeriesChart lines=30-45 sha=7a64fbfe3e65 -->
`web/src/features/graphs/TimeSeriesChart.tsx:131-146` (lines 30 to 45 of TimeSeriesChart)

```tsx
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
```
<!-- /gen -->

<!-- gen:snippet web/src/features/graphs/TimeSeriesChart.tsx#TimeSeriesChart lines=47-93 sha=7a64fbfe3e65 -->
`web/src/features/graphs/TimeSeriesChart.tsx:148-194` (lines 47 to 93 of TimeSeriesChart)

```tsx
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
```
<!-- /gen -->

1. A canvas cannot resolve a CSS variable, so the colours are read from the stylesheet at render (`seriesColors`, `chartInk`) and the chart is drawn again when the theme changes (`useThemeChange`). Without that, the chart keeps its light axes on a dark page, which is the usual way a canvas gets left out of a theme. `theme.ts` holds the light values as a fallback for a render without a document.
2. Only the parts of ECharts the chart draws are registered, and not the convenience import, which pulls in every chart type and renderer, roughly a megabyte.
3. Up to two unit families get an axis each, such as bits a second on the left and percent on the right (`MAX_UNIT_SCALES`). The picker refuses a third with a sentence, and a chart opened by an address that names three says which line is drawn on the first scale. The ticks of the time axis are the browser's, and their words are the report zone's (`formatAxisTime`), as are the labels of the slider. In a browser outside the report zone, a range that runs over midnight there puts the day on every tick (`axisNeedsDays`), since the tick at that midnight may fall between the browser's own. The x axis is pinned to the window that was asked for, so a sparse item does not stretch its few points across the width.
4. The lines are straight, with no smoothing, and a state, such as ping or an interface status, is a step line. The third and fourth series are dashed (`DASHED_FROM`), a second cue for a reader who cannot tell two of the hues apart (UX-39). A collection gap, which the server marks with a null, breaks the line and never draws across it.
5. A single series read from trends gets a shaded band from its minimum to its maximum. ECharts draws it as two stacked invisible series, a low one and the difference up to the high one, which is why they are named `__low` and `__high` and left out of the legend.
6. A refresh merges new data and keeps the person's zoom, because the chart is not told to replace what it holds. The parent remounts the chart, with a React `key`, when the selection or the range changes. `GraphView`, at the end of the file, fetches, shows the stale note (`StaleNote`) and draws the chart, and the "Show data" table and its CSV (`chartTable`, `chartCsv`) give the same figures as text, which is also what a screen reader reads.

## The gauge

`web/src/features/meters/gaugeDial.ts`. The dial of one internet traffic meter as numbers and words. `Gauge.tsx` draws them, and one drawing unit is about one pixel at the width a tile usually has.

<!-- gen:snippet web/src/features/meters/gaugeDial.ts#dialPoint sha=d6a6f61a4d10 -->
`web/src/features/meters/gaugeDial.ts:26-29`

```ts
export function dialPoint(fraction: number, radius: number): { x: number; y: number } {
  const angle = Math.PI * (1 - fraction);
  return { x: round(DIAL.cx + radius * Math.cos(angle)), y: round(DIAL.cy - radius * Math.sin(angle)) };
}
```
<!-- /gen -->

<!-- gen:snippet web/src/features/meters/gaugeDial.ts#arcPath sha=df618f083470 -->
`web/src/features/meters/gaugeDial.ts:32-36`

```ts
export function arcPath(from: number, to: number, radius: number = DIAL.radius): string {
  const a = dialPoint(from, radius);
  const b = dialPoint(to, radius);
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${b.x} ${b.y}`;
}
```
<!-- /gen -->

<!-- gen:snippet web/src/features/meters/gaugeDial.ts#segments sha=78e012800d44 -->
`web/src/features/meters/gaugeDial.ts:45-52`

```ts
export function segments(zones: MeterZone[], min: number, max: number): Segment[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const at = (v: number) => Math.min(1, Math.max(0, (v - min) / span));
  return zones
    .map((z, i) => ({ from: at(z.from), to: i + 1 < zones.length ? at(zones[i + 1].from) : 1, level: z.level }))
    .filter((s) => s.to > s.from);
}
```
<!-- /gen -->

<!-- gen:snippet web/src/features/meters/gaugeDial.ts#ticks sha=f9e31c64e12c -->
`web/src/features/meters/gaugeDial.ts:63-77`

```ts
export function ticks(zones: MeterZone[], min: number, max: number, units: string): Tick[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const inner = zones
    .map((z) => z.from)
    .filter((v) => v > min && v < max)
    .sort((a, b) => a - b);
  const out: Tick[] = [{ fraction: 0, text: formatAxis(min, units) }];
  for (const v of inner) {
    const f = (v - min) / span;
    if (f - out[out.length - 1].fraction >= TICK_GAP && 1 - f >= TICK_GAP) out.push({ fraction: f, text: formatAxis(v, units) });
  }
  out.push({ fraction: 1, text: formatAxis(max, units) });
  return out;
}
```
<!-- /gen -->

1. A point on the dial is given as a fraction: 0 is the left end of the half circle, 1 the right end and 0.5 the top. `dialPoint` turns a fraction and a radius into x and y, and `arcPath` makes the path of the arc between two fractions, travelling left to right over the top.
2. `segments` turns the zones of the meter, which the server read from the Zabbix widget's thresholds, into stretches of the dial, 0 to 1. A zone outside the scale, or with no width, is left out. The colours are chosen by the page's own palette, since the server sends only what a colour means.
3. `ticks` writes the scale: both ends, and wherever a zone starts, unless that is within `TICK_GAP` of a label already placed, so two labels never run into each other.
4. The same file holds the words under the gauge. `footWords` says why there is no gauge, or the zone and the share of the capacity. A dead link reads 0 like an idle one, so "Interface down, not an idle link" comes before the reading's own words. `otherWords` says the other direction only when it is High or Critical now, since a gauge that counts one direction cannot show it. `historyLink` makes the link to the Graphs page, with the other direction as a second item.

Tests: `gaugeDial.test.ts`, `Gauge.test.tsx` and `InternetMeters.test.tsx`, next to the files.

## The Assistant

`web/src/features/assistant/`. The page behind the sidebar's Assistant, and the Explain panels on the Problems and SLA pages.

<!-- gen:snippet web/src/features/assistant/Assistant.tsx#Assistant lines=50-91 sha=f695221e55db -->
`web/src/features/assistant/Assistant.tsx:128-169` (lines 50 to 91 of Assistant)

```tsx
async function send(text: string) {
  const content = text.trim();
  if (!content || busy) return;

  const next: ChatMessage[] = [...messages, { role: 'user', content }];
  setMessages(next);
  setDraft('');
  setError(null);
  setPending('');
  // Asking is reading the answer: follow it, and keep the cursor where the next question goes.
  atBottom.current = true;
  inputRef.current?.focus();

  const ac = new AbortController();
  abortRef.current = ac;
  let answer = '';
  try {
    await chatStream(
      next.slice(-HISTORY),
      {
        onContext: setContext,
        onToken: (t) => {
          answer += t;
          setPending(answer);
        },
        // The BFF's cleaned-up text (no think block, no sign-off) replaces the stream.
        onDone: (d) => {
          if (typeof d.text === 'string' && d.text) answer = d.text;
        },
      },
      ac.signal,
    );
    setMessages((m) => [...m, { role: 'assistant', content: answer }]);
  } catch (err) {
    // Stopped by the reader: keep what arrived. Failed: keep it too, and say so.
    if (answer) setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err));
  } finally {
    setPending(null);
    abortRef.current = null;
  }
}
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/lib/chatStore.ts#saveConversation sha=3896989f99f8 -->
`web/src/shared/lib/chatStore.ts:24-32`

```ts
export function saveConversation(messages: ChatMessage[]): void {
  if (ended) return;
  try {
    if (messages.length) sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    else sessionStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    /* storage full or blocked: the conversation just won't survive leaving the page */
  }
}
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/lib/chatStore.ts#clearConversation sha=d272cdd741a3 -->
`web/src/shared/lib/chatStore.ts:43-46`

```ts
export function clearConversation(): void {
  ended = true;
  forget();
}
```
<!-- /gen -->

1. `send` adds the person's question to the conversation, clears the box, and starts `chatStream` with the last `HISTORY` turns. Each `token` extends the answer on screen. The server's cleaned text, which has no think block and no sign-off, replaces the stream when the `done` event arrives.
2. A reader who presses Stop, or navigates away, aborts the request, which makes the server stop the model. Navigating away must not leave the model generating for nobody. What had arrived stays in the conversation. A failure keeps it too and says so.
3. The conversation is not kept on a server. The page sends its own history with every question, and keeps it in `sessionStorage`, through `chatStore`, so it survives leaving the page and not closing the tab. `clearConversation` runs when a session ends, by a sign-out, a refused session, or another tab signing out, and keeps `ended` true until the next sign-in. An answer that lands late must not write the conversation back, so `saveConversation` does nothing while `ended` is true.
4. When the page opens it calls `chatWarm`, which loads the local model while the reader is still typing. Until the server has answered `/api/health`, "no model" is not an answer: saying so once sent people to edit `server/.env` for nothing. `useCapabilities`, in `useAi.ts`, is that one health probe shared by every page. A failure is not remembered, since one health check during a restart would hide Explain and Acknowledge for the rest of the session.

### parseInline

`web/src/features/assistant/parseMarkdown.ts`. The Assistant may write only a small slice of markdown: paragraphs, bullet and numbered lists, headings shown as bold paragraphs, `code` and **bold**.

<!-- gen:snippet web/src/features/assistant/parseMarkdown.ts#parseInline sha=d4d5ed5dfca7 -->
`web/src/features/assistant/parseMarkdown.ts:43-75`

```ts
export function parseInline(text: string, allowBold = true): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i + 1) {
        flush();
        out.push({ type: 'code', text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (allowBold && text.startsWith('**', i)) {
      const close = text.indexOf('**', i + 2);
      if (close > i + 2) {
        flush();
        out.push({ type: 'bold', children: parseInline(text.slice(i + 2, close), false) });
        i = close + 2;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}
```
<!-- /gen -->

1. The parser is narrow on purpose and has no HTML and no links. Every leaf is plain text that React escapes, so what a model writes can never become markup. `Markdown.tsx` draws the blocks as `p`, `ul`, `ol`, `strong` and `code` elements and nothing else.
2. An inline marker counts only when it has a closing partner. A half-streamed answer, such as `**11.1 FG-60` with no closing stars, stays readable text and does not flicker bold while it arrives.
3. A backtick with a closing partner opens a code span, whose content is literal. Two stars with a closing partner open bold, whose content may hold code spans but not more bold.

Tests: `web/scripts/markdown.check.ts` is one of the eleven checkers. It holds the parser's cases and runs in `npm run check`.

## The other pages

- Network and Sites: `Sites.tsx` lists each site with its hosts and problems. `Network.tsx` shows the devices grouped by site, with their interfaces in pages, and `Links.tsx` the ping links and the redundant paths. `Maps.tsx` draws Zabbix's own maps.
- Hosts: `Hosts.tsx` is the host list with its state and problems, `Devices.tsx` the same hosts as devices of one kind, and `LatestData.tsx` the latest values, paged on the server.
- SLA: `Sla.tsx` and `Sli.tsx` show the derived monthly SLA and its two methods, `Services.tsx` the service tree, and `Availability.tsx` the availability report. The three download buttons (PDF, Excel and CSV zip) are `ReportDownload.tsx`, the style button is `ReportStyleButton.tsx`, and an administrator also gets the Email report and Schedule dialogs (`EmailReport.tsx` and `ReportSchedule.tsx`), and `percent.ts` prints a percentage without rounding a miss up to the target.
- Reports: `Capacity.tsx`, `AlertNoise.tsx`, `TopTriggers.tsx` and `Inventory.tsx`, the last for admins only. Each has its filters in the address and each uses `Async` for its states.
- Auth: `Login.tsx` is the sign-in page. It keeps `next` as a safe path, never an address on another site, so a sign-in returns to the page it came from.
- Shell: `Sidebar.tsx`, `Layout.tsx` and the rest are in [the shell chapter](web-shell-and-shared.md).
