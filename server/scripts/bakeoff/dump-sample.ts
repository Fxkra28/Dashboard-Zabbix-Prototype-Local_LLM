/** Writes prompt-sample.json, the real prompts of four questions, for the speed test on a machine that has no Node (deploy/model-speed.py). */
import './env.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Question } from './score.js';

const { buildSample } = await import('./sample.js');
const here = dirname(fileURLToPath(import.meta.url));
const snapshot = readFileSync(join(here, 'snapshot.txt'), 'utf8').trim();
const questions = JSON.parse(readFileSync(join(here, 'questions.json'), 'utf8')) as Question[];
const out = join(here, 'prompt-sample.json');
writeFileSync(out, `${JSON.stringify(buildSample(snapshot, questions), null, 1)}\n`);
console.log(`wrote ${out}`);
