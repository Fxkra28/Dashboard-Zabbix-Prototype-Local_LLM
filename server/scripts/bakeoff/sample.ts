import { chatSystem, systemText } from '../../src/services/assistant.js';
import type { Question } from './score.js';

/** The questions whose real requests go to the speed test on a machine (deploy/model-speed.py): a count, a ranking, and two in Bahasa Indonesia. */
export const SAMPLE_IDS = [1, 2, 21, 23];

export interface PromptSample {
  about: string;
  /** The system text up to where the questions differ: the made-up estate and the rules, as the portal builds it. */
  prefix: string;
  /** What follows the prefix for each question (the language line, when the message needs one), and the question itself. */
  questions: { id: number; q: string; tail: string }[];
}

/** Built by the portal's own `chatSystem`, so the speed test reads the prompt that the portal sends. A test keeps the file equal to this. */
export function buildSample(snapshot: string, questions: Question[]): PromptSample {
  const prefix = systemText(snapshot);
  return {
    about: 'Made-up estate (server/scripts/bakeoff/snapshot.txt) and the portal\'s own rules: the system text of four questions, for deploy/model-speed.py. Rewrite with: npx tsx scripts/bakeoff/dump-sample.ts',
    prefix,
    questions: SAMPLE_IDS.map((id) => {
      const question = questions.find((q) => q.id === id);
      if (!question) throw new Error(`question ${id} is not in questions.json`);
      const system = chatSystem(snapshot, question.q, { focus: null, language: question.preferred ?? null });
      if (!system.startsWith(prefix)) throw new Error('the system text no longer starts with the snapshot text');
      return { id, q: question.q, tail: system.slice(prefix.length).replace(/^\n\n/, '') };
    }),
  };
}
