/** The checks for what a model writes: the Explain answers. */

import type { ProblemExplanation, SlaExplanation } from '../types';
import { flag, guard, listOf, opt, shape, text } from './shape';

const problemExplanation = shape<ProblemExplanation>({
  summary: text,
  tagsExplained: listOf(shape<ProblemExplanation['tagsExplained'][number]>({ tag: text, value: text, meaning: text })),
  businessImpact: text,
  recommendation: text,
});

const slaExplanation = shape<SlaExplanation>({ status: text, plain: text, meetingTarget: flag, recommendation: text, noData: opt(flag) });

/** GET /api/explain/problem. A model writes the words; the BFF asks for this shape, so a text that is not it is refused here and not shown half drawn. */
export const problemExplanationGuard = guard<ProblemExplanation>('the explanation', problemExplanation);

/** GET /api/explain/sla, and the neutral answer the BFF gives without a model when nothing was measured (`noData`). */
export const slaExplanationGuard = guard<SlaExplanation>('the explanation', slaExplanation);
