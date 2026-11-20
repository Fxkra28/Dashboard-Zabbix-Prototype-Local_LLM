import type { FastifyInstance } from 'fastify';
import { BadRequestError } from '../core/validate.js';
import { readerGone } from '../core/readerGone.js';
import { auditDownload } from '../security/audit.js';
import { sliExportGuard } from '../security/heavyLimit.js';
import { askForLog, checkAsk, parseAsk, readReport } from '../services/sliAsk.js';
import { FORMATS, fileFor, fileNameFor, fileNameOf, parseFormat, parseStyle } from '../services/sliExport.js';
import { singleValues } from '../core/schemas.js';

const EXPORT_QUERY = singleValues('month', 'from', 'to', 'dayHours', 'days', 'format', 'decimal', 'date', 'separator');
const ACCEPTED = Object.keys(EXPORT_QUERY.properties);

export async function sliExportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sli/export', { schema: { querystring: EXPORT_QUERY }, preHandler: sliExportGuard }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    // A misspelt or bracketed word would otherwise be ignored, and the current month served in its place.
    if (Object.keys(q).some((key) => !ACCEPTED.includes(key))) {
      throw new BadRequestError('Only month, from, to, dayHours, days, format, decimal, date and separator are accepted.');
    }
    // Before the Zabbix reads, so a bad request costs nothing.
    const ask = parseAsk(q);
    const format = parseFormat(q.format);
    const style = parseStyle(q);
    checkAsk(ask, Math.floor(Date.now() / 1000));

    // A reader who leaves while a month still waits for a place drops that read, as for /api/sli (BK-59).
    const signal = readerGone(reply);
    const [strict, hcml] = await Promise.all([readReport(ask, 'availability', signal), readReport(ask, 'hcml-report', signal)]);
    const body = fileFor(format, strict, hcml, new Date(), style);
    auditDownload(req, { report: 'sla', ...askForLog(ask), format, bytes: body.length });

    // The plain month is named from the validated month alone; any other file from the report's own dates and hours, which are numbers. No request text reaches a header.
    const fileName = ask.kind === 'month' && !ask.hours ? fileNameFor(ask.month, format) : fileNameOf(strict, format);
    return reply
      .header('Content-Type', FORMATS[format].type)
      .header('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .header('Content-Length', body.length)
      // A closed month never changes but the current one does, and the file is for the person who asked.
      .header('Cache-Control', 'private, no-store')
      .send(body);
  });
}
