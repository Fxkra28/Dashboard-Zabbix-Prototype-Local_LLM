import { config } from '../core/config.js';
import type { PortalState, SendRecord } from '../core/state.js';
import { portalState } from './portalState.js';

/**
 * What the portal remembers about email: the list of people a report goes to, and a short record of what was sent.
 * The list in MAIL_TO is only where it starts; once the portal has a list of its own, that one is used.
 */

export function savedRecipients(): string[] {
  const own = portalState().read().mail.recipients;
  return own.length > 0 ? own : [...config.mail.to];
}

export async function saveRecipients(list: string[]): Promise<void> {
  await portalState().change((draft) => void (draft.mail.recipients = list));
}

/** The list is the one thing the monthly send has to go to, so it cannot be emptied now. */
export class ListInUseError extends Error {}

/**
 * Empties the portal's own list, so the one MAIL_TO started with applies again. Returns how many addresses it held.
 * `inUse` is asked inside the change, after every change before it has been applied: asked earlier, a schedule being
 * turned on at that moment would be missed.
 */
export async function clearRecipients(inUse: (state: PortalState) => boolean = () => false): Promise<number> {
  let removed = 0;
  await portalState().change((draft) => {
    if (inUse(draft)) throw new ListInUseError();
    removed = draft.mail.recipients.length;
    draft.mail.recipients = [];
  });
  return removed;
}

/** Adds a record of a send. The newest are kept (core/state.ts). */
export async function addSend(record: SendRecord): Promise<void> {
  await portalState().change((draft) => void draft.mail.sends.push(record));
}
