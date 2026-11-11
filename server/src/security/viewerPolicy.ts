import type { FastifyRequest } from 'fastify';
import { roleAllows, roleOf } from './auth.js';
import { cached } from '../core/cache.js';
import { zbx } from '../clients/zabbix.js';

/**
 * What a viewer may not read through the generic routes.
 *
 * The Network and Links pages start at the wall role, but /api/items, /api/latest and /api/maps/detail
 * are viewer routes that return the same interface data. So network interface data stays with the
 * wall role and above: for a viewer these routes leave out the items whose key starts with `net.if` and
 * the network hosts on a map. A wall account, an operator and an admin see everything. A request with
 * no valid token never gets here.
 *
 * Leaving items out of a list is not enough on its own: /api/graph reads an item by id, and ids can
 * be guessed. `networkItemsDenied` closes that for it.
 */

/** Interface item keys: net.if.in[...], net.if.out[...], net.if.speed[...], net.if.status[...]. */
export const isNetworkKey = (key: unknown): boolean => typeof key === 'string' && key.startsWith('net.if');

/** Whether this caller is kept away from network interface data. Unknown or missing roles count as viewer. */
export const hidesNetwork = (req: FastifyRequest): boolean => !roleAllows(roleOf(req), 'wall');

/** The items without the interface ones: a new array, so a cached list is never changed. */
export const withoutNetworkItems = <T extends { key_?: unknown }>(items: T[]): T[] =>
  items.filter((item) => !isNetworkKey(item.key_));

/**
 * Whether any of these items is an interface item, from their keys: one lookup, kept for a while,
 * so a graph that polls does not ask Zabbix every time. An id Zabbix does not know has no key and
 * counts as not one, so the route's own "unknown item" answer is the one the caller sees.
 */
async function hasNetworkItem(itemids: readonly string[]): Promise<boolean> {
  const ids = [...new Set(itemids)].sort();
  if (!ids.length) return false;
  const found = await cached(
    `itemkeys:${ids.join(',')}`,
    300_000,
    () => zbx<{ itemid: string; key_?: string }[]>('item.get', { itemids: ids, output: ['itemid', 'key_'], webitems: true }),
    { typed: true },
  );
  return found.some((item) => isNetworkKey(item.key_));
}

/**
 * For the routes that read items by id (graph, history, trend): the 403 message when a viewer asks
 * for interface items, or null when the read may go on. A wall account, an operator or an admin costs no lookup at all.
 */
export async function networkItemsDenied(req: FastifyRequest, itemids: readonly string[]): Promise<string | null> {
  if (!hidesNetwork(req) || !(await hasNetworkItem(itemids))) return null;
  return `Network interface data needs the "wall" role; you are signed in as "${roleOf(req)}".`;
}
