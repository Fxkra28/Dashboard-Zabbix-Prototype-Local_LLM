/**
 * Scores the saved answers of a run again, with the questions and marks as they are now, and rewrites the file. The model is not asked: a pattern that turned away a right
 * answer is mended here, and no answer changes.
 *
 *   npx tsx scripts/bakeoff/rescore.ts scripts/bakeoff/results/qwen3-8b.json [...]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASS_MARKS, scoreAnswer, summarise, type Question } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));
const questions = new Map((JSON.parse(readFileSync(join(here, 'questions.json'), 'utf8')) as Question[]).map((q) => [q.id, q]));
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('rescore: name the result files to score again');
  process.exit(2);
}

for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { model: string; passMarks: unknown; summary: unknown; results: { question: Question; answer: string; pass: boolean; failed: string[] }[] };
  const before = (run.summary as { passed: number }).passed;
  run.results = run.results.map((r) => {
    const question = questions.get(r.question.id);
    if (!question) throw new Error(`${file}: question ${r.question.id} is not in questions.json`);
    return { ...r, question, ...scoreAnswer(question, r.answer) };
  });
  const results = run.results as unknown as Parameters<typeof summarise>[0];
  run.summary = summarise(results);
  run.passMarks = PASS_MARKS;
  writeFileSync(file, `${JSON.stringify(run, null, 1)}\n`);
  const s = run.summary as ReturnType<typeof summarise>;
  console.log(`${run.model}: ${before} -> ${s.passed} of ${s.questions} right; traps ${s.traps.passed}/${s.traps.asked}; adopted by the marks: ${s.adopted ? 'yes' : 'no'}`);
}
