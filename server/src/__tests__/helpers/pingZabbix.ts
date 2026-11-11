/** A ping item as the fixtures write it: its value and the time Zabbix collected it. */
export interface PingItem {
  itemid: string;
  lastvalue?: string;
  lastclock?: string;
}

/**
 * A Zabbix stand-in for the ping reads of reachability.ts: `item.get` gives the items, `history.get` the value
 * of each one collected inside the window asked for, as a row, and anything else goes to `other`.
 */
export function pingZabbix<T extends PingItem>(items: T[], other: (method: string, params: Record<string, unknown>) => unknown = () => []) {
  return async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    if (method === 'history.get') {
      const wanted = new Set((params.itemids as string[] | undefined) ?? []);
      const from = Number(params.time_from ?? 0);
      return items
        .filter((i) => wanted.has(i.itemid) && Number(i.lastclock) > 0 && Number(i.lastclock) >= from)
        .map((i) => ({ itemid: i.itemid, clock: i.lastclock, value: i.lastvalue, ns: '0' }));
    }
    if (method === 'item.get') {
      const wanted = params.itemids as string[] | undefined;
      return wanted ? items.filter((i) => wanted.includes(i.itemid)) : items;
    }
    return other(method, params);
  };
}
