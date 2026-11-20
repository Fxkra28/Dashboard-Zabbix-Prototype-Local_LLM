import { useId } from 'react';
import { Field, FieldGroup } from '../../shared/components/Field';
import { serverNow } from '../../shared/lib/clock';
import { monthLabel, recentMonths } from '../../shared/lib/time';
import {
  offeredYears,
  RANGE_MODES,
  RANGE_MODE_LABEL,
  WEEKDAY_NAMES,
  type HoursChoice,
  type RangeChoice,
  type RangeMode,
} from './rangeWindow';

/**
 * The controls of the SLA page's range view: a day, a month, a year or two hours of the report's zone, then the hours of the day and the days of the week that
 * count. They hold no state of their own: the page keeps it in the address, and this draws it and says what was changed.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function RangeControls({
  choice,
  onChoice,
  hours,
  onHours,
  zone,
}: {
  choice: RangeChoice;
  onChoice: (change: Partial<RangeChoice>) => void;
  hours: HoursChoice;
  onHours: (change: Partial<HoursChoice>) => void;
  zone: string;
}) {
  const id = useId();
  // Worked out each time they are drawn, not kept for the zone: a page left open across the first of a month, or the day a year passes out of reach, must offer what is true then (FR-67).
  const months = recentMonths(12, zone);
  // A year is offered while the server can still answer for its first day.
  const years = offeredYears(Math.floor(serverNow() / 1000), zone);
  // No days chosen is every day, so the boxes all read as ticked; unticking one starts from all seven, and the last one left cannot be unticked.
  const toggleDay = (day: number, on: boolean) => {
    const now = hours.days.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : hours.days;
    const next = (on ? [...new Set([...now, day])] : now.filter((d) => d !== day)).sort((a, b) => a - b);
    if (next.length > 0) onHours({ days: next.length === 7 ? [] : next });
  };

  return (
    <>
      <FieldGroup label="Range">
        <div className="seg" role="group" aria-label="Range">
          {RANGE_MODES.map((m: RangeMode) => (
            <button key={m} type="button" className={choice.mode === m ? 'on' : ''} aria-pressed={choice.mode === m} onClick={() => onChoice({ mode: m })}>
              {RANGE_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </FieldGroup>

      {choice.mode === 'day' && (
        <Field label={`Day (${zone})`} htmlFor={`${id}-day`}>
          <input id={`${id}-day`} name="range-day" type="date" value={choice.day} onChange={(e) => onChoice({ day: e.target.value })} />
        </Field>
      )}
      {choice.mode === 'month' && (
        <Field label="Month" htmlFor={`${id}-month`}>
          <select id={`${id}-month`} name="range-month" value={choice.month} onChange={(e) => onChoice({ month: e.target.value })}>
            {months.includes(choice.month) ? null : <option value={choice.month}>{choice.month}</option>}
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {choice.mode === 'year' && (
        <Field label="Year" htmlFor={`${id}-year`}>
          <select id={`${id}-year`} name="range-year" value={choice.year} onChange={(e) => onChoice({ year: Number(e.target.value) })}>
            {years.includes(choice.year) ? null : <option value={choice.year}>{choice.year}</option>}
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      )}
      {choice.mode === 'custom' && (
        <>
          <Field label={`From (${zone})`} htmlFor={`${id}-from`}>
            <input id={`${id}-from`} name="range-from" type="date" value={choice.fromDate} onChange={(e) => onChoice({ fromDate: e.target.value })} />
          </Field>
          <Field label="From hour" htmlFor={`${id}-from-hour`}>
            <select id={`${id}-from-hour`} name="range-from-hour" value={choice.fromHour} onChange={(e) => onChoice({ fromHour: Number(e.target.value) })}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`To (${zone})`} htmlFor={`${id}-to`}>
            <input id={`${id}-to`} name="range-to" type="date" value={choice.toDate} onChange={(e) => onChoice({ toDate: e.target.value })} />
          </Field>
          <Field label="To hour" htmlFor={`${id}-to-hour`}>
            <select id={`${id}-to-hour`} name="range-to-hour" value={choice.toHour} onChange={(e) => onChoice({ toHour: Number(e.target.value) })}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <Field label="Count from" htmlFor={`${id}-start`}>
        <select id={`${id}-start`} name="hours-start" value={hours.start} onChange={(e) => onHours({ start: Number(e.target.value) })}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {hh(h)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Count until" htmlFor={`${id}-end`}>
        <select id={`${id}-end`} name="hours-end" value={hours.end} onChange={(e) => onHours({ end: Number(e.target.value) })}>
          {HOURS.map((h) => h + 1).map((h) => (
            <option key={h} value={h}>
              {hh(h)}
              {h <= hours.start ? ' (next morning)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="field weekdays" role="group" aria-label="Days of the week">
        <span className="field-label">Days of the week</span>
        {WEEKDAY_NAMES.map((name, i) => (
          <label key={name} className="check">
            <input type="checkbox" name={`day-${i + 1}`} checked={hours.days.length === 0 || hours.days.includes(i + 1)} onChange={(e) => toggleDay(i + 1, e.target.checked)} />
            <span>{name.slice(0, 3)}</span>
          </label>
        ))}
      </div>
    </>
  );
}
