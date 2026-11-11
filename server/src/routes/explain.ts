import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { AiDisabledError } from '../clients/ai.js';
import { parseProfile } from '../services/sli.js';
import { optionalId, requireId } from '../core/validate.js';
import { currentMonth, parseMonth } from '../sli/time.js';
import { aiGuard } from '../clients/limits.js';
import { aiUse } from '../security/audit.js';
import { explainDerivedSla, explainProblem, explainZabbixSla, type SlaAnswer } from '../services/explain.js';
import { singleValues } from '../core/schemas.js';

const PROBLEM_QUERY = singleValues('eventid');
const outcomeOf = (answer: object) => ('notFound' in answer ? ('not_found' as const) : ('answered' as const));
const SLA_QUERY = singleValues('slaid', 'serviceid', 'source', 'month', 'profile', 'scope');

export async function explainRoutes(app: FastifyInstance): Promise<void> {
  const explain = (querystring: ReturnType<typeof singleValues>) => ({ schema: { querystring }, preHandler: aiGuard('explain') });
  app.get('/api/explain/problem', explain(PROBLEM_QUERY), async (req, reply) => {
    // Thrown rather than answered inline so the message names the setting to fix.
    if (!config.ai.enabled) throw new AiDisabledError();

    const eventid = requireId((req.query as { eventid?: string }).eventid, 'eventid');
    const answer = await aiUse(req, 'explain').run((onUsage) => explainProblem(eventid, onUsage), outcomeOf);
    if ('notFound' in answer) return reply.code(404).send({ error: 'not_found', message: answer.notFound });
    return answer;
  });

  /**
   * One SLA's standing, in plain language.
   *
   *   ?slaid=&serviceid=                          a Zabbix SLA, current period
   *   ?source=derived&month=&profile=&scope=      the derived monthly SLA
   *                                               (scope: overall | site:N | category:NAME)
   */
  app.get('/api/explain/sla', explain(SLA_QUERY), async (req, reply): Promise<SlaAnswer | void> => {
    if (!config.ai.enabled) throw new AiDisabledError();

    const q = req.query as {
      slaid?: string;
      serviceid?: string;
      source?: string;
      month?: string;
      profile?: string;
      scope?: string;
    };

    let answer: SlaAnswer | { notFound: string };
    if (q.source === 'derived') {
      const month = q.month ? parseMonth(q.month) : currentMonth(config.sla.timezone);
      const profile = parseProfile(q.profile);
      answer = await aiUse(req, 'explain').run((onUsage) => explainDerivedSla({ month, profile, scope: q.scope || 'overall' }, onUsage), outcomeOf);
    } else {
      const slaid = requireId(q.slaid, 'slaid');
      const serviceid = optionalId(q.serviceid, 'serviceid');
      answer = await aiUse(req, 'explain').run((onUsage) => explainZabbixSla(slaid, serviceid, onUsage), outcomeOf);
    }
    if ('notFound' in answer) return reply.code(404).send({ error: 'not_found', message: answer.notFound });
    return answer;
  });
}
