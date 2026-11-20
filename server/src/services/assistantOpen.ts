/**
 * The open problems beyond the few that the snapshot names, for "sebutkan semua problem di Pasuruan" or "semua problem High": every open problem of a site or a host, or of a severity, worst first, in
 * the words of the snapshot's own list. The estate as a whole is not listed without a severity, since the snapshot already counts it and a list of hundreds answers nothing.
 */

import type { ZbxProblem } from '../domain/queries.js';
import { HOST_NAME_MAX, problemLine, promptText, section, severityCounts, severityList, sevName, worstFirst } from './assistantLines.js';

const FLOOR_WORDS: [RegExp, number][] = [
  [/\b(disaster|critical|kritis|darurat)\b/i, 5],
  [/\b(high|tinggi)\b/i, 4],
  [/\b(average|sedang|menengah)\b/i, 3],
  [/\b(warning|peringatan)\b/i, 2],
];

/** The lowest severity a question asks for, or null when it names none. */
export function floorOf(question: string): number | null {
  return FLOOR_WORDS.find(([re]) => re.test(question))?.[1] ?? null;
}

export interface OpenSectionOptions {
  /** The site or host the question named, or null for the whole estate. */
  scope: string | null;
  floor: number | null;
  now: number;
  budget: number;
}

export function openProblemsSection(problems: ZbxProblem[], { scope, floor, now, budget }: OpenSectionOptions): { text: string; truncated: boolean } {
  const where = scope ? `at ${promptText(scope, HOST_NAME_MAX)}` : 'across the estate';
  if (!scope && floor === null) {
    const counts = severityList(severityCounts(problems), true);
    return section(`OPEN PROBLEMS ${where}: ${problems.length} in all (${counts || 'none'}); they are not listed without a site, a host or a severity to narrow them:`, [], budget);
  }
  const listed = problems.filter((p) => floor === null || Number(p.severity) >= floor).sort(worstFirst);
  const above = floor === null ? '' : `, ${sevName(floor)} and above`;
  const title = `OPEN PROBLEMS ${where}${above}: ${listed.length} in all, worst first:`;
  return section(title, listed.map((p) => problemLine(p, now)), budget, (left) => `- …and ${left} more, not listed`);
}
