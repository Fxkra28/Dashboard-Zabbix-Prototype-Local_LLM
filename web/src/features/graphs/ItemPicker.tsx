import { useEffect, useMemo, useState } from 'react';
import { api, onSessionChange } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import type { Item } from '../../types';
import { naturalCompare } from '../../shared/lib/sites';
import { Loading, ErrorState } from '../../shared/components/states';
import { MAX_UNIT_SCALES, unitFamilies } from './unitScales';

/** Most rows rendered at once: a core switch has ~1,200 graphable items. */
const RENDER_CAP = 200;

/**
 * A host's item list, kept for five minutes: re-downloading it on every switch back to a host (or
 * return to Graphs) is hundreds of kB. Only finished lists are kept: a request that was aborted or
 * failed must not be handed to the next caller.
 */
const ITEMS_TTL_MS = 5 * 60_000;
const itemsCache = new Map<string, { at: number; items: Item[] }>();
// The server cuts the list by role, so a list kept for one person is not for the next to sign in on this tab.
onSessionChange(() => itemsCache.clear());

async function graphableItems(hostid: string): Promise<Item[]> {
  const key = `${hostid}|graphable`;
  const hit = itemsCache.get(key);
  if (hit && Date.now() - hit.at < ITEMS_TTL_MS) return hit.items;
  const items = await api.items(hostid, undefined, { graphable: true });
  itemsCache.set(key, { at: Date.now(), items });
  return items;
}

interface Group {
  label: string;
  items: Item[];
  /** in + out of one interface, offered as one "Traffic in + out" choice. */
  traffic?: [string, string];
}

/** `Interface Gi1/0/1(alias): Bits sent` → "Gi1/0/1 (alias)". */
function interfaceLabel(name: string): string | null {
  const m = /^Interface\s+([^(]+?)\s*\((.*)\):\s/.exec(name);
  if (m) return m[2].trim() ? `${m[1].trim()} (${m[2].trim()})` : m[1].trim();
  const plain = /^Interface\s+(.+?):\s/.exec(name);
  return plain ? plain[1].trim() : null;
}

function groupOf(item: Item): string {
  if (item.key_.startsWith('net.if.')) {
    const label = interfaceLabel(item.name);
    if (label) return `Interface ${label}`;
  }
  const component = item.tags?.find((t) => t.tag === 'component')?.value;
  if (component) return component.charAt(0).toUpperCase() + component.slice(1);
  return 'Other';
}

function buildGroups(items: Item[]): Group[] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const g = groupOf(it);
    (map.get(g) ?? map.set(g, []).get(g)!).push(it);
  }
  const groups = [...map.entries()].map<Group>(([label, list]) => {
    list.sort((a, b) => naturalCompare(a.name, b.name));
    const inItem = list.find((i) => /^net\.if\.in\[[^\]]*\.\d+\]$/.test(i.key_));
    const outItem = list.find((i) => /^net\.if\.out\[[^\]]*\.\d+\]$/.test(i.key_));
    const idx = (k: string) => /\.(\d+)\]$/.exec(k)?.[1];
    return {
      label,
      items: list,
      traffic: inItem && outItem && idx(inItem.key_) === idx(outItem.key_) ? [inItem.itemid, outItem.itemid] : undefined,
    };
  });
  // Named components first, interfaces next, Other last: each naturally sorted.
  const rank = (g: Group) => (g.label === 'Other' ? 2 : g.label.startsWith('Interface ') ? 1 : 0);
  return groups.sort((a, b) => rank(a) - rank(b) || naturalCompare(a.label, b.label));
}

/**
 * Searchable, grouped picker for up to `max` graphable items of one host.
 * Filters on every word (name, key, group), renders at most 200 matches.
 */
export default function ItemPicker({
  hostid,
  selected,
  onChange,
  onItems,
  max = 4,
}: {
  hostid: string;
  selected: string[];
  onChange: (itemids: string[]) => void;
  /** Called once the host's items have loaded (for defaults and labels). */
  onItems?: (items: Item[]) => void;
  max?: number;
}) {
  const q = useAsync<Item[]>(() => (hostid ? graphableItems(hostid) : Promise.resolve([])), [hostid]);
  const [search, setSearch] = useState('');
  useEffect(() => setSearch(''), [hostid]);
  // Why the last item was not added, until something is added or removed.
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => setRefusal(null), [hostid]);
  // Only this host's items: while another host loads, or after it failed, the
  // list in hand is the previous host's and would reset the selection wrongly.
  useEffect(() => {
    if (q.data && !q.loading && !q.stale) onItems?.(q.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, q.loading, q.stale]);

  const groups = useMemo(() => buildGroups(q.data ?? []), [q.data]);
  const byId = useMemo(() => new Map((q.data ?? []).map((i) => [i.itemid, i])), [q.data]);

  const { visible, matches } = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    let count = 0;
    const out: Group[] = [];
    for (const g of groups) {
      const glabel = g.label.toLowerCase();
      const items = words.length
        ? g.items.filter((i) => {
            const hay = `${i.name} ${i.key_} ${glabel}`.toLowerCase();
            return words.every((w) => hay.includes(w));
          })
        : g.items;
      if (!items.length) continue;
      const room = RENDER_CAP - count;
      count += items.length;
      const traffic =
        g.traffic && (!words.length || g.traffic.every((id) => items.some((i) => i.itemid === id)))
          ? g.traffic
          : undefined;
      if (room > 0) out.push({ ...g, items: items.slice(0, room), traffic });
    }
    return { visible: out, matches: count };
  }, [groups, search]);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      setRefusal(null);
      onChange(selected.filter((s) => s !== id));
      return;
    }
    const next = [...selected, id].slice(-max);
    // A third kind of unit has no scale to be drawn on (it would be plotted flat on the first one).
    if (unitFamilies(next.map((i) => byId.get(i)?.units)).length > MAX_UNIT_SCALES) {
      const held = unitFamilies(selected.map((i) => byId.get(i)?.units)).map((u) => u || 'no unit');
      setRefusal(`A graph shows two kinds of unit at most, and this one already has ${held.join(' and ')}. Remove one to add ${byId.get(id)?.name ?? 'this item'}.`);
      return;
    }
    setRefusal(null);
    onChange(next);
  };

  // A failed load for this host replaces the list; a failed reload keeps it.
  if (q.error && (!q.data || q.stale)) return <ErrorState message={q.error} />;

  return (
    <div className="item-picker">
      <div className="item-picker-selected">
        {selected.length ? (
          selected.map((id) => {
            const name = byId.get(id)?.name ?? `item ${id}`;
            return (
              <span key={id} className="chip">
                <span className="chip-text" title={name}>
                  {name}
                </span>
                <button type="button" aria-label={`Remove ${name}`} onClick={() => toggle(id)}>
                  ×
                </button>
              </span>
            );
          })
        ) : (
          <span className="muted">Pick up to {max} items</span>
        )}
      </div>
      {refusal && (
        <div className="notice warn" role="status">
          {refusal}
        </div>
      )}
      <input
        name="item-search"
        type="text"
        aria-label="Search items"
        placeholder={`Search ${q.data?.length ?? ''} items… (e.g. Gi1/0/1 bits)`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const first = visible[0]?.items[0];
            if (first) toggle(first.itemid);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            (e.currentTarget.parentElement?.querySelector('.item-picker-list button') as HTMLElement | null)?.focus();
          }
        }}
      />
      {q.loading && !q.data ? (
        <Loading label="Loading items…" />
      ) : !q.data?.length ? (
        <div className="state">This host has no graphable (numeric, supported) items.</div>
      ) : (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- arrow keys move between the buttons inside, which are the controls
        <div
          // The previous host's list, dimmed and inert until this host's arrives.
          className={`item-picker-list${q.stale ? ' stale' : ''}`}
          aria-busy={q.stale || undefined}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            const buttons = [...e.currentTarget.querySelectorAll('button')];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = buttons[i + (e.key === 'ArrowDown' ? 1 : -1)];
            if (next) {
              e.preventDefault();
              next.focus();
            }
          }}
        >
          {visible.map((g) => (
            <div key={g.label} className="item-group">
              <div className="item-group-label">{g.label}</div>
              {g.traffic && (
                <button
                  type="button"
                  className={`item-row composite${
                    g.traffic.every((id) => selected.includes(id)) && selected.length === 2 ? ' on' : ''
                  }`}
                  aria-pressed={g.traffic.every((id) => selected.includes(id)) && selected.length === 2}
                  onClick={() => {
                    setRefusal(null); // it replaces the whole selection, so what was refused before no longer applies
                    onChange([...g.traffic!]);
                  }}
                >
                  <span className="item-name">Traffic in + out</span>
                  <span className="item-units">bps</span>
                </button>
              )}
              {g.items.map((i) => (
                <button
                  key={i.itemid}
                  type="button"
                  className={`item-row${selected.includes(i.itemid) ? ' on' : ''}`}
                  aria-pressed={selected.includes(i.itemid)}
                  onClick={() => toggle(i.itemid)}
                  title={i.key_}
                >
                  <span className="item-name">
                    {g.label.startsWith('Interface ') ? i.name.replace(/^Interface [^:]+:\s*/, '') : i.name}
                  </span>
                  {i.units && <span className="item-units">{i.units}</span>}
                </button>
              ))}
            </div>
          ))}
          {matches === 0 && <div className="state">No items match “{search}”.</div>}
          {matches > RENDER_CAP && (
            <div className="item-picker-more muted">
              Showing {RENDER_CAP} of {matches} matches. Refine the search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
