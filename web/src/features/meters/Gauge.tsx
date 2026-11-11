import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { Meter } from '../../types';
import { DIAL, arcPath, dialPoint, footWords, hasDial, headline, historyLink, otherWords, segments, ticks, valueWords } from './gaugeDial';

/**
 * One internet traffic meter, the dial of HCML's Zabbix gauge widget in the portal's palette. Colour is never the only word: the value,
 * zone and share are text, and a screen reader gets role="meter" in place of the dial. A link that is down says Down and loses its needle.
 */
export default function Gauge({ meter: m, now }: { meter: Meter; now: number }) {
  const titleId = useId();
  const noteId = useId();
  const linkNoteId = useId();
  const history = historyLink(m);
  const dial = hasDial(m);
  const max = m.max ?? 0;
  const segs = dial ? segments(m.zones, m.min, max) : [];
  const marks = dial ? ticks(m.zones, m.min, max, m.units) : [];
  const down = m.link === 'down';
  const pointing = dial && !down && m.fraction !== null && (m.state === 'ok' || m.state === 'stale');
  const tip = pointing ? dialPoint(m.fraction ?? 0, DIAL.radius - 1) : null;
  const where = m.host && m.item ? `${m.item} on ${m.host}` : (m.item ?? '');
  const reading = (m.state === 'ok' || m.state === 'stale') && !down;
  const text = <span className="meter-value">{headline(m)}</span>;
  const other = otherWords(m);

  return (
    <div
      className={`meter meter-${m.state}${down ? ' meter-down' : ''}${m.zone && m.state === 'ok' && !down ? ` zone-${m.zone}` : ''}${other ? ` flag-${m.other?.zone}` : ''}`}
    >
      <div className="meter-head">
        <p className="meter-title" id={titleId} title={where ? `${m.title}\n${where}` : m.title}>
          {history ? (
            <Link to={history} className="meter-link" aria-describedby={linkNoteId}>
              {m.title}
            </Link>
          ) : (
            m.title
          )}
        </p>
        {m.direction && (
          <span className="meter-dir" title={m.direction === 'in' ? 'Traffic received on the interface' : 'Traffic sent from the interface'}>
            {m.direction === 'in' ? 'In' : 'Out'}
          </span>
        )}
      </div>

      {dial || m.state === 'invalid' ? (
        <div
          className="meter-dial"
          // A meter has a value to give. A gauge with none is a plain block of text.
          {...(reading && m.value !== null
            ? {
                role: 'meter',
                'aria-labelledby': titleId,
                'aria-describedby': noteId,
                'aria-valuemin': m.min,
                'aria-valuemax': m.max ?? undefined,
                'aria-valuenow': m.value,
                'aria-valuetext': m.state === 'stale' ? `${valueWords(m)}, an old reading` : valueWords(m),
              }
            : {})}
        >
          {dial && (
            <svg className="gauge-svg" viewBox={`0 0 ${DIAL.width} ${DIAL.height}`} aria-hidden="true" focusable="false">
              <path className="gauge-frame" d={arcPath(0, 1)} strokeWidth={DIAL.frame} />
              {segs.map((s) => (
                <path key={`${s.from}-${s.level}`} className={`gauge-zone ${s.level}`} d={arcPath(s.from, s.to)} strokeWidth={DIAL.band} />
              ))}
              {segs.slice(1).map((s) => {
                const a = dialPoint(s.from, DIAL.radius - DIAL.band / 2);
                const b = dialPoint(s.from, DIAL.radius + DIAL.band / 2);
                return <line key={`gap-${s.from}`} className="gauge-gap" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
              })}
              {marks.map((t) => {
                const end = t.fraction === 0 || t.fraction === 1;
                const p = end
                  ? { x: dialPoint(t.fraction, DIAL.radius).x, y: DIAL.cy + 17 }
                  : dialPoint(t.fraction, DIAL.radius + DIAL.frame / 2 + 5);
                const anchor = end ? 'middle' : t.fraction < 0.4 ? 'end' : t.fraction > 0.6 ? 'start' : 'middle';
                const y = end ? p.y : t.fraction >= 0.4 && t.fraction <= 0.6 ? p.y - 2 : p.y + 3;
                return (
                  <text key={t.fraction} className="gauge-tick" x={p.x} y={y} textAnchor={anchor} fontSize={11}>
                    {t.text}
                  </text>
                );
              })}
              {tip && (
                <>
                  <line className="gauge-needle" x1={DIAL.cx} y1={DIAL.cy} x2={tip.x} y2={tip.y} />
                  <circle className="gauge-hub" cx={DIAL.cx} cy={DIAL.cy} r={5} />
                </>
              )}
            </svg>
          )}
          {text}
        </div>
      ) : (
        <div className="meter-dial meter-plain">{text}</div>
      )}

      {other && <p className={`meter-other other-${m.other?.zone}`}>{other}</p>}
      <p className="meter-foot">{footWords(m, now)}</p>
      {history && (
        <span className="sr-only" id={linkNoteId}>
          Opens the history of this link in Graphs
        </span>
      )}
      {/* What the meter measures, for whoever reads it with a screen reader; the sighted get it on hover. */}
      <span className="sr-only" id={noteId}>
        {where || m.title}
      </span>
    </div>
  );
}
