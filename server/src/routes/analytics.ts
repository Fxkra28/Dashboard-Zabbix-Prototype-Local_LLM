import type { FastifyInstance } from 'fastify';
import { BadRequestError, intParam } from '../core/validate.js';
import { config } from '../core/config.js';
import { parseMonth } from '../sli/time.js';
import { parseProfile } from '../services/sli.js';
import { getAgingReport } from '../services/aging.js';
import { getAllProblemsAvailabilityReport, getDerivedAvailabilityReport } from '../services/availability.js';
import { CAPACITY_DAYS, CAPACITY_TOP, getCapacityReport } from '../services/capacity.js';
import { getNoiseReport } from '../services/noise.js';
import { singleValues } from '../core/schemas.js';

const AVAILABILITY_QUERY = singleValues('days', 'severity', 'month', 'profile', 'basis');

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // intParam, not Math.min/Math.max around Number(): `days=abc` is NaN, NaN
  // survives both clamps, and a NaN `time_from` removes the time bound entirely.
  //   ?basis=availability (default) &profile=&month=YYYY-MM | &days=
  //   ?basis=all-problems &severity= &month=YYYY-MM | &days=   the original any-problem report
  app.get('/api/reports/availability', { schema: { querystring: AVAILABILITY_QUERY } }, (req) => {
    const q = req.query as { days?: string; severity?: string; month?: string; profile?: string; basis?: string };
    const days = intParam(q.days, 7, 1, 365);
    const minSeverity = intParam(q.severity, config.reports.availabilityMinSeverity, 0, 5);
    if (q.basis && q.basis !== 'availability' && q.basis !== 'all-problems') {
      throw new BadRequestError('basis must be "availability" or "all-problems".');
    }
    // Parsed before the basis branch, so the any-problem report honours `month`
    // instead of quietly answering for the last 7 days.
    const month = q.month ? parseMonth(q.month) : undefined;
    if (q.basis === 'all-problems') return getAllProblemsAvailabilityReport(days, minSeverity, month);
    return getDerivedAvailabilityReport({ days, month, profile: parseProfile(q.profile), minSeverity });
  });

  //   ?days=&severity=&top=   top: triggers sent, loudest first (default 100, 1 to 1000)
  app.get('/api/reports/noise', { schema: { querystring: singleValues('days', 'severity', 'top') } }, (req) => {
    const q = req.query as { days?: string; severity?: string; top?: string };
    return getNoiseReport(intParam(q.days, 7, 1, 365), intParam(q.severity, 0, 0, 5), intParam(q.top, 100, 1, 1000));
  });

  app.get('/api/reports/aging', () => getAgingReport());

  app.get('/api/reports/capacity', { schema: { querystring: singleValues('days', 'top') } }, (req) => {
    const q = req.query as { days?: string; top?: string };
    return getCapacityReport(intParam(q.days, CAPACITY_DAYS, 1, 365), intParam(q.top, CAPACITY_TOP, 1, 50));
  });
}
