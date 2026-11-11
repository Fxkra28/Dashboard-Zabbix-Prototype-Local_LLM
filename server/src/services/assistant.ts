/**
 * The assistant (chat) behind the sidebar's "Assistant" page. Where `ai.ts` rewrites one Zabbix
 * artifact into a fixed schema, this answers free-form questions about the estate. It is still not
 * an agent: the model is handed a read-only snapshot of what the portal already shows (open
 * problems, sites, unreachable hosts, SLA standing, degraded services), is told to answer from that
 * alone and has no tools, so the worst a bad answer can do is be wrong. The snapshot comes from the
 * same cached queries and cache keys the pages use, so a busy chat costs Zabbix nothing extra.
 *
 * This file is the one entry to it: the route, `chat.ts` and the tests import from here, and the pieces behind it import one another
 * directly, never through it. A test that replaces `getSnapshot` or `streamAnswer` here therefore replaces what the route calls, and
 * nothing underneath.
 *
 *   assistantPrompt    the rules the model answers by, the language it is asked to use, the data fence
 *   assistantLines     Zabbix facts as plain prompt lines, within a character budget
 *   assistantFacts     how many hosts are in each state, and since when a host has been down
 *   assistantSnapshot  the snapshot the model answers from, built and then reused while nothing it describes changes
 *   assistantFocus     the FOCUS block for a site the question names
 *   assistantAnswer    asking the model, and cleaning what it says
 */
export { CHAT_SYSTEM, detectLanguage, languageReminder, systemText } from './assistantPrompt.js';
export { age, promptText, section } from './assistantLines.js';
export { buildSnapshot, getSnapshot, SNAPSHOT_CHAR_CAP, SNAPSHOT_KEY, snapshotClock, snapshotFingerprint } from './assistantSnapshot.js';
export type { Snapshot, SnapshotMeta } from './assistantSnapshot.js';
export { buildFocus, focusBlock, hostFocusBlock, hostsNamed, sitesNamed } from './assistantFocus.js';
export { cleanAnswer, readOpenAiStream, streamAnswer } from './assistantAnswer.js';
export type { AnswerOptions, ChatTurn } from './assistantAnswer.js';
