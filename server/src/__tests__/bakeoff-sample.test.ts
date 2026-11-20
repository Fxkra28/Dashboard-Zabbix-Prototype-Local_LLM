import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSample, SAMPLE_IDS } from '../../scripts/bakeoff/sample.js';
import type { Question } from '../../scripts/bakeoff/score.js';

/** deploy/model-speed.py sends the prompts of prompt-sample.json to a model on a machine that has no Node. They must stay the prompts that the portal builds today. */

const file = (name: string) => fileURLToPath(new URL(`../../scripts/bakeoff/${name}`, import.meta.url));
const snapshot = readFileSync(file('snapshot.txt'), 'utf8').trim();
const questions = JSON.parse(readFileSync(file('questions.json'), 'utf8')) as Question[];

describe('prompt-sample.json', () => {
  it('is what the portal builds for those questions now; when the rules, the snapshot or a question moves, run: npx tsx scripts/bakeoff/dump-sample.ts', () => {
    expect(JSON.parse(readFileSync(file('prompt-sample.json'), 'utf8'))).toEqual(buildSample(snapshot, questions));
  });

  it('holds the whole system text once and, per question, only what follows it, so that the first question pays for reading it and the rest find it read', () => {
    const sample = buildSample(snapshot, questions);
    expect(sample.questions.map((q) => q.id)).toEqual(SAMPLE_IDS);
    expect(sample.prefix).toContain('How to answer:');
    expect(sample.prefix).toContain('ESTATE: 24 hosts');
    for (const q of sample.questions) expect(q.tail.length).toBeLessThan(200);
    // Each question is followed by the line that names the language of its message.
    expect(sample.questions.find((q) => q.id === 1)?.tail).toContain('in English');
    expect(sample.questions.find((q) => q.id === 21)?.tail).toContain('Bahasa Indonesia');
  });
});
