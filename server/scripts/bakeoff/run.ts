/**
 * The model bake-off (P3.2): the questions of questions.json asked of one model about the made-up estate of snapshot.txt, through the portal's own prompt and request code,
 * and scored by score.ts. One model a run, so that its settings are read as they are in production:
 *
 *   npx tsx scripts/bakeoff/run.ts --model qwen3:8b [--only 1,2,3] [--out scripts/bakeoff/results/qwen3-8b.json] [--base http://127.0.0.1:11434/v1]
 *
 * It asks Ollama on this machine (or the one --base names) and nothing leaves it. No FOCUS block is given, which is the harder path: a question that names a site is
 * helped by one in the portal. Nothing here is HCML's: the estate is invented.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, model } from './env.js';

const here = dirname(fileURLToPath(import.meta.url));
if (!model) {
  console.error('bakeoff: --model <name> is needed, for example --model qwen3:8b');
  process.exit(2);
}

const { streamAnswer, cleanAnswer } = await import('../../src/services/assistant.js');
const { scoreAnswer, summarise, PASS_MARKS } = await import('./score.js');
type Question = import('./score.js').Question;
type Check = import('./score.js').Check;

const snapshot = readFileSync(join(here, 'snapshot.txt'), 'utf8').trim();
const all = JSON.parse(readFileSync(join(here, 'questions.json'), 'utf8')) as Question[];
const only = arg('only')?.split(',').map(Number);
const questions = only ? all.filter((q) => only.includes(q.id)) : all;

const results: { question: Question; answer: string; pass: boolean; failed: Check[]; firstTokenMs: number | null; ms: number; promptMs?: number; promptTokens?: number; outputTokens?: number }[] = [];
let n = 0;
for (const question of questions) {
  n++;
  const started = Date.now();
  let firstTokenMs: number | null = null;
  let stats: { promptEvalMs?: number; promptEvalCount?: number; evalCount?: number } = {};
  let answer = '';
  try {
    for await (const piece of streamAnswer([{ role: 'user', content: question.q }], snapshot, undefined, { focus: null, language: question.preferred ?? null, onStats: (s) => (stats = s) })) {
      if (firstTokenMs === null) firstTokenMs = Date.now() - started;
      answer += piece;
    }
  } catch (err) {
    answer = '';
    console.error(`  #${question.id} failed: ${err instanceof Error ? err.message : err}`);
  }
  const cleaned = cleanAnswer(answer);
  const scored = scoreAnswer(question, cleaned);
  results.push({ question, answer: cleaned, ...scored, firstTokenMs, ms: Date.now() - started, promptMs: stats.promptEvalMs, promptTokens: stats.promptEvalCount, outputTokens: stats.evalCount });
  console.log(`${String(n).padStart(2)}/${questions.length} #${question.id} ${scored.pass ? 'ok  ' : 'FAIL'} ${scored.failed.join(',').padEnd(18)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${question.q.slice(0, 60)}`);
}

const summary = summarise(results);
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const first = results.map((r) => r.firstTokenMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
// The first question pays for the whole prompt; the rest find its start already read, as a second question of a conversation does in the portal.
const speed = { coldFirstTokenMs: results[0]?.firstTokenMs ?? 0, medianMs: ms[Math.floor(ms.length / 2)] ?? 0, medianFirstTokenMs: first[Math.floor(first.length / 2)] ?? 0, p90Ms: ms[Math.floor(ms.length * 0.9)] ?? 0 };
const out = arg('out') ?? join(here, 'results', `${model.replace(/[^\w.-]+/g, '-')}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ model, ran: new Date().toISOString(), passMarks: PASS_MARKS, summary, speed, results }, null, 1)}\n`);

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
console.log(`\n${model}: ${summary.passed}/${summary.questions} right (${pct(summary.overall)}); traps ${summary.traps.passed}/${summary.traps.asked}; language ${pct(summary.language.rate)}; format ${pct(summary.format.rate)}; median ${(speed.medianMs / 1000).toFixed(1)} s, first word ${(speed.medianFirstTokenMs / 1000).toFixed(1)} s (${(speed.coldFirstTokenMs / 1000).toFixed(1)} s on the first, cold)`);
console.log(`failed by: ${JSON.stringify(summary.failedBy)}; adopted by the marks: ${summary.adopted ? 'yes' : 'no'}\nwrote ${out}`);
