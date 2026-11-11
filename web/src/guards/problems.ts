/** The check for the problem list, which the live stream's frames pass through as well. */

import type { Problem } from '../types';
import { flag, guard, listOf, opt, shape, tag, text } from './shape';

const problem = shape<Problem>({
  eventid: text,
  objectid: text,
  object: text,
  name: text,
  severity: text,
  clock: text,
  r_eventid: opt(text),
  r_clock: opt(text),
  acknowledged: text,
  suppressed: opt(text),
  opdata: opt(text),
  tags: opt(listOf(tag)),
  host: opt(text),
  hostid: opt(text),
  manualClose: opt(flag),
});

/** GET /api/problems, and each `problems` frame of the live stream. */
export const problemListGuard = guard<Problem[]>('the problem list', listOf(problem));
