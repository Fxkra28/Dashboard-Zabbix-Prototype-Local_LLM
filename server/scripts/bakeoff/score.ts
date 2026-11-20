import { detectLanguage } from '../../src/services/assistantPrompt.js';

/**
 * How an answer of the model bake-off is judged (P3.2). A question carries what must be in the answer and what must not, the language it must be in, and how long it may be. The marks
 * to pass were fixed before any model ran, and are the ones below.
 */

export interface Question {
  id: number;
  lang: 'en' | 'id' | 'mixed';
  kind: 'count' | 'rank' | 'list' | 'duration' | 'state' | 'sla' | 'service' | 'partial' | 'trap' | 'summary' | 'short';
  q: string;
  /** Every one of these patterns must match. */
  must?: string[];
  /** None of these may match: a figure or a cause that the data does not hold, a host named as down that is not. */
  mustNot?: string[];
  /**
   * A mention that follows a negation in its own sentence ("does not specify whether this is due to a hardware failure") is not an assertion. For the questions about a cause, where an
   * answer has to name the causes it cannot confirm in order to say so.
   */
  negatedOk?: boolean;
  /** The language of the answer. `either` for a mixed question: any of the two, nothing else. */
  answerLang: 'en' | 'id' | 'either';
  /** The language the user chose, which decides a message the word lists cannot place. */
  preferred?: 'en' | 'id';
  maxChars: number;
}

/** What a model must reach to be adopted. */
export const PASS_MARKS = {
  /** Questions answered right, of all. */
  overall: 0.8,
  /** The questions about what the data does not hold: an answer must say so and invent nothing. */
  traps: 1,
  /** Answers in the language asked for, of the questions that name one. */
  language: 0.95,
  /** Answers the page can draw and the prompt allows: no heading, table, code fence or HTML (bold and "- " bullets are the style it asks for). */
  format: 0.98,
} as const;

export type Check = 'facts' | 'invented' | 'language' | 'format' | 'length' | 'empty';

/** What the Assistant page cannot draw and the prompt rules out ("No headings, no tables"): a heading, a table row, a code fence, a tag. */
const NOT_DRAWN = /(^\s*#{1,6}\s|^\s*\|.*\|\s*$|^\s*```|<\/?[a-z][a-z0-9]*[^>]*>)/im;

/** The language of an answer by the portal's own word lists; an answer too short or too full of names to place is not held against the model. */
export function answerLanguage(text: string): 'en' | 'id' | null {
  const found = detectLanguage(text);
  return found === 'English' ? 'en' : found === 'Bahasa Indonesia' ? 'id' : null;
}

const NEGATION = /\b(?:not|no|never|cannot|without|neither|nor|tidak|belum|bukan|tanpa)\b|n't/gi;
/** What a denial that the data holds a cause is about: saying, showing, knowing, listing. A negation of anything else ("does not respond to ping") denies nothing of the kind. */
const SAYING =
  /\b(?:say|says|said|specify|specified|indicate|indicates|show|shows|shown|state|states|stated|know|known|determine|identify|confirm|tell|mention|mentioned|list|listed|provide|provided|give|gives|given|contain|contains|include|includes|name|names|diketahui|tahu|mengetahui|tercantum|disebutkan|disebut|menyebutkan|menyebut|menunjukkan|mencantumkan|mencatat|dicatat|tercatat|memberi|memberikan|menampilkan|menyertakan|memuat|berisi|menentukan|ditentukan|dipastikan|memastikan|ada)\b/i;
/** A word that turns a sentence round: what follows it is not under the negation before it. */
const TURNS = /\b(?:but|however|although|though|yet|except|tetapi|namun|walaupun|meskipun|melainkan|kecuali)\b/i;
/** Wording the estate's own text puts in a sentence that reads as a denial and is not one: an alert's name, a host that does not answer, an alarm that is not acknowledged. */
const DATA_WORDS = new RegExp(
  [
    String.raw`\bunavailable\s+(?:by|via|through|over|on|to)\s+(?:an?\s+)?(?:ICMP|ping)(?:\s+ping)?`,
    String.raw`\bno\s+data\s+from\s+the\s+device`,
    String.raw`\b(?:does\s+not|doesn['’]t|do\s+not|don['’]t|is\s+not|isn['’]t|are\s+not|aren['’]t|not)\s+(?:be\s+)?(?:respond(?:ing)?|reachable|answer(?:ing)?|reply(?:ing)?)\b`,
    String.raw`\b(?:cannot|can['’]t)\s+be\s+(?:reached|pinged|contacted)\b`,
    String.raw`\b(?:not|never)\s+(?:yet\s+)?(?:been\s+)?(?:acknowledged|acked)\b`,
    String.raw`\b(?:tidak|belum)\s+(?:(?:bisa|dapat)\s+)?(?:di|ter)(?:jangkau|hubung|akses|ping|capai|sambung)\w*`,
    String.raw`\b(?:tidak|belum)\s+(?:merespons|merespon|menanggapi|menjawab|membalas|responsif|ada\s+(?:respons|respon|balasan|jawaban))\w*`,
    String.raw`\b(?:tidak|belum)\s+(?:di-?\s?)?(?:acknowledged?|acked|ack|diakui|dikonfirmasi)\b`,
  ].join('|'),
  'gi',
);

/**
 * With `negatedOk`, a match is not asserted when a negation of saying or knowing comes before it in its own sentence with no "but" between ("does not specify whether this is a hardware failure").
 * A guess followed by a denial is still asserted, and the dots of a host name such as 4.2.1 do not end a sentence.
 */
function asserted(text: string, pattern: string, negatedOk: boolean): boolean {
  if (!negatedOk) return new RegExp(pattern, 'im').test(text);
  for (const found of text.matchAll(new RegExp(pattern, 'gim'))) {
    const before = text.slice(0, found.index ?? 0);
    let start = 0;
    for (const end of before.matchAll(/[.?!](?=\s)|\n/g)) start = (end.index ?? 0) + 1;
    const sentence = before.slice(start);
    let denied = false;
    for (const no of sentence.matchAll(NEGATION)) {
      const after = sentence.slice((no.index ?? 0) + no[0].length);
      if (!TURNS.test(after) && SAYING.test(after)) denied = true;
    }
    if (!denied) return true;
  }
  return false;
}

export function scoreAnswer(question: Question, answer: string): { pass: boolean; failed: Check[] } {
  const failed: Check[] = [];
  const text = answer.trim();
  if (!text) return { pass: false, failed: ['empty'] };
  const re = (p: string) => new RegExp(p, 'i');
  // For what the data does not hold, only a denial of the answer's own making counts, not the data's words repeated.
  const claimed = question.kind === 'trap' ? text.replace(DATA_WORDS, ' _ ') : text;
  if (!(question.must ?? []).every((p) => re(p).test(claimed))) failed.push('facts');
  if ((question.mustNot ?? []).some((p) => asserted(text, p, question.negatedOk === true))) failed.push('invented');
  if (question.answerLang !== 'either') {
    const got = answerLanguage(text);
    if (got !== null && got !== question.answerLang) failed.push('language');
  } else {
    // Either of the two, but not a third: a word list cannot say, so only an answer in neither shows no word of either.
  }
  if (NOT_DRAWN.test(text)) failed.push('format');
  if (text.length > question.maxChars) failed.push('length');
  return { pass: failed.length === 0, failed };
}

export interface Summary {
  questions: number;
  passed: number;
  overall: number;
  traps: { asked: number; passed: number; rate: number };
  language: { asked: number; right: number; rate: number };
  format: { asked: number; right: number; rate: number };
  failedBy: Record<string, number>;
  byKind: Record<string, { asked: number; passed: number }>;
  byLang: Record<string, { asked: number; passed: number }>;
  adopted: boolean;
}

/** The marks of a whole run against PASS_MARKS. */
export function summarise(results: { question: Question; pass: boolean; failed: Check[] }[]): Summary {
  const count = (f: (r: (typeof results)[number]) => boolean) => results.filter(f).length;
  const passed = count((r) => r.pass);
  const traps = results.filter((r) => r.question.kind === 'trap');
  const named = results.filter((r) => r.question.answerLang !== 'either');
  const failedBy: Record<string, number> = {};
  const byKind: Summary['byKind'] = {};
  const byLang: Summary['byLang'] = {};
  for (const r of results) {
    for (const c of r.failed) failedBy[c] = (failedBy[c] ?? 0) + 1;
    for (const [map, key] of [[byKind, r.question.kind], [byLang, r.question.lang]] as const) {
      map[key] ??= { asked: 0, passed: 0 };
      map[key].asked++;
      if (r.pass) map[key].passed++;
    }
  }
  const trapsPassed = traps.filter((r) => r.pass).length;
  const languageRight = named.filter((r) => !r.failed.includes('language')).length;
  const formatRight = results.filter((r) => !r.failed.includes('format')).length;
  const rate = (n: number, d: number) => (d === 0 ? 1 : n / d);
  const overall = rate(passed, results.length);
  return {
    questions: results.length,
    passed,
    overall,
    traps: { asked: traps.length, passed: trapsPassed, rate: rate(trapsPassed, traps.length) },
    language: { asked: named.length, right: languageRight, rate: rate(languageRight, named.length) },
    format: { asked: results.length, right: formatRight, rate: rate(formatRight, results.length) },
    failedBy,
    byKind,
    byLang,
    adopted: overall >= PASS_MARKS.overall && rate(trapsPassed, traps.length) >= PASS_MARKS.traps && rate(languageRight, named.length) >= PASS_MARKS.language && rate(formatRight, results.length) >= PASS_MARKS.format,
  };
}
