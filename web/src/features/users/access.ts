import type { Language, ModuleInfo, Role, UserRecord } from '../../types';

/** What the Users page says about a user, worked out from what the server sent (ADR-0017). */

export const ROLE_LABEL: Record<Role, string> = { guest: 'Guest', operator: 'Operator', admin: 'Administrator' };
export const ROLE_NOTE: Record<Role, string> = {
  guest: 'Reads what their pages show.',
  operator: 'Reads, and acknowledges and closes problems.',
  admin: 'Everything: also users and pages, the inventory scorecard, and sending the report by email.',
};
export const LANGUAGE_LABEL: Record<Language, string> = { en: 'English', id: 'Bahasa Indonesia' };

export type Status = 'env' | 'disabled' | 'expired' | 'must-change' | 'active';

/** Where a user stands now, in the order that matters most to the person reading: a user kept in .env cannot be changed at all. */
export function statusOf(user: UserRecord, nowSeconds: number): { key: Status; label: string } {
  if (user.source === 'env') return { key: 'env', label: user.breakGlass ? 'Kept in .env, always signs in' : 'Kept in .env' };
  if (user.disabled) return { key: 'disabled', label: 'Disabled' };
  if (user.expires !== null && user.expires <= nowSeconds) return { key: 'expired', label: 'Expired' };
  if (user.mustChange) return { key: 'must-change', label: 'Must change the password' };
  return { key: 'active', label: 'Active' };
}

/** The modules a user of this role can be given: an administrator's own pages are the administrator's alone. */
export const grantableFor = (role: Role, modules: ModuleInfo[]): ModuleInfo[] => (role === 'admin' ? modules : modules.filter((m) => !m.adminOnly));

/** What an account with this role and these modules can see and do, in words. An administrator has every page, whatever the list says. */
export function effectiveAccess(role: Role, held: string[], modules: ModuleInfo[]): { pages: string[]; can: string[] } {
  const pages = (role === 'admin' ? modules : modules.filter((m) => held.includes(m.id) && !m.adminOnly)).map((m) => m.label);
  const can = ['Read what their pages show'];
  if (role !== 'guest') can.push('Acknowledge and close problems, where the portal has that switched on');
  if (role === 'admin') can.push('Add and change users and their pages', 'Read the inventory scorecard', 'Send and schedule the SLA report by email');
  return { pages, can };
}

/** A date field (`YYYY-MM-DD`) as the end of that day in the report zone, Unix seconds, or null for an empty one. */
export function expiryOf(date: string, toSeconds: (text: string) => number): number | null {
  if (!date) return null;
  const at = toSeconds(`${date}T23:59`);
  return Number.isFinite(at) ? at + 59 : null;
}
