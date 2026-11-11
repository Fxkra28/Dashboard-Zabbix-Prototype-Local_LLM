import type { FastifyInstance } from 'fastify';
import { BadRequestError, intParam, optionalId, requireId } from '../core/validate.js';
import { searchGuard } from '../security/searchLimit.js';
import { hidesNetwork, withoutNetworkItems } from '../security/viewerPolicy.js';
import {
  MAX_ITEMIDS,
  findItems,
  getHostGroups,
  hostsOverviewView,
  getHosts,
  getLatestItems,
  getLatestPage,
} from '../services/hosts.js';
import { singleValues } from '../core/schemas.js';

const ITEMS_QUERY = singleValues('hostid', 'search', 'graphable', 'itemids');
const LATEST_QUERY = singleValues('hostid', 'groupid', 'search', 'page', 'pageSize');

export async function hostRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/hosts', () => getHosts());

  // Monitoring → Hosts: each host + its live problem severity counts, and its
  // reachability `state`/`reason` (ping first; reachability.ts).
  app.get('/api/hosts/overview', () => hostsOverviewView());

  app.get('/api/hostgroups', () => getHostGroups());

  // Items for one host, powers the graph item picker.
  //   ?hostid=           every item on the host (webitems included)
  //   &search=           substring of key_
  //   &graphable=1       numeric (float/uint), enabled and supported only
  //   ?itemids=a,b       specific items (any host), resolves a deep link
  // hostid is required unless itemids is given: without it Zabbix would get `hostids: [undefined]`
  // and answer with an opaque 500.
  app.get('/api/items', { schema: { querystring: ITEMS_QUERY }, preHandler: searchGuard }, async (req) => {
    const q = req.query as { hostid?: string; search?: string; graphable?: string; itemids?: string };
    const graphable = q.graphable === '1' || q.graphable === 'true';
    const itemids =
      q.itemids !== undefined && q.itemids !== ''
        ? [...new Set(q.itemids.split(',').map((s) => requireId(s.trim(), 'itemids')))]
        : undefined;
    if (itemids && itemids.length > MAX_ITEMIDS) {
      throw new BadRequestError(`At most ${MAX_ITEMIDS} itemids per request.`);
    }
    const hostid = itemids ? optionalId(q.hostid, 'hostid') : requireId(q.hostid, 'hostid');
    const found = await findItems({ hostid, itemids, search: q.search, graphable });
    // Interface items are operator data. Cut after the cache: it holds one list for every role.
    return hidesNetwork(req) ? withoutNetworkItems(found) : found;
  });

  // Monitoring → Latest data: items with their latest value/time, filtered by
  // host or group (Zabbix requires a filter here to bound the result set).
  //
  // With `page`, the list is paged server-side (getLatestPage). Without `page` the
  // original first-500 read is kept for older callers.
  app.get('/api/latest', { schema: { querystring: LATEST_QUERY }, preHandler: searchGuard }, (req) => {
    const q = req.query as {
      hostid?: string;
      groupid?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    };
    const { hostid, groupid, search } = q;
    const paged = q.page !== undefined && q.page !== '';
    if (!hostid && !groupid) {
      return paged
        ? { items: [], truncated: false, total: 0, page: 1, pageSize: intParam(q.pageSize, 100, 25, 500) }
        : { items: [], truncated: false };
    }
    const filter = {
      ...(hostid ? { hostids: [optionalId(hostid, 'hostid')] } : {}),
      ...(groupid ? { groupids: [optionalId(groupid, 'groupid')] } : {}),
    };

    if (paged) {
      const page = intParam(q.page, 1, 1, 1_000_000);
      const pageSize = intParam(q.pageSize, 100, 25, 500);
      return getLatestPage({ filter, hostid, groupid, needle: search?.trim() ?? '', page, pageSize, hide: hidesNetwork(req) });
    }
    return getLatestItems(filter, hostid, groupid, search, hidesNetwork(req));
  });
}
