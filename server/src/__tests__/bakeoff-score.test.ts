import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PASS_MARKS, answerLanguage, scoreAnswer, summarise, type Question } from '../../scripts/bakeoff/score.js';

/** The marks of the model bake-off (P3.2) have to be able to pass and to fail, and the questions have to be answerable from the made-up estate they are asked about. */

const dir = (file: string) => fileURLToPath(new URL(`../../scripts/bakeoff/${file}`, import.meta.url));
const questions = JSON.parse(readFileSync(dir('questions.json'), 'utf8')) as (Question & { reference: string })[];
const snapshot = readFileSync(dir('snapshot.txt'), 'utf8');

describe('the questions', () => {
  it('are fifty: twenty in English, twenty in Bahasa Indonesia and ten mixed or too short to place, six of them asking for what the data does not hold', () => {
    expect(questions).toHaveLength(50);
    expect(new Set(questions.map((q) => q.id)).size).toBe(50);
    expect(questions.filter((q) => q.lang === 'en')).toHaveLength(20);
    expect(questions.filter((q) => q.lang === 'id')).toHaveLength(20);
    expect(questions.filter((q) => q.lang === 'mixed')).toHaveLength(10);
    expect(questions.filter((q) => q.kind === 'trap')).toHaveLength(6);
    // The cases the tracker logged against the 8B model: a ranking read the wrong way (BK-17), a partial list taken for the whole (BK-20), and a verdict (BK-33).
    expect(questions.some((q) => q.kind === 'rank')).toBe(true);
    expect(questions.some((q) => q.kind === 'partial')).toBe(true);
    expect(questions.some((q) => q.kind === 'sla')).toBe(true);
  });

  it('carry patterns that compile, and a reference answer that passes every check, so that none can fail for a reason in the question', () => {
    for (const q of questions) {
      for (const p of [...(q.must ?? []), ...(q.mustNot ?? [])]) expect(() => new RegExp(p, 'i'), `#${q.id} ${p}`).not.toThrow();
      const { pass, failed } = scoreAnswer(q, q.reference);
      expect({ id: q.id, pass, failed }).toEqual({ id: q.id, pass: true, failed: [] });
    }
  });

  it('are asked about figures that are in the estate: every number a reference answer gives is in the snapshot or in the question', () => {
    const known = (n: string) => snapshot.includes(n) || snapshot.includes(n.replace(',', '.'));
    for (const q of questions.filter((x) => x.kind !== 'trap' && x.kind !== 'summary')) {
      for (const n of q.reference.match(/\d+[.,]\d{2}\b/g) ?? []) expect(known(n), `#${q.id} ${n}`).toBe(true);
    }
  });
});

describe('scoreAnswer', () => {
  const ask = (id: number) => questions.find((q) => q.id === id)!;

  it('fails an answer that is missing a fact, and one that names a host as down that is not', () => {
    expect(scoreAnswer(ask(4), 'Four hosts are unreachable: DELTA-SW01, DELTA-AP01, DELTA-AP02 and BRAVO-SW01.').failed).toEqual(['facts']);
    expect(scoreAnswer(ask(15), 'DELTA-SW01, DELTA-AP01 and DELTA-AP02 are down, and DELTA-AP03 is down too.').failed).toContain('invented');
  });

  it('fails an invented cause or figure where the data holds none, and passes an answer that says so', () => {
    expect(scoreAnswer(ask(17), 'The outage at DELTA-SW01 was caused by a power failure.').pass).toBe(false);
    expect(scoreAnswer(ask(18), 'The core switch is at 41 degrees.').failed).toEqual(expect.arrayContaining(['invented', 'facts']));
    expect(scoreAnswer(ask(18), 'The temperature is not in my data.').pass).toBe(true);
  });

  it('does not hold it against an answer that names a cause only to say the data does not give it (17 November: qwen3.5 was failed for exactly that)', () => {
    const says = 'I cannot determine the specific cause of the outage for 4.2.1 DELTA-SW01 from the snapshot. The monitoring system indicates the device is unreachable, but does not specify whether this is due to a hardware failure, network segment issue, or power loss.';
    expect(scoreAnswer(ask(17), says)).toEqual({ pass: true, failed: [] });
    expect(scoreAnswer(ask(17), 'No specific cause is shown in the snapshot. The data does not indicate a root cause like a hardware failure or configuration error.').pass).toBe(true);
    expect(scoreAnswer(ask(37), 'Data tidak menunjukkan penyebab matinya DELTA-SW01, jadi tidak diketahui apakah ada kabel putus atau perangkat rusak.').pass).toBe(true);
  });

  it('still fails a cause that is offered as the answer or as a guess: only a negation before the mention, in its own sentence, excuses it', () => {
    // Asserted outright, with or without a remark that the data is thin.
    expect(scoreAnswer(ask(17), 'The data gives no details, but the outage was caused by a power failure.').failed).toContain('invented');
    expect(scoreAnswer(ask(17), 'No cause is listed. DELTA-SW01 is down because of a hardware failure.').failed).toContain('invented');
    // The negation comes after the guess, so it excuses nothing.
    expect(scoreAnswer(ask(17), 'It is probably a hardware failure, and the snapshot does not say more.').failed).toContain('invented');
    expect(scoreAnswer(ask(37), 'Data tidak menunjukkan penyebabnya. Perangkat itu dapat mati karena kabel putus, tetapi tidak ada detail lebih lanjut.').failed).toContain('invented');
    // A negation in the sentence before is another sentence.
    expect(scoreAnswer(ask(37), 'Penyebabnya tidak diketahui. Kemungkinan besar kabel putus.').failed).toContain('invented');
    // A negation of something else in the sentence ("does not respond to ping") is no denial that the data names a cause.
    expect(scoreAnswer(ask(37), 'Data tidak menunjukkan penyebabnya. Status ini berarti perangkat tidak merespons ping, yang dapat disebabkan oleh kabel putus atau perangkat rusak.').failed).toContain('invented');
    expect(scoreAnswer(ask(17), 'No cause is listed. The switch does not answer ping, which may point to a hardware failure.').failed).toContain('invented');
    // The dots of a host name are not the end of a sentence.
    expect(scoreAnswer(ask(17), 'I cannot say what caused the outage of 4.2.1 DELTA-SW01, such as a hardware failure.').failed).not.toContain('invented');
  });

  it('keeps the question that gives the symptom as the cause a failure, as it asks for the data not holding one', () => {
    expect(scoreAnswer(ask(37), 'Penyebabnya adalah Unavailable by ICMP ping, dan masalah ini sudah terjadi selama 30 menit.').failed).toEqual(['facts']);
    expect(scoreAnswer(ask(17), 'The outage was caused by it being unavailable via ICMP ping.').pass).toBe(false);
  });

  it('does not take the data\'s own words for a denial: an alert\'s name, a host that does not answer, an alarm that is not acknowledged (18 November: gemma4 had passed nine answers that only repeated the alert)', () => {
    expect(scoreAnswer(ask(17), 'The snapshot shows that **4.2.1 DELTA-SW01** is currently "Unavailable by ICMP ping". The issue has been ongoing for about 30 minutes and has not been acknowledged yet.').failed).toEqual(['facts']);
    expect(scoreAnswer(ask(37), '**4.2.1 DELTA-SW01** saat ini tidak bisa dijangkau (Unavailable by ICMP ping) sejak 30 menit yang lalu dan belum di-acknowledge oleh operator.').failed).toEqual(['facts']);
    expect(scoreAnswer(ask(37), 'DELTA-SW01 tidak merespons ping, jadi perangkat itu tidak terhubung.').failed).toContain('facts');
    expect(scoreAnswer(ask(39), 'Penanggung jawab di situs Surabaya adalah **2.2.1 BRAVO-SW01** (1 tidak bisa dijangkau, 4 masalah, belum di-acknowledge).').failed).toEqual(['facts']);
    // The same wording beside a denial of the answer's own is still a right answer.
    expect(scoreAnswer(ask(17), 'DELTA-SW01 is "Unavailable by ICMP ping", but the snapshot does not say what caused it.').pass).toBe(true);
    expect(scoreAnswer(ask(37), 'DELTA-SW01 tidak bisa dijangkau, tetapi data tidak mencantumkan penyebabnya.').pass).toBe(true);
    // The dots of a host name do not end the sentence, and "determine" says it as well as "say".
    expect(scoreAnswer(ask(17), 'I cannot determine the specific cause of the outage for 4.2.1 DELTA-SW01 from the snapshot; the data only shows it is unavailable by ICMP ping.').pass).toBe(true);
    expect(scoreAnswer(ask(17), 'The snapshot does not record why 4.2.1 DELTA-SW01 is down.').pass).toBe(true);
  });

  it('fails a contact that the data does not hold: an address or a number made up for the person in charge', () => {
    expect(scoreAnswer(ask(39), 'Penanggung jawab: Budi (telepon: 0812-3456-7890, email: budi@example.invalid). Tidak ada yang kritis.').failed).toContain('invented');
    expect(scoreAnswer(ask(39), 'Penanggung jawab: Agus, telepon +62 899 0123 4567.').failed).toContain('invented');
    expect(scoreAnswer(ask(39), 'Data yang saya miliki tidak mencantumkan nama, telepon atau email penanggung jawab situs Surabaya.').pass).toBe(true);
  });

  it('takes the other Bahasa Indonesia verbs that say a thing is not in the data, "tidak mencantumkan" among them', () => {
    for (const verb of ['mencantumkan', 'mencatat', 'memuat', 'menyimpan', 'berisi']) {
      expect(scoreAnswer(ask(39), `Data yang saya miliki tidak ${verb} nama penanggung jawab untuk situs Surabaya.`).pass, verb).toBe(true);
    }
    expect(scoreAnswer(ask(39), 'Penanggung jawab di situs Surabaya adalah Pak Budi.').pass).toBe(false);
  });

  it('fails an answer in the wrong language, and does not hold a name-only answer to one', () => {
    expect(scoreAnswer(ask(1), 'There are 24 hosts at the sites and 5 of them are unreachable, as the data says.').pass).toBe(true);
    expect(scoreAnswer(ask(21), 'There are 24 hosts, and the five that are unreachable are the ones that the data lists.').failed).toContain('language');
    expect(scoreAnswer(ask(4), '4.2.1 DELTA-SW01, 4.3.1 DELTA-AP01, 4.3.2 DELTA-AP02, INET : SAMPANG WAN 2, 2.2.1 BRAVO-SW01').pass).toBe(true);
  });

  it('fails what the page cannot draw (a heading, a table, a fence), not the bold and bullets the prompt asks for, and an answer too long, and an empty one', () => {
    expect(scoreAnswer(ask(5), 'There are **14** open problems, and they are not acknowledged.').pass).toBe(true);
    expect(scoreAnswer(ask(5), '**14** open problems are not acknowledged:\n- one\n- two\n- three').failed).toEqual([]);
    expect(scoreAnswer(ask(5), '## Open problems\n14 are not acknowledged.').failed).toEqual(['format']);
    expect(scoreAnswer(ask(5), '| open | 14 |\n|---|---|').failed).toContain('format');
    expect(scoreAnswer(ask(5), '14 are not acknowledged:\n```\n14\n```').failed).toEqual(['format']);
    expect(scoreAnswer(ask(5), '14 are <b>not</b> acknowledged.').failed).toEqual(['format']);
    expect(scoreAnswer(ask(5), `14 problems are not acknowledged. ${'More. '.repeat(200)}`).failed).toContain('length');
    expect(scoreAnswer(ask(5), '   ').failed).toEqual(['empty']);
  });

  it('places an answer by the portal\'s own word lists', () => {
    expect(answerLanguage('There are two hosts that are down')).toBe('en');
    expect(answerLanguage('Ada dua host yang mati')).toBe('id');
    expect(answerLanguage('4.2.1 DELTA-SW01')).toBeNull();
  });
});

describe('summarise', () => {
  const result = (q: Question, pass: boolean, failed: ('facts' | 'language')[] = []) => ({ question: q, pass, failed });

  it('adopts a model that reaches every mark and no other', () => {
    const all = questions.map((q) => result(q, true));
    expect(summarise(all)).toMatchObject({ questions: 50, passed: 50, overall: 1, adopted: true });
    expect(PASS_MARKS).toEqual({ overall: 0.8, traps: 1, language: 0.95, format: 0.98 });
  });

  it('does not adopt one that fails a trap, though it is right on the rest', () => {
    const trap = questions.find((q) => q.kind === 'trap')!;
    const run = questions.map((q) => result(q, q.id !== trap.id, q.id === trap.id ? ['facts'] : []));
    const s = summarise(run);
    expect(s.overall).toBeCloseTo(0.98);
    expect(s.traps).toMatchObject({ asked: 6, passed: 5 });
    expect(s.adopted).toBe(false);
  });

  it('does not adopt one under eighty in a hundred, and counts what failed and where', () => {
    const run = questions.map((q, i) => result(q, i % 4 !== 0, i % 4 === 0 ? ['facts'] : []));
    const s = summarise(run);
    expect(s.overall).toBeLessThan(0.8);
    expect(s.adopted).toBe(false);
    expect(s.failedBy.facts).toBe(13);
    expect(Object.values(s.byLang).reduce((n, v) => n + v.asked, 0)).toBe(50);
  });

  it('does not adopt one that answers in the wrong language more than one time in twenty', () => {
    const named = questions.filter((q) => q.answerLang !== 'either');
    const wrong = new Set(named.slice(0, 3).map((q) => q.id));
    const run = questions.map((q) => result(q, !wrong.has(q.id), wrong.has(q.id) ? ['language'] : []));
    expect(summarise(run).language.rate).toBeLessThan(0.95);
    expect(summarise(run).adopted).toBe(false);
  });
});
