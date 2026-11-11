import { useMemo, useState } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { ZMap, MapDetail, MapSelement } from '../../types';
import { Async, ErrorState, Loaded, Loading } from '../../shared/components/states';
import { Field } from '../../shared/components/Field';
import { severity } from '../../shared/lib/severity';
import { clipLine, placeLabels } from './mapLabels';
import { count } from '../../shared/lib/plural';

const ELEMENT_LABEL: Record<string, string> = {
  '0': 'Host',
  '1': 'Map',
  '2': 'Trigger',
  '3': 'Host group',
  '4': 'Image',
};

const OK = 'var(--good)';
const NEUTRAL = 'var(--muted)';

/** Host elements: green when clear, else the colour of their worst open problem. */
function elementColor(s: MapSelement): string {
  if (s.elementtype !== '0') return NEUTRAL;
  if (!s.problems) return OK;
  return severity(s.maxSeverity ?? 0).color;
}

/** "1.1 ALPHA-FW01 (198.18.0.42)" reads better as a name line and an address line. */
function labelLines(s: MapSelement): string[] {
  const text = s.labelText ?? s.label?.replace(/\{.*?\}/g, '').trim() ?? '';
  const lines = text
    .split('\n')
    .flatMap((line) => {
      const m = line.match(/^(.+?)\s*(\([^()]*\))$/);
      return m ? [m[1], m[2]] : [line];
    })
    .filter(Boolean);
  // An unlabelled image (HCML's hub icons) stays unlabelled, as Zabbix draws it.
  if (lines.length || s.elementtype === '4') return lines;
  return [ELEMENT_LABEL[s.elementtype] ?? ''];
}

// Monitoring → Maps: list Zabbix maps and render the selected map's topology.
export default function Maps() {
  const listQ = useAsync<ZMap[]>(() => api.maps(), []);
  // The map lives in the URL, so a link or Back returns to the same one. An id that is not in the list reads as the first map.
  const [chosen, setMapid] = useUrlState<string>('map', '');
  const maps = listQ.data ?? [];
  const mapid = maps.some((m) => m.sysmapid === chosen) ? chosen : (maps[0]?.sysmapid ?? '');

  const detailQ = useAsync<MapDetail[]>(
    () => (mapid ? api.mapDetail(mapid) : Promise.resolve([])),
    [mapid],
    30_000,
  );
  const map = detailQ.data?.[0];

  return (
    <>
      <div className="controls">
        <Field label="Map" htmlFor="map-select">
          <select id="map-select" value={mapid} onChange={(e) => setMapid(e.target.value)}>
            {(listQ.data ?? []).map((m) => (
              <option key={m.sysmapid} value={m.sysmapid}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="panel">
        <Async
          loading={listQ.loading}
          error={listQ.error}
          data={listQ.data}
          updatedAt={listQ.updatedAt}
          loadingLabel="Loading maps…"
        >
          {(list) =>
            !list.length ? (
              <div className="state">
                No maps defined in Zabbix.
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Create one under Monitoring → Maps in the Zabbix UI; it appears here automatically.
                </div>
              </div>
            ) : detailQ.error && (!map || detailQ.stale) ? (
              <ErrorState message={`Could not load this map: ${detailQ.error}`} />
            ) : detailQ.loading && !map ? (
              <Loading label="Loading topology…" />
            ) : map ? (
              // The previous map stays, dimmed, while another loads; a failed refresh keeps it with a note.
              <Loaded stale={detailQ.stale} error={detailQ.error} updatedAt={detailQ.updatedAt}>
                <MapCanvas key={map.sysmapid} map={map} />
              </Loaded>
            ) : (
              <div className="state">Select a map.</div>
            )
          }
        </Async>
      </div>
    </>
  );
}

function MapCanvas({ map }: { map: MapDetail }) {
  const w = Number(map.width) || 800;
  const h = Number(map.height) || 400;
  const byId: Record<string, MapSelement> = {};
  for (const s of map.selements ?? []) byId[s.selementid] = s;

  const hostEls = (map.selements ?? []).filter((s) => s.elementtype === '0');
  const withProblems = hostEls.filter((s) => s.problems).length;
  // A host chosen on the canvas: its severity is printed in words under the map, since the node says it by colour only.
  const [chosen, setChosen] = useState<string | null>(null);
  const toggle = (id: string) => setChosen((now) => (now === id ? null : id));

  // Where each name goes so that none overlaps another or an element. Worst problem first.
  const placements = useMemo(
    () =>
      placeLabels(
        (map.selements ?? []).map((s) => ({
          id: s.selementid,
          x: Number(s.x),
          y: Number(s.y),
          lines: labelLines(s),
          rank: s.elementtype === '0' && s.problems ? 1 + (s.maxSeverity ?? 0) : 0,
          badge: s.elementtype === '0' && Boolean(s.problems),
        })),
      ),
    [map.selements],
  );
  // The names left out are listed in the caption: pointing is the only other way to read one, and a keyboard or a touch screen cannot point.
  const leftOut = (map.selements ?? []).flatMap((s) => (placements.get(s.selementid)?.hidden ? [labelLines(s)[0]] : []));

  return (
    <div style={{ overflow: 'auto' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{
          width: '100%',
          maxWidth: w,
          overflow: 'visible',
          border: '1px solid var(--border)',
          borderRadius: 10,
          background: 'var(--surface)',
        }}
      >
        {(map.links ?? []).map((l) => {
          const a = byId[l.selementid1];
          const b = byId[l.selementid2];
          if (!a || !b) return null;
          return (
            <line
              key={l.linkid}
              x1={Number(a.x) + 24}
              y1={Number(a.y) + 16}
              x2={Number(b.x) + 24}
              y2={Number(b.y) + 16}
              style={{ stroke: l.color ? `#${l.color}` : 'var(--border-strong)' }}
              strokeOpacity={0.7}
              strokeWidth={1.5}
            />
          );
        })}
        {(map.selements ?? []).map((s) => {
          const color = elementColor(s);
          const lines = labelLines(s);
          const isHost = s.elementtype === '0';
          const problemsWords = s.problems
            ? `${s.problems} open problem${s.problems === 1 ? '' : 's'}, worst: ${severity(s.maxSeverity ?? 0).name}`
            : 'no open problems';
          const what = lines.join(' ') + (isHost ? `, ${problemsWords}` : '');
          return (
            // The label also names the element for a screen reader, which is told every name, drawn or not.
            // A host is a button that prints its severity under the map; the other elements stay pictures.
            <g
              key={s.selementid}
              className={isHost ? 'map-node' : undefined}
              transform={`translate(${Number(s.x)}, ${Number(s.y)})`}
              role={isHost ? 'button' : 'img'}
              aria-label={what}
              aria-pressed={isHost ? chosen === s.selementid : undefined}
              tabIndex={isHost ? 0 : undefined}
              onClick={isHost ? () => toggle(s.selementid) : undefined}
              onKeyDown={
                isHost
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle(s.selementid);
                      }
                    }
                  : undefined
              }
            >
              <title>{what}</title>
              <rect
                width={48}
                height={32}
                rx={6}
                style={{ fill: color, stroke: color }}
                fillOpacity={0.14}
                strokeWidth={s.problems || chosen === s.selementid ? 2 : 1}
              />
              <circle cx={24} cy={16} r={5} style={{ fill: color }} />
              {isHost && s.problems ? (
                <g transform="translate(46, 0)">
                  <circle r={8} style={{ fill: color, stroke: 'var(--surface)' }} strokeWidth={1.5} />
                  <text
                    y={3.5}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={700}
                    style={{ fill: 'var(--on-severity)' }}
                  >
                    {s.problems > 99 ? '99+' : s.problems}
                  </text>
                </g>
              ) : null}
              {!placements.get(s.selementid)?.hidden &&
                lines.slice(0, 2).map((line, i) => (
                  <text
                    key={i}
                    x={24}
                    y={46 + i * 12 + (placements.get(s.selementid)?.dy ?? 0)}
                    textAnchor="middle"
                    fontSize={i === 0 ? 11 : 10}
                    style={{ fill: i === 0 ? 'var(--text)' : 'var(--muted)' }}
                  >
                    {clipLine(line)}
                  </text>
                ))}
            </g>
          );
        })}
      </svg>
      {chosen && (
        <p className="map-selected" role="status">
          {(() => {
            const s = byId[chosen];
            if (!s) return null;
            const level = s.maxSeverity ?? 0;
            return (
              <>
                <strong>{labelLines(s)[0]}</strong>:{' '}
                {s.problems ? (
                  <>
                    {s.problems} open problem{s.problems === 1 ? '' : 's'}, worst:{' '}
                    <span style={{ color: severity(level).color }} aria-hidden="true">
                      ●
                    </span>{' '}
                    {severity(level).name}
                  </>
                ) : (
                  'no open problems'
                )}
              </>
            );
          })()}
        </p>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>
          {count(map.selements?.length ?? 0, 'element')} · {count(map.links?.length ?? 0, 'link')} ·{' '}
          {withProblems} of {hostEls.length} hosts with open problems · drawn from the Zabbix map
          {leftOut.length > 0 && ` · ${leftOut.length} name${leftOut.length === 1 ? '' : 's'} left out where crowded: ${leftOut.join(', ')}`}
        </span>
        <span>
          <span style={{ color: OK }} aria-hidden="true">●</span> no problems
          {[5, 4, 3, 2, 1, 0].map((level) => (
            <span key={level}>
              {' · '}
              <span style={{ color: severity(level).color }} aria-hidden="true">●</span>{' '}
              {severity(level).name.toLowerCase()}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
