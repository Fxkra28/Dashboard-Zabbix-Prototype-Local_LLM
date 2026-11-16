import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { BadRequestError } from '../core/validate.js';
import { readerGone } from '../core/readerGone.js';
import { auditDownload } from '../security/audit.js';
import { sliExportGuard } from '../security/heavyLimit.js';
import { currentMonth, parseMonth } from '../sli/time.js';
import { getMonthlySli } from '../services/sli.js';
import { FORMATS, fileFor, fileNameFor, parseFormat, parseStyle } from '../services/sliExport.js';
import { singleValues } from '../core/schemas.js';

const EXPORT_QUERY = singleValues('month', 'format', 'decimal', 'date', 'separator');
const ACCEPTED = Object.keys(EXPORT_QUERY.properties);

export async function sliExportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sli/export', { schema: { querystring: EXPORT_QUERY }, preHandler: sliExportGuard }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    // A misspelt or bracketed month would otherwise be ignored, and the current month served in its place.
    if (Object.keys(q).some((key) => !ACCEPTED.includes(key))) {
      throw new BadRequestError('Only month, format, decimal, date and separator are accepted.');
    }
    const month = q.month ? parseMonth(q.month) : currentMonth(config.sla.timezone);
    // Before the Zabbix reads, so a bad request costs nothing.
    const format = parseFormat(q.format);
    const style = parseStyle(q);

    // A reader who leaves while a month still waits for a place drops that read, as for /api/sli (BK-59).
    const signal = readerGone(reply);
    const [strict, hcml] = await Promise.all([
      getMonthlySli(month, 'availability', signal),
      getMonthlySli(month, 'hcml-report', signal),
    ]);
    const body = fileFor(format, strict, hcml, new Date(), style);
    auditDownload(req, { report: 'sla', month, format, bytes: body.length });

    const fileName = fileNameFor(month, format);
    return reply
      .header('Content-Type', FORMATS[format].type)
      .header('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .header('Content-Length', body.length)
      // A closed month never changes but the current one does, and the file is for the person who asked.
      .header('Cache-Control', 'private, no-store')
      .send(body);
  });
}
