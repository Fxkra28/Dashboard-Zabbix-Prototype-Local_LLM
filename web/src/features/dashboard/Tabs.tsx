import { useRef } from 'react';

/**
 * The ARIA tabs pattern, as the SLA page does it (one tab stop, arrow keys with Home and End, a panel the selected tab controls).
 * This draws only the list: the caller gives the panel `id={tabsPanelId(id)}` and `aria-labelledby={tabButtonId(id, key)}`.
 */
export const tabButtonId = (id: string, key: string) => `${id}-tab-${key}`;
export const tabsPanelId = (id: string) => `${id}-panel`;

export function Tabs<K extends string>({
  id,
  label,
  tabs,
  value,
  onChange,
  className = '',
}: {
  /** Unique on the page: it names the buttons and the panel. */
  id: string;
  /** What the list is for, as a screen reader says it. */
  label: string;
  tabs: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeys = (e: React.KeyboardEvent) => {
    const at = Math.max(0, tabs.findIndex((t) => t.key === value));
    const to =
      e.key === 'ArrowRight' ? (at + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    onChange(tabs[to].key);
    buttons.current[tabs[to].key]?.focus();
  };

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs inside hold the focus; the list only hears the arrow keys
    <div className={`seg tabs ${className}`.trim()} role="tablist" aria-label={label} onKeyDown={onKeys}>
      {tabs.map((t) => (
        <button
          key={t.key}
          ref={(el) => {
            buttons.current[t.key] = el;
          }}
          id={tabButtonId(id, t.key)}
          role="tab"
          type="button"
          aria-selected={value === t.key}
          aria-controls={tabsPanelId(id)}
          tabIndex={value === t.key ? 0 : -1}
          className={value === t.key ? 'on' : ''}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
