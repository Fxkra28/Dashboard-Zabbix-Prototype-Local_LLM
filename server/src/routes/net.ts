import type { FastifyInstance } from 'fastify';
import { intParam, requireId } from '../core/validate.js';
import { getInterfacePage, getNetDevices } from '../services/net.js';
import { singleValues } from '../core/schemas.js';

const INTERFACES_QUERY = singleValues('hostid', 'search', 'status', 'page', 'pageSize');

/**
 * Network monitoring (setup.md §10). The portal never speaks SNMP: it just
 * reads the ICMP / SNMP-LLD items Zabbix already collects, exactly like any host.
 * These views populate automatically once real devices are onboarded (§13.4).
 */
export async function netRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/net/devices', () => getNetDevices());

  // ?hostid=&search=&status=up|down|other&page=&pageSize=
  app.get('/api/net/interfaces', { schema: { querystring: INTERFACES_QUERY } }, (req) => {
    const q = req.query as {
      hostid?: string;
      search?: string;
      status?: string;
      page?: string;
      pageSize?: string;
    };
    const hostid = requireId(q.hostid, 'hostid');
    const page = intParam(q.page, 1, 1, 100_000);
    const pageSize = intParam(q.pageSize, 200, 10, 1000);
    return getInterfacePage({ hostid, search: q.search, status: q.status, page, pageSize });
  });
}
