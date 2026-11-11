import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useSearchPatch } from '../../shared/hooks/useUrlState';
import type { Host, Item } from '../../types';
import { GraphView } from './TimeSeriesChart';
import ItemPicker from './ItemPicker';
import RangePicker, { useUrlRange } from './RangePicker';
import { Empty, ErrorState, Loading } from '../../shared/components/states';
import { Field, FieldGroup } from '../../shared/components/Field';
import { groupBySite } from '../../shared/lib/sites';

const MAX_ITEMS = 4;

/** Items to show when a host is opened without a selection: its ping latency, else the first item. */
function defaultItems(items: Item[]): string[] {
  const preferred = items.find((i) => i.key_ === 'icmppingsec') ?? items.find((i) => i.key_.startsWith('icmpping'));
  const first = preferred ?? items[0];
  return first ? [first.itemid] : [];
}

/** Why items named in the address are not on the graph: one sentence for each reason. */
function leftOutWords(ids: string[], why: 'elsewhere' | 'missing' | 'unread'): string {
  const one = ids.length === 1;
  const names = `${one ? 'Item' : 'Items'} ${ids.join(', ')}`;
  const left = `so ${one ? 'it was' : 'they were'} left out.`;
  if (why === 'elsewhere') return `${names} ${one ? 'is not a graphable item' : 'are not graphable items'} of this host, ${left}`;
  if (why === 'missing') return `${names} ${one ? 'was' : 'were'} not found, ${left}`;
  return `${names} could not be looked up, ${left}`;
}

/**
 * Graphs: one host, up to four of its items, any range.
 * URL: /graphs?hostid=10668&itemid=69356,69710&range=7d  (or month= / from=&to=)
 */
export default function HostDetail() {
  const hostsQ = useAsync<Host[]>(() => api.hosts(), []);
  const [params] = useSearchParams();
  const [range, setRange] = useUrlRange(24);

  const hostid = params.get('hostid') ?? '';
  const itemParam = params.get('itemid') ?? '';
  const itemids = useMemo(
    () => itemParam.split(',').filter((s) => /^\d+$/.test(s)).slice(0, MAX_ITEMS),
    [itemParam],
  );

  const update = useSearchPatch();
  // Items the address named and the page left out, until the person chooses items or a host themselves.
  const [leftOut, setLeftOut] = useState<string[]>([]);

  const groups = useMemo(
    () => groupBySite(hostsQ.data ?? [], (h) => h.name, (h) => h.site),
    [hostsQ.data],
  );
  const host = hostsQ.data?.find((h) => h.hostid === hostid);
  // Without a host list no host can be chosen, so say so rather than wait for ever.
  const hostsFailed = hostsQ.error !== null && hostsQ.data == null;
  const hostsEmpty = !hostsQ.loading && !hostsFailed && groups.length === 0;

  // A deep link with items but no host: find the host from the first item.
  const resolving = useRef(false);
  useEffect(() => {
    if (hostid || !itemids.length || resolving.current) return;
    resolving.current = true;
    // No host to open from them: say so and open the first host, rather than wait for one that will not come.
    const giveUp = (why: 'missing' | 'unread') => {
      setLeftOut([leftOutWords(itemids, why)]);
      update({ itemid: null });
    };
    // A person who chose a host while the lookup was out has answered it: the late result must not undo their choice.
    const chosenMeanwhile = () => new URLSearchParams(window.location.search).has('hostid');
    api
      .itemsById(itemids)
      .then((items) => {
        if (chosenMeanwhile()) return;
        const h = items[0]?.hosts?.[0]?.hostid;
        if (h) update({ hostid: h });
        else giveUp('missing');
      })
      .catch(() => {
        if (!chosenMeanwhile()) giveUp('unread');
      })
      .finally(() => (resolving.current = false));
  }, [hostid, itemids, update]);

  // No host and nothing to resolve: open the first host.
  useEffect(() => {
    if (!hostid && !itemids.length && groups.length) update({ hostid: groups[0].items[0].hostid });
  }, [hostid, itemids.length, groups, update]);

  const onItems = useCallback(
    (items: Item[]) => {
      const valid = itemids.filter((id) => items.some((i) => i.itemid === id));
      if (valid.length === itemids.length && valid.length) return;
      const dropped = itemids.filter((id) => !valid.includes(id));
      if (dropped.length) setLeftOut([leftOutWords(dropped, 'elsewhere')]);
      const next = valid.length ? valid : defaultItems(items);
      update({ itemid: next.length ? next.join(',') : null });
    },
    [itemids, update],
  );

  return (
    <>
      <div className="controls">
        <Field label="Host" htmlFor="graph-host">
          <select
            id="graph-host"
            value={hostid}
            onChange={(e) => {
              setLeftOut([]);
              update({ hostid: e.target.value, itemid: null });
            }}
          >
            {!host && (
              <option value={hostid}>
                {hostsQ.loading ? 'Loading hosts…' : hostsFailed ? 'Hosts unavailable' : hostsEmpty ? 'No hosts' : 'Select a host'}
              </option>
            )}
            {groups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.items.map((h) => (
                  <option key={h.hostid} value={h.hostid}>
                    {h.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <FieldGroup label="Range">
          <RangePicker value={range} onChange={setRange} />
        </FieldGroup>
      </div>

      {leftOut.length > 0 && (
        <div className="notice warn" role="status">
          {leftOut.join(' ')}
        </div>
      )}

      <div className="graph-layout">
        <div className="panel graph-side">
          <h2>Items</h2>
          {hostid ? (
            <ItemPicker
              hostid={hostid}
              selected={itemids}
              max={MAX_ITEMS}
              onItems={onItems}
              onChange={(ids) => {
                setLeftOut([]);
                update({ itemid: ids.length ? ids.join(',') : null });
              }}
            />
          ) : hostsFailed ? (
            <ErrorState message={hostsQ.error as string} />
          ) : hostsEmpty ? (
            <Empty>No hosts to show.</Empty>
          ) : (
            <Loading label="Loading hosts…" />
          )}
        </div>
        <div className="panel graph-main">
          <h2>{host?.name ?? 'Graph'}</h2>
          <GraphView
            itemids={itemids}
            range={range}
            empty="No values in this range (the item may report rarely, or not at all)."
          />
        </div>
      </div>
    </>
  );
}
