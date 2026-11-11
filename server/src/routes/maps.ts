import type { FastifyInstance } from 'fastify';
import { requireId } from '../core/validate.js';
import { config } from '../core/config.js';
import { hidesNetwork } from '../security/viewerPolicy.js';
import { getMapDetail, getMaps, networkHostIds, withoutNetworkElements } from '../services/maps.js';
import { singleValues } from '../core/schemas.js';

export async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/maps', () => getMaps());

  // ?mapid=
  app.get('/api/maps/detail', { schema: { querystring: singleValues('mapid') } }, async (req) => {
    const mapid = requireId((req.query as { mapid?: string }).mapid, 'mapid');
    const detail = await getMapDetail(mapid);
    // Network hosts are operator data. Cut after the cache: it holds one map for every role.
    return hidesNetwork(req) ? withoutNetworkElements(detail, await networkHostIds(), config.netGroupIds) : detail;
  });
}
