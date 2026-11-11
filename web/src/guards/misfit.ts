/** What happens when an answer fails its check: the error a page shows, and the line written once to the console for whoever opens it. */

import type { Guard } from './shape';

/**
 * What a person reads when an answer fails its check. Plain words: the detail goes to the console, not to the page.
 * It must not say "Zabbix": the error state would then add its hint about reaching Zabbix, which is not the fault.
 */
export const unreadableMessage = (what: string) =>
  `The portal sent back ${what} in a form this page cannot read. Try again in a minute, or tell the portal admin.`;

/** The error for an answer that failed its check; `detail` is the first thing wrong, for a log. */
export class UnreadableAnswer extends Error {
  constructor(
    readonly path: string,
    what: string,
    readonly detail: string,
  ) {
    super(unreadableMessage(what));
    this.name = 'UnreadableAnswer';
  }
}

const told = new Set<string>();

/** A bad answer repeats on every poll: say what was wrong once, in the console, for whoever opens it. */
export function noteMisfit(source: string, detail: string): void {
  const line = `${source}: ${detail}`;
  // Capped, so a list that differs at every row cannot fill the console or grow this set for ever.
  if (told.has(line) || told.size >= 50) return;
  told.add(line);
  console.warn(`The portal's answer did not match what the page expects. ${line}`);
}

/** `body` itself when it fits `guard`; otherwise an UnreadableAnswer, which the page shows as its ordinary error. */
export function assertFits<T>(guard: Guard<T>, body: unknown, path: string): T {
  const detail = guard.misfit(body);
  if (detail === null) return body as T;
  noteMisfit(path, detail);
  throw new UnreadableAnswer(path, guard.what, detail);
}
