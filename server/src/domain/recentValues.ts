import { zbx } from '../clients/zabbix.js';

/** The newest value an item holds, as Zabbix's history keeps it. */
export interface RecentValue {
  value: string;
  clock: string;
}

/**
 * The newest value of each item within the last `windowS` seconds. Zabbix's own `lastvalue` costs one query
 * per item (57 to 88 ms each on HCML's server); history.get reads every item of one value type at once.
 */
export async function recentValues(
  items: readonly { itemid: string; value_type: string }[],
  windowS: number,
  nowS = Math.floor(Date.now() / 1000),
): Promise<Map<string, RecentValue>> {
  const byType = new Map<string, string[]>();
  for (const it of items) {
    const ids = byType.get(it.value_type);
    if (ids) ids.push(it.itemid);
    else byType.set(it.value_type, [it.itemid]);
  }
  const out = new Map<string, RecentValue>();
  const reads = await Promise.all(
    [...byType].map(([valueType, itemids]) =>
      zbx<{ itemid: string; clock: string; value: string }[]>('history.get', {
        history: Number(valueType),
        itemids,
        time_from: nowS - windowS,
        output: ['itemid', 'clock', 'value'],
      }),
    ),
  );
  for (const rows of reads) {
    for (const r of rows) {
      const held = out.get(r.itemid);
      if (!held || Number(r.clock) > Number(held.clock)) out.set(r.itemid, { value: r.value, clock: r.clock });
    }
  }
  return out;
}
