import type { Meter, MetersResponse } from '../../types';

/**
 * What the wall shows, in turn. A wall cannot be scrolled, so each slide must fit one 1080p screen: the meters are split into pages that do.
 * The numbers and choices only; features/dashboard/Overview.tsx draws them and features/dashboard/useWallRotation.ts keeps the time.
 */

/** The most meters one slide holds at 1080p; more go on further slides. */
export const WALL_METERS = 35;

export type DashboardView = 'overview' | 'hosts' | 'internet';

export type Slide = { view: 'overview' } | { view: 'hosts' } | { view: 'internet'; page: number };

/** How many slides the meters take: at least one, so a wall always has a place to say "no links". */
export const wallPages = (count: number, per = WALL_METERS): number => Math.max(1, Math.ceil(count / per));

/** One page of an even split: 40 meters on two pages are 20 and 20, not 35 and 5. */
export function wallSlice<T>(items: T[], page: number, pages: number): T[] {
  const size = Math.ceil(items.length / Math.max(1, pages));
  return items.slice(page * size, (page + 1) * size);
}

/** The slides of the views given, in that order, the meters as many pages as they need. Never empty. */
export function slidesOf({ views, pages }: { views: readonly DashboardView[]; pages: number }): Slide[] {
  const out: Slide[] = [];
  for (const view of views) {
    if (view === 'internet') for (let page = 0; page < pages; page++) out.push({ view, page });
    else out.push({ view });
  }
  return out.length ? out : [{ view: 'overview' }];
}

/** A slide as text, to tell a new set of slides from the same one. */
export const slideKey = (s: Slide): string => (s.view === 'internet' ? `internet-${s.page}` : s.view);

/** Seconds a slide stays when the address does not say. */
export const ROTATE_DEFAULT = 30;
const ROTATE_MIN = 10;
const ROTATE_MAX = 600;

/** Seconds per slide from `rotate=`: 30 when absent or not a whole number, 0 stops the rotation, otherwise 10 to 600. */
export function rotateSeconds(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw.trim())) return ROTATE_DEFAULT;
  const n = Number(raw);
  return n === 0 ? 0 : Math.min(ROTATE_MAX, Math.max(ROTATE_MIN, n));
}

/** Whether a link needs a look: its interface is down, or it is High or Critical in the gauge's direction or the other. */
export function needsAttention(m: Meter): boolean {
  if (m.link === 'down') return true;
  if (m.state === 'ok' && (m.zone === 'warn' || m.zone === 'critical')) return true;
  return m.other?.zone === 'warn' || m.other?.zone === 'critical';
}

export interface InternetCard {
  /** How many links need someone to look, or null when there is nothing to count. */
  value: number | null;
  sub: string;
  /** Red when a link is down or Critical, orange when one is High, otherwise none. */
  tone: 'critical' | 'warn' | null;
}

/** The Overview's card for the internet links: how many need attention, and which way. With no current reading it does not claim all is well. */
export function internetCard(d: MetersResponse | null | undefined): InternetCard {
  if (!d) return { value: null, sub: '', tone: null };
  if (!d.found) return { value: null, sub: 'No Zabbix dashboard of that name', tone: null };
  if (d.meters.length === 0) return { value: null, sub: 'The dashboard has no gauges', tone: null };
  const s = d.summary;
  const value = d.meters.filter(needsAttention).length;
  const parts = [
    s.down > 0 ? `${s.down} down` : '',
    s.critical > 0 ? `${s.critical} critical` : '',
    s.warn > 0 ? `${s.warn} high` : '',
    s.otherHigh > 0 ? `${s.otherHigh} other direction` : '',
  ].filter(Boolean);
  const sub = parts.length
    ? parts.join(', ')
    : s.current > 0
      ? `None high or critical, of ${s.total}`
      : `${s.total} links, none with a current reading`;
  return { value, sub, tone: s.down > 0 || s.critical > 0 ? 'critical' : value > 0 ? 'warn' : null };
}
